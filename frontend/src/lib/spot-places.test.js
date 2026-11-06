// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { savedPlaces, mergePlaces, placeHere } from './spot-places.js'

const park = { id: 'node/1', lat: 34.0, lng: -118.0, kind: 'station', kit: ['pull-up bar'], known: true }
const far = { id: 'node/2', lat: 34.05, lng: -118.0, kind: 'station', kit: [], known: false }

describe('savedPlaces', () => {
  it('joins a place to its profile\'s kit and skips what is not linked', () => {
    const config = { gyms: [
      { id: 'g1', name: 'Home', lat: 34, lng: -118, radius: 120, equip: 'p1' },
      { id: 'g2', name: 'Reminder only', lat: 34, lng: -118, radius: 120 },
      { id: 'g3', name: 'Gone', lat: 34, lng: -118, radius: 120, equip: 'deleted' },
    ] }
    const places = savedPlaces(config, [{ id: 'p1', name: 'Home', kit: ['bench'] }])
    expect(places).toHaveLength(1)
    expect(places[0]).toMatchObject({ id: 'g1', kit: ['bench'], known: true, kind: 'saved', equip: 'p1' })
  })

  it('reads a profile from before kit existed as an empty place', () => {
    expect(savedPlaces({ gyms: [{ id: 'g', lat: 1, lng: 1, radius: 75, equip: 'p' }] }, [{ id: 'p', name: 'Old', equipment: ['barbell'] }])[0].kit).toEqual([])
  })
})

describe('mergePlaces', () => {
  it('shows a saved place instead of the mapped pin under it, and sorts nearest first', () => {
    const saved = [{ id: 'g1', lat: 34.0002, lng: -118, radius: 120, kind: 'saved', kit: ['bench'] }]
    const merged = mergePlaces(saved, [park, far], { lat: 34, lng: -118 })
    expect(merged.map(p => p.id)).toEqual(['g1', 'node/2'])
    expect(merged[0].distance).toBeLessThan(merged[1].distance)
  })
})

describe('placeHere', () => {
  const home = { id: 'g1', lat: 34.0, lng: -118.0, radius: 120, kind: 'saved', kit: [] }

  it('prefers the saved place you are inside, even over a nearer mapped pin', () => {
    const pin = { ...park, lat: 34.0009, lng: -118.0 }
    expect(placeHere([pin, home], { lat: 34.0008, lng: -118.0 }).id).toBe('g1')
  })

  it('takes the nearest mapped pin within reach, and nothing past it', () => {
    expect(placeHere([park, far], { lat: 34.001, lng: -118.0 }).id).toBe('node/1')
    expect(placeHere([park, far], { lat: 34.01, lng: -118.0 })).toBeNull()
    expect(placeHere([park], null)).toBeNull()
  })

  it('gives a rough fix some slack, the way a gym door is found indoors', () => {
    const at = { lat: 34.0021, lng: -118.0 }
    expect(placeHere([park], at)).toBeNull()
    expect(placeHere([park], { ...at, accuracy: 60 }).id).toBe('node/1')
  })
})
