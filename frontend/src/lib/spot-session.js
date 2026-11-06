// What to train here. Given a place's kit and what you have done lately, one session: no search,
// no thousands of exercises. Pure, like the rest of lib/; the screen only renders the answer.
//
// The library is hand-picked on purpose. The catalogue has 5,632 exercises, most of them variations
// ("barbell bench press against chains", "form check" clips), so no filter over it gives a good
// session. Here every movement pattern lists the few exercises worth doing, best first. Sets and
// weights still come from the normal engine (lib/session-start.js), so progression keeps working.
//
// ponytail: about 90 exercises by hand. When a pattern feels thin, add a row; a test checks each id.
import { pickedExerciseConfig } from './history.js'
import { fatigueOf } from './recovery.js'

// [exercise id, kit it needs, reps or seconds]. Each role has its own default; a number overrides it.
const SLOTS = {
  hPush: { role: 'main', options: [
    ['0025', ['barbell', 'bench']], // barbell bench press
    ['0289', ['dumbbells', 'bench']], // dumbbell bench press
    ['0577', ['chest press']],
    ['0748', ['smith machine', 'bench']],
    ['0251', ['dip bars']], // chest dip
    ['5738', ['suspension trainer'], 10],
    ['3359', ['cable station'], 10],
    ['3780', ['bands'], 12],
    ['0662', [], 12], // push-up
  ] },
  vPush: { role: 'assist', options: [
    ['1162', ['barbell', 'squat rack'], 8],
    ['0426', ['dumbbells']], // dumbbell standing overhead press
    ['0603', ['shoulder press']],
    ['0766', ['smith machine']],
    ['0553', ['kettlebells']],
    ['0997', ['bands'], 12],
    ['2921', [], 8], // pike push-up
  ] },
  triceps: { role: 'iso', options: [
    ['0241', ['cable station']], // pushdown
    ['0814', ['dip bars'], 10], // triceps dip
    ['0060', ['barbell', 'bench']], // skull crusher
    ['0333', ['dumbbells']], // kickback
    ['1502', ['bands'], 15],
    ['0283', [], 10], // diamond push-up
  ] },
  chestIso: { role: 'iso', options: [
    ['1030', ['pec deck']],
    ['0227', ['cable station']], // cable standing fly
    ['0308', ['dumbbells', 'bench']],
  ] },
  sideDelt: { role: 'iso', options: [
    ['0334', ['dumbbells']],
    ['0178', ['cable station']],
    ['0907', ['bands'], 15],
  ] },
  vPull: { role: 'main', options: [
    ['0652', ['pull-up bar'], 6], // pull-up
    ['2330', ['lat pulldown'], 10],
    ['0198', ['cable station'], 10],
    ['0572', ['assisted pull-up'], 8],
    ['5522', ['rings'], 6],
    ['1088', ['suspension trainer'], 6],
    ['4358', ['bands'], 12],
  ] },
  vPull2: { role: 'assist', options: [
    ['1326', ['pull-up bar'], 6], // chin-up
    ['0245', ['lat pulldown'], 10], // underhand pulldown
    ['0651', ['pull-up bar'], 6], // neutral grip
    ['0238', ['cable station'], 12], // straight arm pulldown
  ] },
  hPull: { role: 'main', options: [
    ['0027', ['barbell']], // bent over row
    ['0861', ['cable row'], 10],
    ['1350', ['row machine'], 10],
    ['0292', ['dumbbells'], 10], // one arm row
    ['1359', ['smith machine']],
    ['0234', ['cable station'], 10],
    ['0499', ['low bar'], 10], // inverted row
    ['0498', ['rings'], 10],
    ['1080', ['suspension trainer'], 10],
    ['3896', ['bands'], 12],
  ] },
  rearDelt: { role: 'iso', options: [
    ['5656', ['cable station'], 15], // face pull
    ['0383', ['dumbbells']], // reverse fly
    ['6252', ['rings']],
    ['1113', ['suspension trainer']],
    ['1503', ['bands'], 15], // pull apart
  ] },
  biceps: { role: 'iso', options: [
    ['0031', ['barbell']],
    ['0294', ['dumbbells']],
    ['0868', ['cable station']],
    ['0447', ['ez bar']],
    ['6234', ['rings']],
    ['6232', ['suspension trainer']],
    ['4063', ['bands'], 15],
  ] },
  squat: { role: 'main', options: [
    ['0043', ['barbell', 'squat rack']],
    ['0739', ['leg press'], 10],
    ['0743', ['hack squat'], 10],
    ['0770', ['smith machine']],
    ['1760', ['dumbbells'], 10], // goblet squat
    ['0534', ['kettlebells'], 10],
    ['1004', ['bands'], 15],
    ['1197', [], 15], // squat
  ] },
  hinge: { role: 'main', options: [
    ['0085', ['barbell']], // romanian deadlift
    ['0811', ['trap bar']],
    ['1459', ['dumbbells'], 10],
    ['0599', ['leg curl'], 10],
    ['0549', ['kettlebells'], 15], // swing
    ['1206', ['cable station'], 12],
    ['0573', ['back extension'], 12],
    ['4618', ['bands'], 15],
    ['2471', [], 15], // glute bridge
  ] },
  singleLeg: { role: 'assist', options: [
    ['2290', ['dumbbells', 'bench'], 8], // bulgarian split squat
    ['0336', ['dumbbells'], 8],
    ['0054', ['barbell', 'squat rack'], 8],
    ['0801', ['box'], 10], // step up
    ['9490', ['bench'], 10], // step up on box
    ['0612', [], 10], // lunge
  ] },
  quadIso: { role: 'iso', options: [
    ['0585', ['leg extension']],
    ['1460', [], 12], // walking lunge
  ] },
  calves: { role: 'iso', options: [
    ['0605', ['calf raise'], 15],
    ['0738', ['leg press'], 15],
    ['1050', ['smith machine'], 15],
    ['3018', [], 20],
  ] },
  core: { role: 'iso', options: [
    ['0472', ['pull-up bar'], 10], // hanging leg raise
    ['0175', ['cable station'], 15], // kneeling crunch
    ['0857', ['ab wheel'], 10],
    ['1452', ['ab machine'], 15],
    ['0463', [], 40], // front plank, seconds: a catalogue hold
  ] },
}

