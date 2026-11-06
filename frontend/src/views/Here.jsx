// The first screen: a map with you on it, and one card that says what to do here.
//
// Everything else in the app is one tap away and untouched. This screen only decides: which place
// you are at, what it has, what to train. The session itself runs on the normal workout screen.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import HereMap from '../components/HereMap.jsx'
import HereScan from '../components/HereScan.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameText, todayISO, uid } from '../lib/format.js'
import { navToWorkout } from '../lib/nav.js'
import { MOBILE } from '../lib/mobile.js'
import { ACC_V, newProfile } from '../lib/equipment.js'
import { switchGym } from '../lib/gym-inventory.js'
import { askForegroundLocation, currentPosition, gymPermissions, loadGymConfig, saveGymConfig } from '../lib/gym-reminder.js'
import { fmtDistance, googleMapsUrl } from '../lib/gym-places.js'
import { kitEquipment, kitLabel } from '../lib/kit.js'
import { buildSessionEntries } from '../lib/session-start.js'
import { FOCUS_IDS, planRoutine, shortName, suggestSessions, swapItem } from '../lib/spot-session.js'
import { loadSpots } from '../lib/spots.js'
import { mergePlaces, placeHere, savedPlaces } from '../lib/spot-places.js'
import './Here.css'

const LAST_POS = 'spot_last_pos_v1'
const FAR_M = 400
const NEW_PLACE_RADIUS = 120

const readLastPos = () => {
  try { const p = JSON.parse(localStorage.getItem(LAST_POS)); return Number.isFinite(p?.lat) && Number.isFinite(p?.lng) ? p : null } catch { return null }
}

// Where the phone is. Asks once when it may not say yet. A browser has no native plugin: it asks itself.
async function locate() {
  if (MOBILE) {
    const perm = await gymPermissions()
    if (perm && perm.location !== 'granted') await askForegroundLocation()
    const p = await currentPosition()
    if (p) return p
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('no location')); return }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    )
  })
}

const placeTitle = place => place?.name || (place?.kind === 'gym' ? 'Gym' : place?.kind === 'station' ? 'Fitness station' : 'Here')

const prescription = cfg => (cfg.mode === 'time' ? `${cfg.sets} × ${cfg.sec}s` : `${cfg.sets} × ${cfg.side ? cfg.reps / 2 : cfg.reps}`)

function kitSummary(kit) {
  const labels = kit.map(kitLabel)
  return labels.length > 4 ? `${labels.slice(0, 4).join(', ')} +${labels.length - 4}` : labels.join(', ')
}

function unknownLine(place, pos, spotState) {
  if (place?.kind === 'gym') return 'Snap it once and it remembers'
  if (place) return "Nobody has listed what's here"
  if (!pos) return 'Finding you…'
  return spotState === 'loading' ? 'Looking nearby…' : 'No mapped spot right here'
}

