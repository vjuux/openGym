// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { blockOf, blockQuery, elementToSpot, clusterSpots, spotsFromAnswer, askOverpass, loadSpots } from './spots.js'

const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, tags })

describe('blockOf', () => {
  it('keeps the point well inside the block, so a spot just over the edge still shows', () => {
    for (const [lat, lng] of [[33.985, -118.472], [34.0001, -118.0001], [52.52, 13.405], [-33.86, 151.21]]) {
      const [s, w, n, e] = blockOf(lat, lng).bbox.split(',').map(Number)
      expect(lat).toBeGreaterThanOrEqual(s - 1e-9)
      expect(lat).toBeLessThanOrEqual(n + 1e-9)
      expect(lng).toBeGreaterThanOrEqual(w - 1e-9)
      expect(lng).toBeLessThanOrEqual(e + 1e-9)
      expect(n - s).toBeCloseTo(0.1)
    }
  })

  it('gives the same block to everyone nearby, which is the cache and the privacy', () => {
    expect(blockOf(33.985, -118.472).key).toBe(blockOf(33.99, -118.48).key)
    expect(blockQuery(blockOf(33.985, -118.472).bbox)).not.toContain('33.985')
  })
})

describe('elementToSpot', () => {
  it('reads kit from the tags people actually write', () => {
    expect(elementToSpot(node(1, 34, -118, { leisure: 'fitness_station', fitness_station: 'horizontal_bar' })).kit).toEqual(['pull-up bar'])
    expect(elementToSpot(node(2, 34, -118, { leisure: 'fitness_station', fitness_station: 'parallel_bars;rings' })).kit).toEqual(['dip bars', 'rings'])
  })

  it('admits it does not know, instead of inventing kit', () => {
    for (const tags of [{ leisure: 'fitness_station' }, { leisure: 'fitness_station', fitness_station: 'yes' }, { leisure: 'fitness_station', fitness_station: 'balance_beam' }]) {
      expect(elementToSpot(node(3, 34, -118, tags))).toMatchObject({ kit: [], known: false, kind: 'station' })
    }
  })

  it('assumes the bars of a calisthenics park that lists nothing', () => {
    expect(elementToSpot(node(4, 34, -118, { sport: 'calisthenics' }))).toMatchObject({ kit: ['pull-up bar', 'dip bars'], known: true })
  })

  it('takes a way by its centre and leaves out a gym nobody lifts in', () => {
    expect(elementToSpot({ type: 'way', id: 5, center: { lat: 34, lon: -118 }, tags: { leisure: 'fitness_centre', name: "Gold's Gym" } })).toMatchObject({ kind: 'gym', name: "Gold's Gym", known: false })
    expect(elementToSpot(node(6, 34, -118, { leisure: 'fitness_centre', sport: 'pilates', name: 'The Studio' }))).toBeNull()
    expect(elementToSpot(node(7, 34, -118, { leisure: 'fitness_centre', name: 'StretchLab Yoga' }))).toBeNull()
    expect(elementToSpot({ type: 'way', id: 8, tags: { leisure: 'fitness_station' } })).toBeNull()
  })
})

describe('clusterSpots', () => {
  it('makes one place of a park mapped station by station', () => {
    const park = spotsFromAnswer({ elements: [
      node(1, 34.00000, -118.00000, { leisure: 'fitness_station', fitness_station: 'horizontal_bar' }),
      node(2, 34.00020, -118.00010, { leisure: 'fitness_station', fitness_station: 'parallel_bars', name: 'Penmar Park' }),
      node(3, 34.00030, -118.00020, { leisure: 'fitness_station' }),
    ] })
    expect(park).toHaveLength(1)
    expect(park[0]).toMatchObject({ name: 'Penmar Park', kit: ['pull-up bar', 'dip bars'], known: true, count: 3 })
  })

  it('keeps separate parks separate and never folds a gym into one', () => {
    const spots = clusterSpots([
      { id: 'a', lat: 34, lng: -118, kind: 'station', kit: [], known: false },
      { id: 'b', lat: 34.01, lng: -118, kind: 'station', kit: [], known: false },
      { id: 'c', lat: 34, lng: -118, kind: 'gym', kit: [], known: false },
    ])
    expect(spots.map(s => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts nearest first', () => {
    const spots = spotsFromAnswer({ elements: [node(1, 34.1, -118, { leisure: 'fitness_station' }), node(2, 34.001, -118, { leisure: 'fitness_station' })] }, { lat: 34, lng: -118 })
    expect(spots.map(s => s.id)).toEqual(['node/2', 'node/1'])
    expect(spots[0].distance).toBeLessThan(200)
  })
})

const ok = data => ({ ok: true, status: 200, json: async () => data })

describe('askOverpass', () => {
  it('moves on from a mirror that fails or sends junk, and takes the first good answer', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
      .mockResolvedValueOnce(ok({ remark: 'runtime error: out of memory', elements: [] }))
      .mockResolvedValueOnce(ok({ elements: [node(1, 34, -118, {})] }))
    const answer = await askOverpass('q', { mirrors: ['a', 'b', 'c'], fetcher, stagger: 0 })
    expect(answer.elements).toHaveLength(1)
  })

  it('does not bother the other mirrors when the first one answers', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({ elements: [] }))
    await askOverpass('q', { mirrors: ['a', 'b'], fetcher, stagger: 20 })
    await new Promise(r => setTimeout(r, 40))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('fails when every mirror does', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('down'))
    await expect(askOverpass('q', { mirrors: ['a', 'b'], fetcher, stagger: 0 })).rejects.toThrow()
  })

  it('gives up at the deadline', async () => {
    const fetcher = () => new Promise(() => {})
    await expect(askOverpass('q', { mirrors: ['a'], fetcher, stagger: 0, timeout: 10 })).rejects.toThrow('timeout')
  })
})

describe('loadSpots', () => {
  const memoryStore = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }
  const pos = { lat: 34, lng: -118 }
  const answer = { elements: [node(1, 34.001, -118, { leisure: 'fitness_station', fitness_station: 'rings', other: 'dropped' })] }

  it('asks once, then answers from the cache', async () => {
    const store = memoryStore(), ask = vi.fn().mockResolvedValue(answer)
    await loadSpots(pos, { store, ask, now: 1000 })
    const again = await loadSpots(pos, { store, ask, now: 2000 })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(again[0].kit).toEqual(['rings'])
  })

  it('asks again once the cache is old, and falls back to it when that fails', async () => {
    const store = memoryStore(), later = 15 * 24 * 3600e3
    await loadSpots(pos, { store, ask: async () => answer, now: 1000 })
    const fresh = vi.fn().mockRejectedValue(new Error('down'))
    const spots = await loadSpots(pos, { store, ask: fresh, now: later })
    expect(fresh).toHaveBeenCalledTimes(1)
    expect(spots).toHaveLength(1)
  })

  it('throws when there is nothing to show, so the screen can say so', async () => {
    await expect(loadSpots(pos, { store: memoryStore(), ask: async () => { throw new Error('down') } })).rejects.toThrow('down')
  })
})