/** Every [slot, id, needs] in the library, for the test that holds it to the catalogue. */
export const libraryRows = () => Object.entries(SLOTS).flatMap(([slot, s]) => s.options.map(([id, needs]) => [slot, id, needs]))

const ROLE = { main: { sets: 3, reps: 8 }, assist: { sets: 3, reps: 10 }, iso: { sets: 3, reps: 12 } }

export const MAX_EXERCISES = 5

export const FOCI = Object.freeze({
  full: { label: 'Full body', muscles: ['quadriceps', 'gluteal', 'chest', 'upper-back', 'deltoids'], slots: ['squat', 'hPush', 'vPull', 'hinge', 'hPull', 'core'] },
  push: { label: 'Push', muscles: ['chest', 'deltoids', 'triceps'], slots: ['hPush', 'vPush', 'triceps', 'chestIso', 'sideDelt', 'core'] },
  pull: { label: 'Pull', muscles: ['upper-back', 'biceps', 'trapezius'], slots: ['vPull', 'hPull', 'vPull2', 'rearDelt', 'biceps', 'core'] },
  legs: { label: 'Legs', muscles: ['quadriceps', 'hamstring', 'gluteal', 'calves'], slots: ['squat', 'hinge', 'singleLeg', 'quadIso', 'calves', 'core'] },
})
export const FOCUS_IDS = Object.freeze(Object.keys(FOCI))

const canDo = (needs, have) => needs.every(n => have.has(n))

// How often each exercise was logged: what you already do comes before what a list ranks first, so
// someone who always pulls down at the lat machine is not sent to the bar they skip.
export function loggedCounts(workouts = []) {
  const n = {}
  for (const w of workouts) for (const e of w?.entries || []) if (e?.id) n[e.id] = (n[e.id] || 0) + 1
  return n
}