export default function Here() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [pos, setPos] = useState(readLastPos)
  const [locFailed, setLocFailed] = useState(false)
  const [spots, setSpots] = useState([])
  const [spotState, setSpotState] = useState('idle')
  const [config, setConfig] = useState(null)
  const [pickedId, setPickedId] = useState(null)
  const [bodyweightOk, setBodyweightOk] = useState(() => new Set())
  const [focusPick, setFocusPick] = useState(null)
  const [swapped, setSwapped] = useState(null)
  const [recenter, setRecenter] = useState(0)
  const [now] = useState(() => Date.now())

  const refreshLocation = () => locate().then(p => {
    setPos(p)
    setLocFailed(false)
    try { localStorage.setItem(LAST_POS, JSON.stringify({ lat: p.lat, lng: p.lng })) } catch { /* only a head start next time */ }
  }).catch(() => setLocFailed(true))

  useEffect(() => {
    refreshLocation()
    loadGymConfig().then(r => setConfig(r.config)).catch(() => setConfig({ gyms: [] }))
    const back = () => { if (document.visibilityState === 'visible') refreshLocation() }
    document.addEventListener('visibilitychange', back)
    return () => document.removeEventListener('visibilitychange', back)
  }, [])

  const fetchSpots = () => {
    if (!pos) return
    setSpotState('loading')
    loadSpots(pos).then(list => { setSpots(list); setSpotState('ready') }).catch(() => setSpotState('failed'))
  }
  // The block changes every few km, and the cache answers until then, so this costs nothing to repeat.
  useEffect(fetchSpots, [pos && pos.lat.toFixed(2), pos && pos.lng.toFixed(2)])

  const places = useMemo(() => mergePlaces(savedPlaces(config, S.equipProfiles), spots, pos), [config, S.equipProfiles, spots, pos])
  const here = useMemo(() => placeHere(places, pos), [places, pos])
  const place = (pickedId && places.find(p => p.id === pickedId)) || here
  const placeKey = place?.id || 'here'
  const kit = place?.kit || []
  const title = placeTitle(place)
  const far = !!place && place.distance > FAR_M

  const sessions = useMemo(() => suggestSessions(kit, { workouts: S.workouts || [], now }), [kit.join(), S.workouts, now])
  const focus = focusPick && sessions.plans[focusPick] ? focusPick : sessions.focus
  const base = sessions.plans[focus]
  const plan = swapped?.key === `${placeKey}/${focus}` ? swapped.plan : base

  const needsKit = !place?.known && !bodyweightOk.has(placeKey)
  const active = !!S.active

  useEffect(() => { setFocusPick(null); setSwapped(null) }, [placeKey])

  const start = () => {
    if (place?.equip) update(s => { switchGym(s, place.equip) })
    const st = useStore.getState().S
    const entries = buildSessionEntries(st, planRoutine(plan, plan.label))
    update(s => {
      s.active = {
        id: uid(), d: todayISO(), start: Date.now(), routineIds: [],
        name: place ? `${plan.label} at ${title}` : plan.label,
        bw: null, cur: 0, entries, workoutView: st.workoutView || 'cards',
      }
    })
    useUI.getState().stopRest()
    navToWorkout()
  }

  const savePlace = async ({ name, kit: newKit }) => {
    let equip = place?.equip
    update(s => {
      s.equipProfiles = s.equipProfiles || []
      const fields = { name, kit: newKit, equipment: kitEquipment(newKit), accV: ACC_V }
      const known = equip && s.equipProfiles.find(p => p.id === equip)
      if (known) Object.assign(known, fields)
      else {
        const p = { ...newProfile(name), ...fields }
        equip = p.id
        s.equipProfiles.push(p)
      }
      // The library and the picker now show only what this place has; "Show all" still shows all.
      s.equipFilterOn = true
      switchGym(s, equip)
    })
    const at = place || pos
    const current = (await loadGymConfig()).config
    const gym = { name, lat: at.lat, lng: at.lng, radius: place?.radius || NEW_PLACE_RADIUS, equip, ...(place?.kind === 'saved' ? { id: place.id } : {}) }
    // ponytail: the phone keeps 20 places (iOS's region limit). New ones go first, so the oldest falls off.
    const next = { ...current, gyms: [gym, ...current.gyms.filter(g => g.id !== place?.id)] }
    await saveGymConfig(next, useStore.getState().S)
    setConfig(next)
    setSpots(list => list.filter(s => s.id !== place?.id))
    setPickedId(null)
  }

  const openScan = () => {
    useUI.getState().openSheet(close => (
      <HereScan place={place} title={title} startKit={kit} startName={place?.name || ''} onSave={savePlace} close={close} />
    ))
  }

  const distance = place?.distance != null && place.distance > 30 ? fmtDistance(place.distance) : ''
  const sub = [distance, needsKit ? unknownLine(place, pos, spotState) : kit.length ? kitSummary(kit) : 'Body weight'].filter(Boolean).join(' · ')

  return (
    <div className="here">
      <HereMap pos={pos} places={places} selectedId={place?.id || null} onSelect={setPickedId} recenter={recenter} />

      <button type="button" className="here-round here-more" onClick={() => nav('/home')} aria-label="Everything else"><Icon name="grid" /></button>

      <section className="here-card" aria-label="What to do here">
        <button type="button" className="here-round here-locate" onClick={() => { setPickedId(null); setRecenter(n => n + 1); refreshLocation() }} aria-label="Show where I am"><Icon name="location" /></button>

        <header className="here-head">
          <div>
            <h1>{title}</h1>
            <p>{sub}</p>
          </div>
          {!needsKit && <button type="button" className="here-edit" onClick={openScan} aria-label={`Change what's at ${title}`}><Icon name="pencil" /></button>}
        </header>

        {locFailed && !pos && <p className="here-note">Location is off, so the map can't find you. <button type="button" onClick={refreshLocation}>Try again</button></p>}
        {spotState === 'failed' && !spots.length && <p className="here-note">Couldn't load nearby places. <button type="button" onClick={fetchSpots}>Try again</button></p>}

        {needsKit && !active ? (
          <div className="here-actions">
            <button type="button" className="here-go" onClick={openScan}><Icon name="camera" /> Snap what's here</button>
            <button type="button" className="here-link" onClick={() => setBodyweightOk(s => new Set(s).add(placeKey))}>Just body weight</button>
          </div>
        ) : plan && !active ? (
          <>
            <div className="here-focus" role="tablist" aria-label="What to train">
              {FOCUS_IDS.filter(f => sessions.plans[f]).map(f => (
                <button type="button" role="tab" key={f} aria-selected={f === focus} className={f === focus ? 'on' : ''} onClick={() => setFocusPick(f)}>{sessions.plans[f].label}</button>
              ))}
            </div>
            <ul className="here-list">
              {plan.items.map((item, i) => (
                <li key={item.id}>
                  <button type="button" onClick={() => setSwapped({ key: `${placeKey}/${focus}`, plan: swapItem(plan, i, kit, {}) })} aria-label={`Swap ${exerciseNameText(EXIDX[item.id])}`}>
                    <span>{shortName(exerciseNameText(EXIDX[item.id]))}</span>
                    <em>{prescription(item.cfg)}</em>
                  </button>
                </li>
              ))}
            </ul>
            {far
              ? <a className="here-go" href={googleMapsUrl(place)} target="_blank" rel="noopener">Get there · {distance}</a>
              : <button type="button" className="here-go" onClick={start}>Start · {plan.minutes} min</button>}
          </>
        ) : active ? (
          <button type="button" className="here-go" onClick={() => nav('/workout')}>Back to your workout</button>
        ) : null}
      </section>
    </div>
  )
}
