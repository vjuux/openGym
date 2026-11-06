// What a place has, in the words a person would use: "squat rack", "lat pulldown", "dip bars".
//
// The catalogue only knows coarse values: every machine is "leverage machine", every pulley is
// "cable". That is too blunt for "which of these can I do right here", so a place keeps this finer
// list, and `kitEquipment` folds it into the catalogue's values for the rest of the app (the
// library, the picker, a routine's missing-kit flags).
//
// This list is also the closed vocabulary the photo reader answers in (lib/gym-scan.js), so a hint
// says what the thing looks like. Adding a row means it can be detected; the library
// (lib/spot-session.js) decides what it unlocks.

const row = (id, group, equipment, hint) => Object.freeze({ id, group, equipment: Object.freeze(equipment), hint })

export const KIT = Object.freeze([
  row('pull-up bar', 'bars', ['pull-up bar'], 'a bar overhead to hang from: a wall-mounted bar, monkey bars, the top crossbar of a rack'),
  row('dip bars', 'bars', [], 'two parallel bars at about chest height, or a dip station'),
  row('low bar', 'bars', ['pull-up bar'], 'a fixed horizontal bar at waist height, for rows and incline push-ups'),
  row('rings', 'bars', ['suspension trainer', 'pull-up bar'], 'gymnastic rings hanging from straps'),
  row('suspension trainer', 'bars', ['suspension trainer', 'pull-up bar'], 'TRX-style straps with handles'),
  row('box', 'bars', [], 'a plyo box, low wall or solid steps to step onto'),

  row('dumbbells', 'free', ['dumbbell'], 'hand-held dumbbells, loose or on a rack'),
  row('barbell', 'free', ['barbell', 'olympic barbell', 'weight plate'], 'a long straight bar with plates'),
  row('squat rack', 'free', ['barbell'], 'a power rack, half rack or squat stands that hold a barbell at shoulder height'),
  row('bench', 'free', ['bench'], 'a flat or adjustable weight bench, or a sit-up bench'),
  row('ez bar', 'free', ['ez barbell'], 'a short curl bar with a zig-zag shape'),
  row('trap bar', 'free', ['trap bar'], 'a hexagonal deadlift bar'),
  row('kettlebells', 'free', ['kettlebell'], 'kettlebells'),
  row('landmine', 'free', ['landmine'], 'a pivot holding one end of a barbell on the floor'),

  row('cable station', 'cables', ['cable'], 'a pulley that moves up and down: a cable crossover, a functional trainer'),
  row('lat pulldown', 'cables', ['cable'], 'a seated station with a thigh pad and a long bar overhead on a cable'),
  row('cable row', 'cables', ['cable'], 'a seated low pulley with a foot plate'),

  row('leg press', 'machines', ['sled machine'], 'a sled or seat you push away with your feet'),
  row('hack squat', 'machines', ['sled machine'], 'an angled sled with shoulder pads'),
  row('leg extension', 'machines', ['leverage machine'], 'seated, with a roller pad in front of the shins'),
  row('leg curl', 'machines', ['leverage machine'], 'seated or lying, with a roller pad behind the ankles'),
  row('chest press', 'machines', ['leverage machine'], 'a seated machine with handles that press forward'),
  row('pec deck', 'machines', ['leverage machine'], 'a seated machine with arms that swing together'),
  row('shoulder press', 'machines', ['leverage machine'], 'a seated machine with handles that press overhead'),
  row('row machine', 'machines', ['leverage machine'], 'a seated weight machine with a chest pad and handles to pull (not a cardio rower)'),
  row('assisted pull-up', 'machines', ['leverage machine', 'assisted'], 'a machine with a knee pad or platform under high handles'),
  row('calf raise', 'machines', ['leverage machine'], 'a machine with shoulder or knee pads and a foot block'),
  row('back extension', 'machines', ['leverage machine'], 'a roman chair or 45 degree bench with ankle pads'),
  row('ab machine', 'machines', ['leverage machine'], 'a seated crunch machine'),
  row('smith machine', 'machines', ['smith machine'], 'a barbell fixed on vertical rails'),

  row('bands', 'small', ['band', 'resistance band'], 'elastic resistance bands'),
  row('ab wheel', 'small', ['wheel roller'], 'a small wheel with two handles'),
  row('medicine ball', 'small', ['medicine ball'], 'a heavy ball held in two hands'),
  row('stability ball', 'small', ['stability ball'], 'a large inflatable ball'),
])

export const KIT_IDS = Object.freeze(KIT.map(k => k.id))
const BY_ID = new Map(KIT.map(k => [k.id, k]))

/** Keeps known kit, in the list's own order, each once. */
export const cleanKit = kit => {
  const have = new Set(Array.isArray(kit) ? kit : [])
  return KIT_IDS.filter(id => have.has(id))
}

/** The catalogue's equipment values a place with this kit can use (lib/equipment.js eqAvailable). */
export const kitEquipment = kit => [...new Set(cleanKit(kit).flatMap(id => BY_ID.get(id).equipment))]

export const kitLabel = id => id.charAt(0).toUpperCase() + id.slice(1)
