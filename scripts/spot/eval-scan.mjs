#!/usr/bin/env node
// How well does the photo reader see kit? Runs the app's own prompt (frontend/src/lib/gym-scan.js)
// over photos labelled by somebody else: Wikimedia Commons categories, chosen by people who file
// photos of leg presses under "Leg press machines", not by the model being graded.
//
//   OPENAI_API_KEY=... node scripts/spot/eval-scan.mjs <cache dir> [--per 8] [--key-env NAME] [--model NAME]
//
// Two numbers per category:
//   seen    how many photos the labelled kit was found in, at the confidence that switches a chip on
//   false   photos where kit that should not be there was reported (the negative categories)
// Commons labels are noisy (a "Dumbbells" category holds statues too), so a low number is a reason
// to look at the photos, printed with --misses, not proof the model is wrong.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { scanPhotos, kitFromScan, providerForKey } from '../../frontend/src/lib/gym-scan.js'

const API = 'https://commons.wikimedia.org/w/api.php'
const UA = 'openGym-fork-eval/0.1 (https://github.com/vjuux/openGym)'
const PACE_MS = 1500

const CASES = [
  { category: 'Leg_press_machines', expect: ['leg press'] },
  { category: 'Kettlebells', expect: ['kettlebells'] },
  { category: 'Dumbbells', expect: ['dumbbells'] },
  { category: 'Barbells', expect: ['barbell'] },
  { category: 'Smith_machine', expect: ['smith machine'] },
  { category: 'Treadmills', not: ['squat rack', 'barbell', 'leg press', 'smith machine'] },
  { category: 'Playgrounds', not: ['dumbbells', 'barbell', 'squat rack', 'cable station', 'leg press', 'chest press'] },
  { category: 'Living_rooms', not: ['dumbbells', 'barbell', 'squat rack', 'cable station', 'leg press', 'pull-up bar', 'dip bars'] },
  { category: 'Offices', not: ['dumbbells', 'barbell', 'squat rack', 'cable station', 'leg press', 'pull-up bar', 'dip bars'] },
]

const args = process.argv.slice(2)
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const dir = args[0]
if (!dir || dir.startsWith('--')) { console.error('usage: eval-scan.mjs <cache dir> [--per 8] [--key-env NAME] [--model NAME] [--misses]'); process.exit(2) }
const per = Number(flag('per', 8))
const key = process.env[flag('key-env', 'OPENAI_API_KEY')]
const provider = providerForKey(key)
const model = flag('model')
if (!provider) { console.error('no usable API key in the environment'); process.exit(2) }
mkdirSync(dir, { recursive: true })

const pause = ms => new Promise(r => setTimeout(r, ms))
let last = 0
async function commons(url, asBuffer = false) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await pause(Math.max(0, last + PACE_MS - Date.now()))
    last = Date.now()
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (res.ok) {
      if (asBuffer) return Buffer.from(await res.arrayBuffer())
      const text = await res.text()
      try { return JSON.parse(text) } catch { /* a rate-limit page: wait and try again */ }
    }
    await pause(8000 * (attempt + 1))
  }
  throw new Error(`Commons refused ${url.slice(0, 100)}`)
}

async function photosOf(category) {
  const list = join(dir, `${category}.json`)
  if (existsSync(list)) return JSON.parse(readFileSync(list, 'utf8'))
  const q = new URLSearchParams({ action: 'query', format: 'json', generator: 'categorymembers', gcmtitle: `Category:${category}`, gcmtype: 'file', gcmlimit: '60', prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '1024' })
  const data = await commons(`${API}?${q}`)
  const photos = Object.values(data.query?.pages || {})
    .map(p => ({ title: p.title, url: p.imageinfo?.[0]?.thumburl, mime: p.imageinfo?.[0]?.mime }))
    .filter(p => p.url && p.mime === 'image/jpeg')
    .sort((a, b) => (a.title < b.title ? -1 : 1))
  writeFileSync(list, JSON.stringify(photos))
  return photos
}

// Evenly across the category, so a photographer's run of twenty shots of one object counts once.
const spread = (list, n) => (list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.floor(i * list.length / n)]))

async function imageOf(photo) {
  const file = join(dir, photo.title.replace(/[^\w.-]+/g, '_').slice(-120))
  if (!existsSync(file)) writeFileSync(file, await commons(photo.url, true))
  return readFileSync(file).toString('base64')
}

const totals = { calls: 0, expected: 0, seen: 0, negatives: 0, falsePhotos: 0 }
for (const c of CASES) {
  const photos = spread(await photosOf(c.category), per)
  if (!photos.length) { console.log(`${c.category}: no photos, skipped`); continue }
  let seen = 0, wrong = 0, ran = 0
  const misses = []
  for (const photo of photos) {
    let scan
    try {
      scan = await scanPhotos([{ mime: 'image/jpeg', data: await imageOf(photo) }], { key, provider, model, fetcher: fetch })
    } catch (e) { misses.push(`${photo.title}: failed, ${e.message.slice(0, 80)}`); continue }
    ran++
    totals.calls++
    const on = kitFromScan(scan)
    if (c.expect) {
      if (c.expect.every(id => on.includes(id))) seen++
      else misses.push(`${photo.title}: saw [${on.join(', ')}]`)
    }
    if (c.not) {
      const bad = on.filter(id => c.not.includes(id))
      if (bad.length) { wrong++; misses.push(`${photo.title}: reported [${bad.join(', ')}]`) }
    }
  }
  if (c.expect) { totals.expected += ran; totals.seen += seen; console.log(`${c.category}: seen ${seen}/${ran}`) }
  if (c.not) { totals.negatives += ran; totals.falsePhotos += wrong; console.log(`${c.category}: false ${wrong}/${ran}`) }
  if (args.includes('--misses')) for (const m of misses) console.log(`  ${m}`)
}
console.log(`\nmodel ${model || 'default'} (${provider}), ${totals.calls} calls`)
console.log(`labelled kit seen: ${totals.seen}/${totals.expected}`)
console.log(`photos with kit that was not there: ${totals.falsePhotos}/${totals.negatives}`)
