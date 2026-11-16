// What the loaded save's journal says, for Chooms! (docs/design.md, "C2 spike" and "C2 plan"):
// V's lifepath and body, the story points V has passed, who V has met and who has died. Reads
// only (Get and Is functions), a few hundred calls: the story points by their paths, the codex's
// characters, the contacts. Nothing from the game is kept between reads but this summary.

const SEEN = { inactive: false, active: true, succeeded: true, failed: true };
const EVERY = { inactive: true, active: true, succeeded: true, failed: true };
const KINDS = { quest: 'gameJournalQuest', phase: 'gameJournalQuestPhase', objective: 'gameJournalQuestObjective' };
const STARTED = new Set(['Active', 'Succeeded', 'Failed']);

/** Runs `fn` on each item, `n` at a time: the calls go to the game one round trip each. */
async function each(items, fn, n = 16) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/**
 * Reads the summary. `story` is story.json, `roster` roster.json's accounts. Throws what the game
 * throws: REDnode refuses calls while V is not in the world.
 */
export async function readStory({ api, game, story, roster }) {
  const t0 = Date.now();
  let calls = 0;
  const call = (p) => (calls++, p);
  const jm = await call(api.GameInstance.GetJournalManager(game.instance));
  if (!jm) throw new Error('No journal: load a save first.');
  const kids = async (e) => (await call(jm.GetChildren(e, SEEN, []))).out.childEntries.filter(Boolean);
  const stateOf = async (path, kind = 'quest') => {
    const e = await call(jm.GetEntryByString(path, KINDS[kind] ?? kind));
    if (!e) return { state: null, e: null };
    return { state: String(await call(jm.GetEntryState(e))), e };
  };

  // The story points, by their paths.
  const points = {};
  await each(story.points, async (p) => {
    const { state, e } = await stateOf(p.path, p.kind);
    const passed = p.when === 'started' ? STARTED.has(state) : state === 'Succeeded';
    if (passed) points[p.id] = (await call(jm.GetEntryTimestamp(e)))?.seconds ?? 0;
  });

  // The lifepath: the prologue quest V finished.
  let lifepath = null;
  for (const [name, path] of Object.entries(story.lifepaths ?? {})) {
    if ((await stateOf(path)).state === 'Succeeded') {
      lifepath = name;
      break;
    }
  }

  // The codex's characters: every entry V has unlocked, in each characters category (the base
  // game's and Phantom Liberty's).
  const codex = new Set();
  const cats = (await call(jm.GetCodexCategories({ stateFilter: SEEN }, []))).out.entries.filter(Boolean);
  const catIds = await each(cats, (c) => call(c.GetId()));
  for (const [i, cat] of cats.entries()) {
    if (catIds[i] !== 'characters') continue;
    const entries = (await each(await kids(cat), kids)).flat();
    for (const id of await each(entries, (e) => call(e.GetId()))) codex.add(String(id));
  }
  // V's own entry names the body: v_<lifepath>_<m or f>.
  const vEntry = [...codex].find((id) => /^v_[a-z_]+_(m|f)$/.test(id));
  const body = vEntry ? (vEntry.endsWith('_f') ? 'feminine' : 'masculine') : null;

  // The contacts V knows.
  const wanted = new Set(roster.flatMap((a) => [...(a.game?.contacts ?? []), ...(a.game?.dead ?? []).map((d) => d.contact)]).filter(Boolean));
  const contacts = new Set();
  const list = (await call(jm.GetContacts({ stateFilter: EVERY }, []))).out.entries.filter(Boolean);
  await each(list, async (c) => {
    const id = String(await call(c.GetId()));
    if (wanted.has(id) && (await call(c.IsKnown(jm)))) contacts.add(id);
  });

  const met = [];
  const dead = [];
  for (const a of roster) {
    const g = a.game;
    if (!g) continue;
    if (g.codex?.some((id) => codex.has(id)) || g.contacts?.some((id) => contacts.has(id))) met.push(a.id);
    if (g.dead?.some((d) => (d.contact && contacts.has(d.contact)) || (d.point && d.point in points))) dead.push(a.id);
  }
  return { lifepath, body, points, met, dead, calls, ms: Date.now() - t0 };
}
