// Places to train near you, from OpenStreetMap: outdoor fitness stations, calisthenics parks, gyms.
//
// What this data can and cannot say, measured November 2026:
//   - Where: good. Los Angeles has 285 stations mapped, Berlin 376.
//   - What: poor. Only about 15 to 20% say which kit they have in a way that helps (`horizontal_bar`,
//     `parallel_bars`...). So most pins come back `known: false`, and the screen asks for a photo
//     rather than guessing. A gym's kit is never in the data at all.
//   - Overpass, the public query service: slow and unreliable (17 to 41 s, two mirrors of four timed
//     out in a test). So a request goes to one mirror, then the next a few seconds later, the first
//     good answer wins, and the result is kept per area for two weeks.
//
// Privacy: the phone asks for a whole block of about 11 km, never for its exact position, and the
// answer stays on this device.
//
// ponytail: a request per block straight from the phone. If this ever has real users, serve a
// cached extract from our own server instead; the public mirrors are not meant for that.
import { nativeFetch } from './capacitor-fetch.js'
import { distanceM } from './gym-reminder.js'

export const OVERPASS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
])
const CACHE_KEY = 'spot_blocks_v1'
const CACHE_MS = 14 * 24 * 3600 * 1000
const CACHE_MAX = 24
const BLOCK_DEG = 0.1
const STAGGER_MS = 4000
const TIMEOUT_MS = 75000
const CLUSTER_M = 90
const USER_AGENT = 'Spot/0.1 (personal fork of openGym; github.com/vjuux/openGym)'

// `fitness_station=*` values that tell us something we can use. Everything else (`yes`, `sign`,
// `balance_beam`, `air_walker`...) is left out rather than turned into a session it cannot carry.
const STATION_KIT = Object.freeze({
  horizontal_bar: ['pull-up bar'],
  horizontal_ladder: ['pull-up bar'],
  monkey_bars: ['pull-up bar'],
  parallel_bars: ['dip bars'],
  rings: ['rings'],
  'push-up': ['low bar'],
  'sit-up': ['bench'],
  box: ['box'],
  stairs: ['box'],
  steps: ['box'],
})

// A gym in OSM may be a yoga studio or a boxing club. Those are not places to lift.
const NOT_A_LIFTING_GYM = /yoga|pilates|boxing|martial|karate|judo|dance|climbing|swimming|barre|cycling|spinning/i

/** The block around a point: the 0.1 degree square whose nearest corners surround it, so the point is never at the edge. */
export function blockOf(lat, lng) {
  const south = Math.round(lat / BLOCK_DEG - 0.5) * BLOCK_DEG, west = Math.round(lng / BLOCK_DEG - 0.5) * BLOCK_DEG
  const f = v => v.toFixed(2)
  return { key: `${f(south)},${f(west)}`, bbox: `${f(south)},${f(west)},${f(south + BLOCK_DEG)},${f(west + BLOCK_DEG)}` }
}

export const blockQuery = bbox => `[out:json][timeout:45][bbox:${bbox}];(nwr["leisure"="fitness_station"];nwr["sport"="calisthenics"];nwr["leisure"="fitness_centre"];);out center tags;`

const valuesOf = v => String(v || '').split(';').map(s => s.trim()).filter(Boolean)

/** One OSM element as a place: { id, lat, lng, name, kind: 'station' | 'gym', kit, known }, or null. */
export function elementToSpot(el) {
  const tags = el?.tags || {}
  const lat = el?.lat ?? el?.center?.lat, lng = el?.lon ?? el?.center?.lon
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const id = `${el.type || 'n'}/${el.id}`
  const name = String(tags.name || '').trim()
  if (tags.leisure === 'fitness_centre') {
    if (NOT_A_LIFTING_GYM.test(`${tags.sport || ''} ${name}`)) return null
    return { id, lat, lng, name, kind: 'gym', kit: [], known: false }
  }
  const kit = [...new Set(valuesOf(tags.fitness_station).flatMap(v => STATION_KIT[v] || []))]
  // A calisthenics park that lists nothing still has a bar and dips: that is what the word means.
  // The screen shows the kit as editable, so a wrong assumption costs one tap.
  if (!kit.length && valuesOf(tags.sport).includes('calisthenics')) kit.push('pull-up bar', 'dip bars')
  return { id, lat, lng, name, kind: 'station', kit, known: kit.length > 0 }
}

