// The places on the map: the ones you saved, and the OpenStreetMap ones you have not. Pure.
//
// A saved place is an existing gym-reminder place (on-device only, lib/gym-reminder.js) linked to an
// equipment profile that also carries its `kit` (synced, no location in it). So everything the app
// already does with those keeps working: the active gym, its plates, the library filter.
import { distanceM } from './gym-reminder.js'

const REACH_M = 200

export function savedPlaces(config, profiles = []) {
  const byId = new Map((profiles || []).filter(Boolean).map(p => [p.id, p]))
  return (config?.gyms || []).filter(g => g.equip && byId.has(g.equip)).map(g => {
    const p = byId.get(g.equip)
    const kit = Array.isArray(p.kit) ? p.kit : []
    return { id: g.id, lat: g.lat, lng: g.lng, radius: g.radius, name: g.name || p.name || '', kind: 'saved', equip: g.equip, kit, known: true }
  })
}

/** Saved places and the mapped ones, leaving out a mapped pin that sits on a place you saved. */
export function mergePlaces(saved, spots, from = null) {
  const open = spots.filter(s => !saved.some(p => distanceM(p, s) <= Math.max(p.radius || 0, 90)))
  const all = [...saved, ...open]
  if (!from) return all
  return all.map(p => ({ ...p, distance: distanceM(from, p) })).sort((a, b) => a.distance - b.distance)
}

/** Where you are now: a saved place holding the spot, else the nearest place within reach, else null. */
export function placeHere(places, pos) {
  if (!pos) return null
  const slack = Math.min(50, Math.max(0, Number(pos.accuracy) || 0))
  const inside = places.filter(p => p.kind === 'saved' && distanceM(pos, p) <= (p.radius || 0) + slack)
  const pool = inside.length ? inside : places.filter(p => distanceM(pos, p) <= REACH_M + slack)
  return pool.reduce((best, p) => (!best || distanceM(pos, p) < distanceM(pos, best) ? p : best), null)
}