// A slot's exercises usable with this kit: logged ones first, most logged first, then library order.
function usable(slot, have, logged) {
  const at = new Map(SLOTS[slot].options.map((o, i) => [o[0], i]))
  return SLOTS[slot].options
    .filter(o => canDo(o[1], have))
    .sort((a, b) => (logged[b[0]] || 0) - (logged[a[0]] || 0) || at.get(a[0]) - at.get(b[0]))
}

function itemOf(slot, option) {
  const [id, , amount] = option
  const { sets, reps } = ROLE[SLOTS[slot].role]
  const cfg = pickedExerciseConfig(id)
  if (cfg.mode === 'time') return { slot, id, cfg: { ...cfg, sets, sec: amount ?? 40 } }
  const want = amount ?? reps
  // Per-side reps are both sides' total (lib/history.js pickedExerciseConfig).
  return { slot, id, cfg: { ...cfg, sets, reps: cfg.side ? want * 2 : want } }
}

/**
 * One focus's session for this kit: the first exercise of each slot that has one, never the same
 * exercise twice, at most MAX_EXERCISES. Null when the kit cannot carry it: a pull day needs two
 * pulling movements, core does not count.
 */
export function planFor(focus, kit, { logged = {} } = {}) {
  const f = FOCI[focus]
  if (!f) return null
  const have = new Set(kit)
  const taken = new Set()
  const items = []
  for (const slot of f.slots) {
    if (items.length >= MAX_EXERCISES) break
    const pick = usable(slot, have, logged).find(o => !taken.has(o[0]))
    if (!pick) continue
    taken.add(pick[0])
    items.push(itemOf(slot, pick))
  }
  if (items.filter(i => i.slot !== 'core').length < 2) return null
  return { focus, label: f.label, items, minutes: minutesOf(items) }
}

/** What else fits this exercise's slot here, for the tap that swaps it. Never one already in the plan. */
export function swapsFor(plan, slot, kit, { logged = {} } = {}) {
  const taken = new Set(plan.items.map(i => i.id))
  return usable(slot, new Set(kit), logged).filter(o => !taken.has(o[0])).map(o => itemOf(slot, o))
}

/** The next exercise for that row, in place. The plan unchanged when there is no other. */
export function swapItem(plan, index, kit, opts) {
  const item = plan.items[index]
  const next = item && swapsFor(plan, item.slot, kit, opts)[0]
  if (!next) return plan
  const items = plan.items.map((it, i) => (i === index ? next : it))
  return { ...plan, items, minutes: minutesOf(items) }
}

// About two and a half minutes a set, rest included, to the nearest five.
const minutesOf = items => Math.max(5, Math.round(items.reduce((n, i) => n + i.cfg.sets * 2.5, 0) / 5) * 5)

const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0))

/**
 * All the sessions this kit can carry and the one to offer: the one whose muscles are freshest. A
 * plan with under three exercises is marked down, since it is barely a session. Ties keep FOCI's
 * order, full body first, which is the right start with no history, and yesterday's chest makes
 * push and full body lose to pull and legs.
 */
export function suggestSessions(kit, { workouts = [], now = Date.now() } = {}) {
  const logged = loggedCounts(workouts)
  const fatigue = fatigueOf(workouts, now)
  const plans = {}
  let best = null, bestScore = -1
  for (const focus of FOCUS_IDS) {
    const plan = planFor(focus, kit, { logged })
    if (!plan) continue
    plans[focus] = plan
    const m = FOCI[focus].muscles
    const fresh = 1 - m.reduce((sum, slug) => sum + clamp01(fatigue[slug]), 0) / m.length
    const score = fresh * Math.min(1, plan.items.length / 3)
    if (score > bestScore + 1e-9) { best = focus; bestScore = score }
  }
  return { focus: best, plans }
}

// Catalogue names can run long ("cable lat pulldown full range of motion"). A row on this screen
// needs the movement, not the camera angle.
const NAME_TAIL = /\s*(\(.*\)|two legs on floor|full range of motion)\s*$/i
export const shortName = name => String(name || '').replace(NAME_TAIL, '')

/** The routine-shaped object lib/session-start.js builds a session from. */
export const planRoutine = (plan, name) => ({ id: '', name, ex: plan.items.map(i => ({ id: i.id, ...i.cfg })) })
