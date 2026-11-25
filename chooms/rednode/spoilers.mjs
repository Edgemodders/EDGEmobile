// Chooms!'s word check against spoilers (docs/design.md, "C3 plan": the spoiler check). Each
// story point has words: the names of people, places and things in its knowledge cards and its
// note in story.json. A post that names a word of a point the save has not passed, and of no
// point it has, is thrown away. Words everyone knows from the start (the start cards, the
// accounts' names, bios and districts) never count. A cheap model reads each post as well
// (posts.mjs), since a leak need not name anything.

// Capitalised words that are only English, not names.
const COMMON = new Set(`A An And As At Be But By For From Her His How If In Into Is It Its Me My No Not Now Of On One Or Our She So That The Their Them Then There They This Those To Too Up We What When Where Which Who Why With You Your
  Knows Feels Posts After Before Once Some Most More Many Much Every Each All Any Both Either Neither Nothing Someone Something Everyone Everything Anyone
  Mr Mrs Ms Dr Yes Yeah Okay Ok Hey Oh Just Still Even Only Also Again Here Today Tonight Tomorrow Yesterday Never Always
  Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December`.split(/\s+/));

const WORD = /\b[A-Z][A-Za-z]*(?:['-][A-Za-z]+)*/g;

/**
 * The capitalised words of a text that may be names (three letters or more, not COMMON). With
 * `midOnly`, only those inside a sentence: a card's "Feels: Worried" is no name. Posts are checked
 * on every word, so "Takemura's here." still counts.
 */
export function namesIn(text, { midOnly = false } = {}) {
  const t = String(text ?? '');
  const out = new Set();
  for (const m of t.matchAll(WORD)) {
    const w = m[0].replace(/'s$/, '');
    if (w.length < 3 || COMMON.has(w)) continue;
    if (midOnly) {
      const before = t.slice(0, m.index).replace(/["'(\s]+$/, '');
      if (!before || /[.!?:;\n]$/.test(before)) continue;
    }
    out.add(w);
  }
  return out;
}

/**
 * The words of each story point. `cards` is loadCards()'s map, `story` story.json, `roster`
 * roster.json's accounts. Returns { byPoint: Map(point -> Set), known: Set } where known are
 * the words that never count.
 */
export function spoilerWords({ cards, story, roster }) {
  const known = new Set();
  // Every capitalised word of what is known from the start; only the names of a point's own text.
  const add = (set, text) => namesIn(text, { midOnly: set !== known }).forEach((w) => set.add(w));
  for (const a of roster) for (const t of [a.name, a.handle, a.tag, a.bio, a.home, ...(a.districts ?? [])]) add(known, t);
  for (const own of cards.values()) if (own.has('start')) add(known, own.get('start'));
  for (const t of ['Night City', 'Chooms', 'Watson Westbrook Heywood Pacifica Badlands Dogtown', 'Santo Domingo City Center', 'NCPD Net']) add(known, t);
  const byPoint = new Map();
  for (const p of story.points) {
    const set = new Set();
    add(set, p.note);
    for (const own of cards.values()) if (own.has(p.id)) add(set, own.get(p.id));
    // Names no card uses but the model knows from the game (story.json's `words`).
    for (const w of p.words ?? []) set.add(w);
    for (const w of known) set.delete(w);
    byPoint.set(p.id, set);
  }
  return { byPoint, known };
}

/** The words a save may not name: those of the points not passed, less those of the points passed. */
export function forbiddenFor({ byPoint }, passed) {
  const allowed = new Set();
  const out = new Set();
  for (const [id, words] of byPoint) for (const w of words) (id in (passed ?? {}) ? allowed : out).add(w);
  for (const w of allowed) out.delete(w);
  return out;
}

/** The forbidden words a text names, as written or in capitals. */
export function leaks(text, forbidden) {
  const t = String(text ?? '');
  const found = [];
  for (const w of namesIn(t.replace(/\b[A-Z]{3,}\b/g, (x) => x[0] + x.slice(1).toLowerCase()))) if (forbidden.has(w)) found.push(w);
  return found;
}
