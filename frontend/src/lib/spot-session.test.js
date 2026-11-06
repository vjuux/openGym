// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { EXIDX } from './exercises.js'
import { eqAvailable } from './equipment.js'
import { KIT_IDS, kitEquipment } from './kit.js'
import { FOCUS_IDS, MAX_EXERCISES, libraryRows, planFor, shortName, suggestSessions, swapItem, planRoutine } from './spot-session.js'
import { buildSessionEntries } from './session-start.js'

const FULL_GYM = KIT_IDS
const PLACES = {
  'nothing at all': [],
  'a bar in a park': ['pull-up bar'],
  'bar and dips': ['pull-up bar', 'dip bars'],
  'home dumbbells': ['dumbbells', 'bench'],
  'cables and machines': ['cable station', 'lat pulldown', 'cable row', 'leg press', 'chest press', 'leg curl'],
  'hotel bands': ['bands'],
  'full gym': FULL_GYM,
}

describe('the library', () => {
  it('names real exercises, never a form-check clip, and only kit that exists', () => {
    for (const [slot, id, needs] of libraryRows()) {
      expect(EXIDX[id], `${slot} ${id}`).toBeTruthy()
      expect(EXIDX[id].n).not.toMatch(/form check/)
      for (const n of needs) expect(KIT_IDS, `${id} needs ${n}`).toContain(n)
    }
  })

  it('agrees with the catalogue: the kit a row names passes the app-wide equipment filter', () => {
    for (const [slot, id, needs] of libraryRows()) {
      expect(eqAvailable(kitEquipment(needs), EXIDX[id]), `${slot}: ${EXIDX[id].n} with ${needs}`).toBe(true)
    }
  })
})

describe('planFor', () => {
  it('never prescribes what the place lacks', () => {
    const park = planFor('pull', ['pull-up bar', 'dip bars'])
    expect(park.items.map(i => EXIDX[i.id].n)).toEqual(['pull-up', 'chin-up', 'hanging leg raise'])
    const dbs = planFor('push', ['dumbbells', 'bench']).items.map(i => EXIDX[i.id].eq)
    expect(dbs.every(e => e === 'dumbbell' || e === 'body weight')).toBe(true)
  })

  it('offers nothing it cannot carry', () => {
    expect(planFor('pull', [])).toBeNull()
    expect(planFor('pull', ['dip bars'])).toBeNull()
  })

  it('always has a bodyweight session, and never repeats or overfills one', () => {
    expect(planFor('full', [])).not.toBeNull()
    for (const kit of Object.values(PLACES)) {
      for (const f of FOCUS_IDS) {
        const ids = planFor(f, kit)?.items.map(i => i.id) || []
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.length).toBeLessThanOrEqual(MAX_EXERCISES)
      }
    }
  })

  it('reaches for what you already do before what the list ranks first', () => {
    const kit = ['pull-up bar', 'lat pulldown']
    expect(planFor('pull', kit).items[0].id).toBe('0652')
    expect(planFor('pull', kit, { logged: { 2330: 12 } }).items[0].id).toBe('2330')
  })

  it('times a hold and counts both sides of a one-sided lift', () => {
    const plank = planFor('full', []).items.find(i => i.id === '0463')
    expect(plank.cfg).toMatchObject({ mode: 'time', sec: 40 })
    expect(planFor('legs', []).items.find(i => i.id === '0612').cfg.reps).toBeGreaterThanOrEqual(10)
  })
})

describe('swapping', () => {
  it('moves to the next exercise of the same pattern and stays within the kit', () => {
    const kit = ['barbell', 'bench', 'dumbbells']
    const plan = planFor('push', kit)
    expect(plan.items[0].id).toBe('0025')
    const swapped = swapItem(plan, 0, kit)
    expect(swapped.items[0].id).toBe('0289')
    expect(swapped.items[0].slot).toBe('hPush')
  })

  it('leaves the plan alone when nothing else fits', () => {
    const plan = planFor('pull', ['pull-up bar'])
    const last = plan.items.findIndex(i => i.id === '0472')
    expect(swapItem(plan, last, ['pull-up bar']).items[last].id).toBe('0463')
    const none = swapItem(plan, 99, ['pull-up bar'])
    expect(none).toBe(plan)
  })
})

describe('suggestSessions', () => {
  const NOW = Date.parse('2026-11-04T18:00:00Z')
  const yesterday = id => ({
    id: 'w1', d: '2026-11-03', start: NOW - 24 * 3600e3, end: NOW - 23 * 3600e3,
    entries: [{ id, mode: 'reps', sets: Array.from({ length: 12 }, () => ({ w: 60, r: 10, done: true })) }],
  })

  it('starts someone with no history on the fullest session the kit allows', () => {
    expect(suggestSessions(FULL_GYM, { now: NOW }).focus).toBe('full')
    expect(suggestSessions([], { now: NOW }).focus).toBe('full')
  })

  it('does not send yesterday\'s chest back to the bench', () => {
    const fresh = suggestSessions(FULL_GYM, { now: NOW })
    const after = suggestSessions(FULL_GYM, { now: NOW, workouts: [yesterday('0025')] })
    expect(fresh.plans.push).toBeTruthy()
    expect(['pull', 'legs']).toContain(after.focus)
  })

  it('only lists sessions the kit can carry', () => {
    const { plans } = suggestSessions(['dip bars'], { now: NOW })
    expect(plans.pull).toBeUndefined()
    expect(plans.push).toBeTruthy()
  })
})

describe('shortName', () => {
  it('keeps the movement and drops the fine print', () => {
    expect(shortName('Cable Lat Pulldown Full Range Of Motion')).toBe('Cable Lat Pulldown')
    expect(shortName('Glute Bridge Two Legs On Floor')).toBe('Glute Bridge')
    expect(shortName('Cable Triceps Pushdown (V-bar)')).toBe('Cable Triceps Pushdown')
    expect(shortName('Push-Up')).toBe('Push-Up')
  })
})

describe('starting', () => {
  it('builds real session entries through the normal engine', () => {
    const plan = planFor('pull', ['pull-up bar', 'dumbbells'])
    const entries = buildSessionEntries({ workouts: [], routines: [], unit: 'kg' }, planRoutine(plan, 'Pull'))
    expect(entries.map(e => e.id)).toEqual(plan.items.map(i => i.id))
    expect(entries.every(e => e.sets.length === 3)).toBe(true)
  })
})