/**
 * One pin per place. A park is often mapped as a dozen separate stations a few metres apart, each
 * with one piece of kit: together they are what the place has. Gyms never merge with anything.
 */
export function clusterSpots(spots) {
  const out = []
  for (const s of spots) {
    const near = s.kind === 'station' && out.find(c => c.kind === 'station' && distanceM(c, s) <= CLUSTER_M)
    if (!near) { out.push({ ...s, kit: [...s.kit], count: 1 }); continue }
    near.lat = (near.lat * near.count + s.lat) / (near.count + 1)
    near.lng = (near.lng * near.count + s.lng) / (near.count + 1)
    near.count += 1
    near.kit = [...new Set([...near.kit, ...s.kit])]
    near.known = near.kit.length > 0
    if (!near.name && s.name) near.name = s.name
  }
  return out
}

/** Places from an Overpass answer, nearest first when `from` is given. */
export function spotsFromAnswer(answer, from = null) {
  const spots = clusterSpots((answer?.elements || []).map(elementToSpot).filter(Boolean))
  if (from) for (const s of spots) s.distance = distanceM(from, s)
  return from ? spots.sort((a, b) => a.distance - b.distance) : spots
}

// One mirror, then another a few seconds later. The first good answer wins and stops the rest.
export async function askOverpass(query, { mirrors = OVERPASS, fetcher = nativeFetch, stagger = STAGGER_MS, timeout = TIMEOUT_MS } = {}) {
  const stop = new AbortController()
  const timers = []
  const one = (url, i) => new Promise((resolve, reject) => {
    timers.push(setTimeout(async () => {
      if (stop.signal.aborted) return reject(new Error('stopped'))
      try {
        const res = await fetcher(`${url}?data=${encodeURIComponent(query)}`, { method: 'GET', headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: stop.signal })
        if (!res.ok) throw new Error(`${url}: ${res.status}`)
        const data = await res.json()
        if (!Array.isArray(data?.elements)) throw new Error(`${url}: no elements`)
        // An overloaded server can answer 200 with a `remark` and nothing else: that is not "no spots".
        if (data.remark && !data.elements.length) throw new Error(`${url}: ${data.remark}`)
        resolve(data)
      } catch (e) { reject(e) }
    }, i * stagger))
  })
  const deadline = new Promise((_, reject) => timers.push(setTimeout(() => reject(new Error('timeout')), timeout)))
  try {
    return await Promise.race([Promise.any(mirrors.map(one)), deadline])
  } finally {
    timers.forEach(clearTimeout)
    stop.abort()
  }
}

const readCache = store => { try { return JSON.parse(store.getItem(CACHE_KEY)) || {} } catch { return {} } }
function writeCache(store, cache) {
  const keys = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at)
  const kept = Object.fromEntries(keys.slice(0, CACHE_MAX).map(k => [k, cache[k]]))
  try { store.setItem(CACHE_KEY, JSON.stringify(kept)) } catch { /* storage full or blocked: asks again next time */ }
}

/**
 * Places around a point. A block seen in the last two weeks answers at once, without the network.
 * Throws when nothing is cached and no mirror answers: the screen says so and keeps the map usable.
 */
export async function loadSpots(pos, { store = globalThis.localStorage, ask = askOverpass, now = Date.now() } = {}) {
  const { key, bbox } = blockOf(pos.lat, pos.lng)
  const cache = readCache(store)
  const hit = cache[key]
  if (hit && now - hit.at < CACHE_MS) return spotsFromAnswer({ elements: hit.elements }, pos)
  try {
    const answer = await ask(blockQuery(bbox))
    const elements = answer.elements.map(({ type, id, lat, lon, center, tags }) => ({ type, id, lat, lon, center, tags: pickTags(tags) }))
    writeCache(store, { ...cache, [key]: { at: now, elements } })
    return spotsFromAnswer({ elements }, pos)
  } catch (e) {
    if (hit) return spotsFromAnswer({ elements: hit.elements }, pos) // old beats nothing
    throw e
  }
}

// Only what elementToSpot reads, so the cache stays small.
const pickTags = t => {
  const out = {}
  for (const k of ['name', 'leisure', 'sport', 'fitness_station']) if (t?.[k]) out[k] = t[k]
  return out
}
