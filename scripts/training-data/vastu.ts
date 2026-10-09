// Vastu guidance used for the chat examples: general questions and answers, and the
// preferred zones per room type for judging a plan. These are the common, widely-cited
// recommendations; edit them to match the Vastu tradition you want the model to follow.

export type Zone = 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west' | 'north-west' | 'centre';

// Preferred, acceptable and avoid zones per room type.
export const ROOM_ZONES: Record<string, { best: Zone[]; ok: Zone[]; avoid: Zone[]; why: string }> = {
  pooja: { best: ['north-east'], ok: ['east', 'north'], avoid: ['south', 'south-west', 'south-east'], why: 'the north-east (Ishanya) is the most sacred zone, governed by water and spiritual energy' },
  kitchen: { best: ['south-east'], ok: ['north-west'], avoid: ['north-east', 'south-west', 'centre'], why: 'the south-east (Agneya) is the fire zone, so cooking there is in harmony with Agni' },
  bed: { best: ['south-west'], ok: ['south', 'west'], avoid: ['north-east', 'south-east'], why: 'the south-west (Nairutya) gives stability and is ideal for the master bedroom' },
  living: { best: ['north', 'east', 'north-east'], ok: ['north-west'], avoid: ['south-west'], why: 'the north and east bring light and positive energy to the space where the family gathers' },
  toilet: { best: ['north-west', 'west'], ok: ['south'], avoid: ['north-east', 'centre', 'south-west'], why: 'the north-west and west suit waste disposal; a toilet in the north-east is a serious Vastu defect' },
  dining: { best: ['west'], ok: ['east', 'north', 'south-east'], avoid: ['south-west'], why: 'the west supports nourishment and a relaxed meal' },
  study: { best: ['west', 'north-east'], ok: ['north', 'east'], avoid: ['south-east'], why: 'the west and north-east help concentration and learning' },
  staircase: { best: ['south', 'west', 'south-west'], ok: ['north-west'], avoid: ['north-east', 'centre'], why: 'heavy structures belong in the south and west' },
  store: { best: ['south-west', 'north-west'], ok: ['south', 'west'], avoid: ['north-east'], why: 'heavy storage belongs in the south-west' },
  utility: { best: ['north-west'], ok: ['south-east', 'west'], avoid: ['north-east'], why: 'the north-west (Vayavya, air) suits washing and drying' },
  parking: { best: ['north-west', 'south-east'], ok: ['east', 'north'], avoid: ['south-west', 'north-east'], why: 'the north-west and south-east suit vehicles' },
  balcony: { best: ['north', 'east', 'north-east'], ok: ['north-west'], avoid: ['south-west'], why: 'open spaces should face north and east for light and air' },
};

export const TYPE_LABEL: Record<string, string> = {
  pooja: 'pooja room', kitchen: 'kitchen', bed: 'bedroom', living: 'living room', toilet: 'toilet', dining: 'dining room',
  study: 'study', staircase: 'staircase', store: 'store room', utility: 'utility area', parking: 'parking', balcony: 'balcony', hallway: 'hallway',
};

// General questions (several phrasings each) and answers.
export const VASTU_QA: { q: string[]; a: string }[] = [
  { q: ['Where should the pooja room be?', 'best place for a pooja room in vastu?', 'which direction is good for the prayer room'],
    a: 'The best place for the pooja room is the north-east (Ishanya) corner, the most sacred zone of the house. East or north are also good. Avoid the south, the south-west and placing it under a staircase or next to a toilet. Face east or north while praying.' },
  { q: ['Where should the kitchen be as per vastu?', 'best direction for kitchen', 'which corner is good for the kitchen'],
    a: 'The kitchen is best in the south-east (Agneya), the fire zone. If that is not possible, the north-west is the next choice. Avoid the north-east and the south-west. Ideally the cook faces east while cooking.' },
  { q: ['Where should the master bedroom be?', 'best direction for master bedroom', 'which side for the main bedroom'],
    a: 'The master bedroom is best in the south-west (Nairutya), which gives stability to the head of the family. South or west are acceptable. Avoid the north-east and the south-east. Sleep with your head towards the south or east.' },
  { q: ['Where should toilets be placed?', 'best place for bathroom in vastu', 'can I put a toilet in the north-east?'],
    a: 'Toilets are best in the north-west or west. The south is acceptable. Never place a toilet in the north-east or the centre of the house; both are considered serious Vastu defects.' },
  { q: ['Which direction should the main entrance face?', 'best direction for the main door', 'is a south facing entrance bad?'],
    a: 'North, east and north-east facing entrances are considered the most auspicious. A south or west facing entrance is not bad in itself; what matters is the exact position of the door along that wall (the entrance pada). Avoid placing the main door exactly in a corner.' },
  { q: ['What should be in the centre of the house?', 'what is brahmasthan', 'can I build a room in the centre?'],
    a: 'The centre of the house is the Brahmasthan. It should be kept open, light and clutter-free: no toilets, staircases, pillars or heavy walls there. A courtyard or open living area is ideal.' },
  { q: ['Where should the staircase be?', 'best place for stairs in vastu', 'staircase direction'],
    a: 'Staircases are best in the south, west or south-west, as heavy structures belong there. They should climb clockwise. Avoid the north-east and the centre of the house.' },
  { q: ['Where should the living room be?', 'best direction for the hall', 'living room vastu'],
    a: 'The living room is best in the north, east or north-east, where it gets morning light and positive energy. Keep heavy furniture along the south and west walls of the room.' },
  { q: ['Where should the dining room be?', 'dining area vastu direction'],
    a: 'The west is the best zone for the dining area. East or north are also fine. It works well next to the kitchen. Avoid the south-west.' },
  { q: ['Where should I put the study room?', 'best place for kids study room', 'study table direction'],
    a: 'A study is best in the west or north-east, which help concentration. Sit facing east or north while studying.' },
  { q: ['Which direction should the bed face?', 'which way should I sleep', 'head direction while sleeping'],
    a: 'Sleep with your head towards the south (best) or east. Avoid sleeping with your head towards the north.' },
  { q: ['Where should the car parking be?', 'garage direction vastu'],
    a: 'Parking is best in the north-west or south-east of the plot. Avoid the south-west and the north-east corners.' },
  { q: ['Where should water tanks go?', 'underground water tank vastu', 'overhead tank direction'],
    a: 'An underground water tank or borewell is best in the north-east. An overhead tank is best in the south-west, on top of the heaviest part of the house.' },
  { q: ['What does each direction mean in vastu?', 'explain the vastu zones', 'what are the 8 directions in vastu'],
    a: 'North (Kubera) is wealth, north-east (Ishanya) is spirituality and water, east (Indra) is health and growth, south-east (Agni) is fire, south (Yama) is stability, south-west (Nairutya) is strength and the head of the family, west (Varuna) is gains, and north-west (Vayu) is air and movement. The centre is the Brahmasthan and should stay open.' },
  { q: ['Is vastu important?', 'do I need to follow vastu strictly?', 'what if my house is not vastu compliant'],
    a: 'Vastu is a traditional guide for arranging spaces. Following the main points (pooja in the north-east, kitchen in the south-east, master bedroom in the south-west, an open centre, no toilet in the north-east) covers most of it. Where the plot does not allow it, there are accepted alternatives, and I can suggest them for your plan.' },
];
