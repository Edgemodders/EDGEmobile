// Chooms!'s Node mod (docs/design.md, "Chooms!" and "C1 plan"): the accounts, the history of each
// playthrough, the settings and their images, and the answers its mobile app gets through
// EDGEmobile (service.mjs). C3: people, corporations and gangs post by themselves (posts.mjs).

import { agent, api, channel, game, pkg, quests, service } from 'rednode';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { cardsFor, loadCards } from './cards.mjs';
import { readStory } from './journal.mjs';
import { DISTRICTS, Ledger, Poster, grownLikes, placeName } from './posts.mjs';
import { Store, isOrg } from './store.mjs';

const roster = JSON.parse(readFileSync(join(pkg.dir, 'roster.json'), 'utf8')).accounts;
const seed = JSON.parse(readFileSync(join(pkg.dir, 'seed.json'), 'utf8'));
const story = JSON.parse(readFileSync(join(pkg.dir, 'story.json'), 'utf8'));
// The knowledge cards (cards/README.md). A broken card is logged and the cards left out, so
// Chooms! still runs; the offline tests stop such a card before it is released.
let cards = new Map();
try {
  cards = loadCards(join(pkg.dir, 'cards'), { story, roster });
} catch (err) {
  console.log(`The knowledge cards could not be read: ${err.message}`);
}
const STORY_MS = 3 * 60 * 1000;
const byId = new Map(roster.map((a) => [a.id, a]));
const PEOPLE = roster.filter((a) => !isOrg(a));
const PLAYTHROUGH_FACT = 'chooms_playthrough';
const NOW_MS = 5000;

mkdirSync(pkg.dataDir, { recursive: true });
const store = new Store({ dir: join(pkg.dataDir, 'playthroughs'), roster });

// --- Settings (the window on the PC; used from C3 on) ----------------------------------------

const settingsFile = join(pkg.dataDir, 'settings.json');
const DEFAULTS = {
  on: true,
  everyMinutes: 10,
  peopleChance: 30,
  corpChance: 20,
  maxPerCheck: 2,
  weightText: 40,
  weightSelfie: 45,
  weightActivity: 15,
  postModel: 'sonnet',
  dmModel: 'opus',
  dailyCapUsd: 2, // the owner's choice for now (2026-11-25), to be tuned after play testing
  // C3: one gang of V's district may post per check, with this chance; NPCs' comments per check;
  // a cheap model reads each answer for spoilers as well as the word check.
  gangChance: 10,
  maxCommentsPerCheck: 2,
  secondCheck: true,
};
let settings = { general: { ...DEFAULTS }, people: {} };
try {
  const s = JSON.parse(readFileSync(settingsFile, 'utf8'));
  settings = { general: { ...DEFAULTS, ...s.general }, people: s.people ?? {}, folder: typeof s.folder === 'string' ? s.folder : null };
  // Settings saved before 0.2.0 (which first saves secondCheck) hold a cap that did nothing then:
  // it takes the new default.
  if (s.general && !('secondCheck' in s.general)) settings.general.dailyCapUsd = DEFAULTS.dailyCapUsd;
} catch {
  // first start
}
const person = (id) => (settings.people[id] ??= { on: true, images: true, portrait: null, body: null, settings: [] });
// A person's one-of images: the portrait (their face, their picture in the app) and the body
// (head to toe, for photos of them doing something at a place). Places are a list.
const SINGLE = ['portrait', 'body'];
const KINDS = [...SINGLE, 'setting'];
function saveSettings() {
  writeFileSync(`${settingsFile}.tmp`, JSON.stringify(settings, null, 2));
  renameSync(`${settingsFile}.tmp`, settingsFile);
}

// --- Bundled pictures and places (content/, made by tools/chooms/export-content.mjs) -----------
// Each person's portrait, body image and places as Chooms! ships them. They are copied into the
// player's own folder the first time and are then the player's to change. `applied` keeps what
// was copied, so a place the player removed does not come back, and an update that brings new
// pictures adds only those. A bundled file is named by a hash of the image, so a place the
// player already has (the author's own, exported) is not added twice.

const CONTENT_DIR = join(pkg.dir, 'content');
let content = { people: {} };
try {
  content = JSON.parse(readFileSync(join(CONTENT_DIR, 'content.json'), 'utf8'));
} catch {
  // no bundled pictures
}
const hashOf = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);

function copyDefault(rel) {
  const to = join(pkg.dataDir, rel);
  if (!existsSync(to)) {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(CONTENT_DIR, rel), to);
  }
  return rel;
}

// Adds what the bundled content has for a person that the player has not had yet. Returns
// whether anything changed.
function applyDefaults(id) {
  const c = content.people?.[id];
  if (!c) return false;
  const p = person(id);
  p.from ??= {};
  p.applied ??= { places: [] };
  let changed = false;
  for (const kind of SINGLE) {
    const rel = c[kind];
    if (!rel || p.applied[kind] === rel || !existsSync(join(CONTENT_DIR, rel))) continue;
    // The player's own image stays; an earlier default gives way to the new one.
    if (!p[kind] || p.from[kind]) {
      if (p.from[kind]) removeFile(p[kind]);
      p[kind] = copyDefault(rel);
      p.from[kind] = rel;
    }
    p.applied[kind] = rel;
    changed = true;
  }
  for (const place of c.places ?? []) {
    if (p.applied.places.includes(place.file) || !existsSync(join(CONTENT_DIR, place.file))) continue;
    p.applied.places.push(place.file);
    changed = true;
    const hash = basename(place.file).split('.')[0];
    if (p.settings.some((s) => existsSync(join(pkg.dataDir, s.file)) && hashOf(join(pkg.dataDir, s.file)) === hash)) continue;
    p.settings.push({ file: copyDefault(place.file), description: String(place.description ?? ''), activities: (place.activities ?? []).map(String) });
  }
  return changed;
}
if (PEOPLE.map((a) => applyDefaults(a.id)).some(Boolean)) saveSettings();

// --- The game: the playthrough and its time ---------------------------------------------------
// Only while V is in the world (REDnode's game.state().world): calls into the game's world before
// V exists crashed it (EDGEmobile, 2026-10-29). A load can start between two calls; REDnode then
// refuses the next one, which only means the world went away.

let inWorld = false;
let gameNow = {}; // the last game.state(): menu, scene, photo mode
const NO_WORLD = /not in the world yet/i;

async function gameSeconds() {
  const time = await api.GameInstance.GetTimeSystem(game.instance);
  return (await time.GetGameTime()).seconds;
}

/**
 * The playthrough's id, kept in a game fact, which the game saves with the playthrough: every
 * save of it reads the same id back (*unverified* that REDnode's facts are saved: the C2 spike).
 */
async function playthroughId() {
  let id = await quests.fact(PLAYTHROUGH_FACT);
  if (!id) {
    id = randomInt(1, 2 ** 31 - 1);
    await quests.setFact(PLAYTHROUGH_FACT, id);
    console.log(`A new playthrough: ${id}`);
  }
  return id;
}

let reading = false;
// When the journal was last read; 0 asks for a read (V arrived in the world: a load).
let storyAt = 0;
async function readGame() {
  if (!inWorld || reading) return;
  reading = true;
  try {
    const pid = await playthroughId();
    const now = await gameSeconds();
    if (!inWorld) return;
    const opened = store.open(String(pid), now, seed);
    const dropped = store.setNow(now);
    if (opened) console.log(`Playthrough ${pid}: history open`);
    if (dropped) console.log('An older save: what came after it is dropped');
    // The save's story: who V has met, who has died, the story points. Read before the app is
    // told, so a load does not show the feed of whoever was met in the save before it.
    let told = false;
    if (opened || dropped || !storyAt || Date.now() - storyAt > STORY_MS) {
      let s = null;
      try {
        s = await readStory({ api, game, story, roster });
      } catch (err) {
        if (NO_WORLD.test(err?.message ?? '')) throw err;
        // Tried again with the next read, in STORY_MS; the feed shows meanwhile.
        console.log(`Could not read the journal: ${err?.message ?? err}`);
      }
      if (!inWorld) return;
      const load = opened || dropped || !storyAt;
      storyAt = Date.now();
      if (s && store.setStory(s)) told = true;
      // Logged on each load, and when the story moved on between loads.
      if (s && (told || load)) {
        console.log(`The story: ${s.lifepath ?? 'lifepath unknown'}, ${s.body ?? 'body unknown'}, ${Object.keys(s.points).length} of ${story.points.length} story points, met ${s.met.length}${s.dead.length ? `, gone: ${s.dead.join(', ')}` : ''} (${s.calls} calls, ${(s.ms / 1000).toFixed(1)} s)`);
      }
    }
    // The window and the app, whenever the playthrough, its time or its story changed: a switch
    // back to a playthrough whose story is as it was still changes what the window shows.
    if (opened || dropped || told) {
      if (told) poster.social();
      channel.post(windowState());
      channel.post(postingState());
      changed();
    }
  } catch (err) {
    // A load started between two calls: the world went away; onState brings V back.
    if (NO_WORLD.test(err?.message ?? '')) inWorld = false;
    else console.log(`Could not read the game: ${err?.message ?? err}`);
  } finally {
    reading = false;
  }
}

function onGameState(s) {
  gameNow = s ?? {};
  const now = !!(s.connected && s.world);
  if (now === inWorld) return;
  inWorld = now;
  if (inWorld) {
    storyAt = 0;
    nextCheckAt = 0; // the first check comes a full interval after V arrives
    readGame();
  }
  channel.post(postingState());
}
game.onState(onGameState);
game.state().then(onGameState, () => {});
let ticks = 0;
setInterval(() => {
  readGame();
  maybeCheck();
  poster.tick();
  // The window's countdown to the next check.
  if (++ticks % 6 === 0) channel.post(postingState());
}, NOW_MS);

// --- Events to the app ------------------------------------------------------------------------

function changed() {
  service.emit('mobile', { event: 'changed' });
  service.emit('mobile', { event: 'badge', data: { count: store.unseen() } });
}

// --- Posts by themselves (C3, posts.mjs) -------------------------------------------------------
// Every everyMinutes, while V is in the world, not in a menu, a scene or photo mode, and the save's
// story has been read: a check, in which people, the corporations of V's district and at most one
// of its gangs may post, and NPCs comment. V's own posts and comments are answered within a
// minute or two. Each question goes to REDagent with tools: false (REDnode 0.72.0).

const ledger = new Ledger(join(pkg.dataDir, 'posting.json'));
const [replyLo, replyHi] = String(process.env.CHOOMS_REPLY_MS ?? '60000,120000').split(',').map(Number);

/** Why Chooms! cannot post now, or null. */
function gate() {
  if (!settings.general.on) return 'off';
  if (!store.data) return 'no-save';
  if (!inWorld) return 'no-world';
  if (!store.data.story) return 'story';
  if (gameNow.menu || gameNow.scene || gameNow.photoMode) return 'busy';
  return null;
}

const poster = new Poster({
  store,
  roster,
  story,
  cards,
  general: () => settings.general,
  personOn: (id) => settings.people[id]?.on !== false,
  media: (id) => {
    const p = settings.people[id];
    if (!p) return null;
    return { images: !!p.images, portrait: !!p.portrait, body: !!p.body, places: p.settings.map((s) => ({ description: s.description, activities: s.activities })) };
  },
  ask: (prompt, options) => agent.ask(prompt, options),
  ledger,
  gate,
  onChange: () => {
    changed();
    channel.post(postingState());
  },
  log: (line) => console.log(line),
  replyDelayMs: [replyLo, replyHi],
});

let lastWhere = null; // the district at the last read, for the window
let nextCheckAt = 0; // when the next check is due (Date.now()); 0: an interval from now
let cycling = false;

/** Where V is and when, for the post questions: the district as roster.json names it, the part of it, the game's hour. */
async function readWhere() {
  const t = await gameSeconds();
  const where = { district: null, area: null, time: `${String(Math.floor((t % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`, day: Math.floor(t / 86400) + 1 };
  try {
    const container = await api.GameInstance.GetScriptableSystemsContainer(game.instance);
    const prevention = await container.Get('PreventionSystem');
    const district = await prevention.GetCurrentDistrict();
    let record = district ? await district.GetDistrictRecord() : null;
    // From the spot V is in up to the top district (Little China, then Watson). By the records'
    // enum names, which do not change with the game's language.
    const names = [];
    for (let i = 0; record && i < 5; i++) {
      names.push(String(await record.EnumName()));
      record = await record.ParentDistrict();
    }
    where.district = DISTRICTS[names.at(-1)] ?? null;
    where.area = names.length > 1 ? placeName(names.at(-2)) : null;
  } catch (err) {
    if (NO_WORLD.test(err?.message ?? '')) throw err;
    console.log(`Could not read the district: ${err?.message ?? err}`);
  }
  return where;
}

async function runCheck(options = {}) {
  cycling = true;
  try {
    const where = await readWhere();
    lastWhere = where;
    const out = await poster.cycle(where, options);
    if (out.posts || out.comments) console.log(`A check in ${where.district ?? 'no district'}: ${out.posts} posts, ${out.comments} comments`);
    return out;
  } catch (err) {
    if (NO_WORLD.test(err?.message ?? '')) inWorld = false;
    else console.log(`The check failed: ${err?.message ?? err}`);
    return { posts: 0, comments: 0, stopped: 'error' };
  } finally {
    cycling = false;
    nextCheckAt = Date.now() + settings.general.everyMinutes * 60000;
    channel.post(postingState());
  }
}

function maybeCheck() {
  if (cycling || gate()) return;
  if (!nextCheckAt) {
    nextCheckAt = Date.now() + settings.general.everyMinutes * 60000;
    channel.post(postingState());
  }
  if (Date.now() >= nextCheckAt) runCheck();
}

async function postNow(who) {
  const why = gate();
  if (why || cycling) {
    channel.post({ type: 'error', text: cycling ? 'A check is running.' : statusLine() });
    return;
  }
  const out = await runCheck({ force: true, who });
  const text = out.posts ? `${out.posts} new post${out.posts === 1 ? '' : 's'}: open Chooms! on the phone.` : out.stopped ? statusLine() : who ? `${byId.get(who)?.name ?? who} did not post: see the log.` : 'No one may post here now: see the log.';
  channel.post({ type: out.posts ? 'note' : 'error', text });
}

// The line the settings window shows: why nothing posts, or when the next check is.
function statusLine() {
  const why = gate();
  const p = poster.problem;
  const cap = settings.general.dailyCapUsd;
  if (why === 'off') return 'Chooms! is off.';
  if (why === 'no-save' || why === 'no-world') return 'Waiting for V: load a save.';
  if (why === 'story') return "Reading the save's story.";
  if (p?.kind === 'not-allowed') return 'Chooms! may not ask REDagent yet: allow it in the launcher or the Mod Manager.';
  if (p?.kind === 'no-agent') return 'REDagent is not running: install it and switch it on.';
  if (p?.kind === 'agent-paused') return "Chooms! is paused in REDagent: see REDagent's Mods view.";
  if (p?.kind === 'agent-cap') return "Chooms! has used its daily limit in REDagent. Raise it in REDagent's Mods view, or wait for tomorrow.";
  if (p?.kind === 'error') return `REDagent could not answer: ${p.text.slice(0, 160)}`;
  if (ledger.today >= cap) return `Today's spending has reached the cap ($${cap.toFixed(2)}). Posts start again tomorrow.`;
  if (why === 'busy') return 'Waiting: a menu, a scene or photo mode is open.';
  if (cycling) return 'Checking for posts now.';
  const min = nextCheckAt ? Math.max(0, Math.ceil((nextCheckAt - Date.now()) / 60000)) : settings.general.everyMinutes;
  return `The next check is in ${min} min${lastWhere?.district ? `, in ${lastWhere.district}` : ''}.`;
}

function postingState() {
  const c = poster.candidates(lastWhere?.district ?? null);
  const name = (id) => byId.get(id)?.name ?? id;
  return {
    type: 'posting',
    status: statusLine(),
    spent: ledger.today,
    cap: settings.general.dailyCapUsd,
    district: lastWhere?.district ?? null,
    who: [...c.people, ...c.corps, ...c.gangs].map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    log: ledger.log.slice(0, 20).map((e) => ({ ...e, name: name(e.who) })),
  };
}

// --- What the app sees -----------------------------------------------------------------------

const V = { id: 'v', name: 'V', handle: 'v', initials: 'V', color: 'var(--ink)', kind: 'v', tag: null, avatar: null };

function author(id) {
  if (id === 'v') return V;
  const a = byId.get(id);
  if (!a) return { ...V, id, name: 'Unknown', handle: id, initials: '?' };
  const portrait = isOrg(a) ? null : settings.people[id]?.portrait;
  return { id: a.id, name: a.name, handle: a.handle, initials: a.initials, color: a.color, kind: a.kind, tag: a.tag ?? null, avatar: portrait ? { $media: portrait } : null };
}

/** How long ago, in game time: "now", "12m", "3h", "2d". */
function ago(at) {
  const s = Math.max(0, (store.data?.now ?? at) - at);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// Likes on what Chooms! and V wrote grow with game time (posts.mjs); V's following counts for V's.
const vFans = () => 40 + 300 * PEOPLE.filter((a) => store.known(a.id) && store.relation(a.id).followsV).length;
const grown = (item, comment = false) => grownLikes(item, { now: store.data.now, account: byId.get(item.by), vFans: item.by === 'v' ? vFans() : 0, comment });

function commentView(c) {
  return { id: c.id, by: author(c.by), ago: ago(c.at), text: c.text, likes: c.likes + grown(c, true) + (c.liked ? 1 : 0), liked: !!c.liked };
}

function postView(p, full = false) {
  return {
    id: p.id,
    by: author(p.by),
    ago: ago(p.at),
    text: p.text,
    image: p.image ? { $media: p.image.file, alt: p.image.alt ?? '' } : null,
    likes: p.likes + grown(p) + (p.liked ? 1 : 0),
    liked: !!p.liked,
    comments: p.comments.length,
    ...(full ? { commentList: p.comments.map(commentView) } : {}),
  };
}

const newestFirst = (a, b) => b.at - a.at || b.id.localeCompare(a.id, 'en', { numeric: true });

function relationView(id) {
  const a = byId.get(id);
  const r = store.relation(id);
  return {
    follows: !!r.follows,
    followsV: !!r.followsV,
    request: r.request ?? null,
    choom: r.request === 'accepted',
    alive: store.alive(id),
    canMessage: !isOrg(a) && r.request === 'accepted' && store.alive(id),
  };
}

const known = () => roster.filter((a) => store.known(a.id));
// The chooms strip and You Might Already Know are for the living; their posts and threads stay.
const chooms = () => known().filter((a) => store.isChoom(a.id) && store.alive(a.id)).map((a) => author(a.id));
// You Might Already Know: people V has met but does not follow.
const suggestions = () => known().filter((a) => (a.kind === 'cast' || a.kind === 'delamain') && !store.relation(a.id).follows && store.alive(a.id)).map((a) => author(a.id));

function feed() {
  const posts = store.data.posts.filter((p) => {
    if (p.by === 'v') return true;
    const a = byId.get(p.by);
    if (!a || !store.known(p.by)) return false;
    return isOrg(a) || store.relation(p.by).follows;
  });
  return { posts: posts.sort(newestFirst).slice(0, 60).map((p) => postView(p)), chooms: chooms(), suggestions: suggestions() };
}

function profile(id) {
  if (id === 'v') return me();
  if (!store.known(id)) throw new Error('No such account.');
  const a = byId.get(id);
  const posts = store.data.posts.filter((p) => p.by === id).sort(newestFirst);
  return { account: { ...author(id), bio: a.bio ?? '', home: a.home ?? null }, relation: relationView(id), posts: posts.slice(0, 30).map((p) => postView(p)), postCount: posts.length };
}

function me() {
  const posts = store.data.posts.filter((p) => p.by === 'v').sort(newestFirst);
  const following = known().filter((a) => store.relation(a.id).follows).map((a) => author(a.id));
  return { account: { ...V, bio: '' }, me: true, posts: posts.map((p) => postView(p)), postCount: posts.length, chooms: chooms(), following };
}

function threads() {
  const requests = known().filter((a) => store.relation(a.id).request === 'pending').map((a) => author(a.id));
  const list = Object.entries(store.data.dms)
    .filter(([id]) => store.known(id))
    .map(([id, msgs]) => ({ with: author(id), last: msgs.at(-1)?.text ?? '', ago: msgs.length ? ago(msgs.at(-1).at) : '', at: msgs.at(-1)?.at ?? 0, unread: msgs.filter((m) => !m.read).length }))
    .sort((a, b) => b.at - a.at);
  // Chooms with no messages yet, so V can start one (chooms() is the living only).
  for (const c of chooms()) if (!list.some((t) => t.with.id === c.id)) list.push({ with: c, last: '', ago: '', at: 0, unread: 0 });
  return { requests, threads: list.map(({ at, ...t }) => t) };
}

function thread(id) {
  if (!store.known(id)) throw new Error('No such account.');
  if (store.markRead(id)) changed();
  return {
    with: author(id),
    relation: relationView(id),
    messages: (store.data.dms[id] ?? []).map((m) => ({ id: m.id, mine: m.from === 'v', text: m.text, ago: ago(m.at) })),
  };
}

// Search: with no words, everyone V knows (people A to Z, then corporations, then gangs), which the
// app filters as the player types; with words, those whose name or handle holds them.
const ORDER = (a) => (a.kind === 'gang' ? 2 : a.kind === 'corp' ? 1 : 0);
function search(q) {
  const term = String(q ?? '').trim().toLowerCase().slice(0, 40);
  const results = known()
    .filter((a) => !term || a.name.toLowerCase().includes(term) || a.handle.toLowerCase().includes(term))
    .sort((a, b) => ORDER(a) - ORDER(b) || a.name.localeCompare(b.name))
    .map((a) => author(a.id));
  return { suggestions: suggestions(), results };
}

function post(id) {
  const p = store.data.posts.find((x) => x.id === id);
  if (!p || (p.by !== 'v' && !store.known(p.by))) throw new Error('That post is gone.');
  return postView(p, true);
}

/**
 * One call from the app, through EDGEmobile (service.mjs). Returns the answer; throws a short
 * message the app can show.
 */
export function answer(call, args) {
  if (!store.data) {
    if (call === 'state') return { ready: false, reason: inWorld ? 'loading' : 'no-save' };
    throw new Error('Load a save first: your feed belongs to the playthrough you play.');
  }
  const [a, b, c] = args;
  switch (call) {
    case 'state':
      return { ready: true, badge: store.unseen() };
    case 'feed':
      return feed();
    case 'post':
      return post(a);
    case 'profile':
      return profile(a);
    case 'me':
      return me();
    case 'threads':
      return threads();
    case 'thread':
      return thread(a);
    case 'search':
      return search(a);
    case 'follow':
      if (store.follow(a, b)) changed();
      return profile(a);
    case 'accept':
      store.accept(a);
      changed();
      return profile(a);
    case 'like':
      store.like(a, b);
      changed();
      return post(a);
    case 'likeComment':
      store.likeComment(a, b, c);
      changed();
      return post(a);
    case 'comment':
      store.comment(a, b);
      poster.onV({ post: a });
      changed();
      return post(a);
    case 'newPost': {
      const p = store.newPost(a);
      poster.onV({ post: p.id });
      changed();
      return post(p.id);
    }
    case 'send':
      store.send(a, b);
      changed();
      return thread(a);
    default:
      throw new Error(`Chooms! has no call named ${call}.`);
  }
}

// --- The settings window ----------------------------------------------------------------------
// The window is a page in the overlay with no file access. The system's file picker opens on the
// desktop, behind the game (the user's C1 test, 2026-10-31), so the window draws a picker of its
// own: the mod lists the PC's folders and their images and sends a preview of the one selected;
// the window makes the one picked smaller (WebP, at most 1440 pixels on its longest side) and
// sends it back in pieces. Images go back as data addresses for the window's previews. Only
// this package's own window on the PC reaches the channel; a phone never does.

const IMAGE_MAX = 12 * 1024 * 1024;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const LIST_MAX = 1000;
const uploads = new Map(); // upload id -> { person, kind, chunks: [], got: 0, n }

const isDir = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

// Where pictures usually are: the game's Steam screenshots (F12; the game's Steam id is
// 1091500), photo mode's folder (*unverified* as the game's), the user's folders, the drives.
function places() {
  const home = homedir();
  const found = [];
  const add = (name, path) => isDir(path) && !found.some((p) => p.path === path) && found.push({ name, path });
  const steam = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam', 'userdata');
  try {
    for (const user of readdirSync(steam)) add('Steam screenshots', join(steam, user, '760', 'remote', '1091500', 'screenshots'));
  } catch {
    // no Steam there
  }
  add('Photo mode', join(home, 'Pictures', 'Cyberpunk 2077'));
  add('Pictures', join(home, 'Pictures'));
  add('Pictures', join(home, 'OneDrive', 'Pictures'));
  add('Downloads', join(home, 'Downloads'));
  add('Desktop', join(home, 'Desktop'));
  add('Documents', join(home, 'Documents'));
  for (const d of 'CDEFGHIJKLMNOPQRSTUVWXYZ') add(`${d}:`, `${d}:\\`);
  return found;
}

// A folder's subfolders and images, newest images first.
function browse(m) {
  const all = places();
  let dir = typeof m.path === 'string' && m.path ? resolve(m.path) : null;
  if (dir && typeof m.into === 'string' && m.into && !/[\\/]/.test(m.into) && m.into !== '..') dir = join(dir, m.into);
  if (!dir || !isDir(dir)) dir = settings.folder && isDir(settings.folder) ? settings.folder : (all[0]?.path ?? homedir());
  const parent = dirname(dir) === dir ? null : dirname(dir);
  const dirs = [];
  const files = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name.startsWith('$')) continue;
      if (e.isDirectory()) dirs.push(e.name);
      else if (e.isFile() && IMAGE_EXT.has(extname(e.name).toLowerCase())) {
        try {
          const s = statSync(join(dir, e.name));
          files.push({ name: e.name, size: s.size, at: s.mtimeMs });
        } catch {
          // gone, or not ours to read
        }
      }
    }
  } catch (err) {
    return { type: 'browse', path: dir, parent, places: all, dirs: [], files: [], error: `That folder cannot be read (${err.code ?? err.message}).` };
  }
  dirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  files.sort((a, b) => b.at - a.at);
  return { type: 'browse', path: dir, parent, places: all, dirs: dirs.slice(0, LIST_MAX), files: files.slice(0, LIST_MAX), more: dirs.length + files.length > 2 * LIST_MAX };
}

// The image file the window names, read and checked, or an error to show.
function readPicked(m) {
  if (typeof m.path !== 'string' || typeof m.name !== 'string' || /[\\/]/.test(m.name)) return { error: 'Pick an image.' };
  const file = join(resolve(m.path), m.name);
  if (!IMAGE_EXT.has(extname(file).toLowerCase())) return { error: 'Only PNG, JPEG and WebP images.' };
  let size;
  try {
    size = statSync(file).size;
  } catch {
    return { error: 'That image is gone.' };
  }
  if (size > IMAGE_MAX) return { error: 'That image is over 12 MB.' };
  const buf = readFileSync(file);
  const ext = imageKind(buf);
  if (!ext) return { error: 'Only PNG, JPEG and WebP images.' };
  return { buf, ext, file };
}

// Keeps an image as a person's portrait or body, or as a new place.
function addImage(id, p, kind, buf, ext) {
  const rel = `people/${id}/${randomBytes(6).toString('hex')}.${ext}`;
  mkdirSync(join(pkg.dataDir, 'people', id), { recursive: true });
  writeFileSync(join(pkg.dataDir, rel), buf);
  if (SINGLE.includes(kind)) {
    removeFile(p[kind]);
    p[kind] = rel;
    (p.from ??= {})[kind] = null;
  } else {
    p.settings.push({ file: rel, description: '', activities: [] });
  }
  saveSettings();
  channel.post(personState(id));
  channel.post(windowState());
  if (kind === 'portrait') changed();
}

function imageKind(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function preview(rel) {
  const file = rel && join(pkg.dataDir, rel);
  if (!file || !existsSync(file)) return null;
  const ext = rel.slice(rel.lastIndexOf('.') + 1);
  return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${readFileSync(file).toString('base64')}`;
}

function windowState() {
  return {
    type: 'state',
    general: settings.general,
    people: PEOPLE.map((a) => {
      const p = person(a.id);
      return { id: a.id, name: a.name, kind: a.kind, tag: a.tag, on: p.on, images: p.images, portrait: !!p.portrait, body: !!p.body, settings: p.settings.length };
    }),
    playthrough: store.id,
    story: store.data?.story ? storySummary(store.data.story) : null,
  };
}

// The save's story in a line for the settings window.
function storySummary(s) {
  const name = (id) => byId.get(id)?.name ?? id;
  return {
    lifepath: s.lifepath,
    body: s.body,
    points: Object.keys(s.points).length,
    of: story.points.length,
    met: s.met.map(name),
    gone: s.dead.map(name),
    // The knowledge cards each person V has met would post with now (cards/), counting `start`.
    cards: s.met.map((id) => ({ name: name(id), n: cardsFor(cards, id, s.points, story).length })).filter((c) => c.n),
  };
}

function personState(id) {
  const p = person(id);
  return {
    type: 'person',
    id,
    on: p.on,
    images: p.images,
    portrait: preview(p.portrait),
    body: preview(p.body),
    defaults: !!content.people?.[id],
    settings: p.settings.map((s) => ({ description: s.description, activities: s.activities.join('\n'), image: preview(s.file) })),
  };
}

function removeFile(rel) {
  if (rel) rmSync(join(pkg.dataDir, rel), { force: true });
}

const NUMBERS = { everyMinutes: [1, 240], peopleChance: [0, 100], corpChance: [0, 100], gangChance: [0, 100], maxPerCheck: [0, 10], maxCommentsPerCheck: [0, 10], weightText: [0, 100], weightSelfie: [0, 100], weightActivity: [0, 100], dailyCapUsd: [0, 100] };

channel.on((m) => {
  const id = m?.person;
  const p = id && byId.get(id) && !isOrg(byId.get(id)) ? person(id) : null;
  switch (m?.type) {
    case 'hello':
      channel.post(windowState());
      channel.post(postingState());
      // Who may post where V is now, for Post now.
      if (!gate() && !cycling) readWhere().then((w) => ((lastWhere = w), channel.post(postingState())), () => {});
      break;
    case 'post-now':
      // { who }: a check now, for testing; with who, that account posts and nothing else.
      postNow(typeof m.who === 'string' && m.who ? m.who : null);
      break;
    case 'general': {
      const every = settings.general.everyMinutes;
      for (const [k, [lo, hi]] of Object.entries(NUMBERS)) {
        if (m.values?.[k] === undefined) continue;
        const n = Number(m.values[k]);
        if (Number.isFinite(n)) settings.general[k] = Math.min(hi, Math.max(lo, n));
      }
      if (settings.general.everyMinutes !== every) nextCheckAt = 0;
      for (const k of ['on', 'secondCheck']) if (typeof m.values?.[k] === 'boolean') settings.general[k] = m.values[k];
      channel.post(postingState());
      for (const k of ['postModel', 'dmModel']) if (['haiku', 'sonnet', 'opus'].includes(m.values?.[k])) settings.general[k] = m.values[k];
      saveSettings();
      channel.post(windowState());
      break;
    }
    case 'person':
      if (p) channel.post(personState(id));
      break;
    case 'person-set':
      if (!p) break;
      if (typeof m.on === 'boolean') p.on = m.on;
      if (typeof m.images === 'boolean') p.images = m.images;
      saveSettings();
      channel.post(windowState());
      break;
    case 'setting-edit': {
      const s = p?.settings[m.index];
      if (!s) break;
      s.description = String(m.description ?? '').slice(0, 200);
      s.activities = String(m.activities ?? '').split('\n').map((x) => x.trim().slice(0, 120)).filter(Boolean).slice(0, 20);
      saveSettings();
      break;
    }
    case 'setting-remove':
      if (!p?.settings[m.index]) break;
      removeFile(p.settings[m.index].file);
      p.settings.splice(m.index, 1);
      saveSettings();
      channel.post(personState(id));
      channel.post(windowState());
      break;
    case 'image-remove':
      // { person, kind: 'portrait' | 'body' }
      if (!p || !SINGLE.includes(m.kind)) break;
      removeFile(p[m.kind]);
      p[m.kind] = null;
      (p.from ??= {})[m.kind] = null;
      saveSettings();
      channel.post(personState(id));
      channel.post(windowState());
      if (m.kind === 'portrait') changed();
      break;
    case 'upload': {
      // { upload, person, kind: 'portrait' | 'body' | 'setting', i, n, chunk (base64), folder, name }:
      // an image picked in the window, already made smaller there. folder is where it came from,
      // so the picker opens there next time.
      if (!p || !KINDS.includes(m.kind) || typeof m.chunk !== 'string') break;
      let u = uploads.get(m.upload);
      if (!u) uploads.set(m.upload, (u = { person: id, kind: m.kind, chunks: [], got: 0, n: m.n, folder: m.folder, name: m.name }));
      u.chunks[m.i] = Buffer.from(m.chunk, 'base64');
      u.got += u.chunks[m.i].length;
      if (u.got > IMAGE_MAX) {
        uploads.delete(m.upload);
        channel.post({ type: 'error', text: 'That image is over 12 MB.' });
        break;
      }
      if (u.chunks.filter(Boolean).length < u.n) break;
      uploads.delete(m.upload);
      const buf = Buffer.concat(u.chunks);
      const ext = imageKind(buf);
      if (!ext) {
        channel.post({ type: 'error', text: 'Only PNG, JPEG and WebP images.' });
        break;
      }
      if (typeof u.folder === 'string' && isDir(u.folder)) settings.folder = u.folder;
      addImage(id, p, u.kind, buf, ext);
      if (typeof u.name === 'string') channel.post({ type: 'note', text: `${u.name.slice(0, 120)} added.` });
      break;
    }
    case 'reset': {
      // { person }: back to the pictures and places Chooms! comes with.
      if (!p || !content.people?.[id]) break;
      for (const rel of [p.portrait, p.body, ...p.settings.map((x) => x.file)]) removeFile(rel);
      settings.people[id] = { on: p.on, images: p.images, portrait: null, body: null, settings: [] };
      applyDefaults(id);
      saveSettings();
      channel.post(personState(id));
      channel.post(windowState());
      changed();
      channel.post({ type: 'note', text: `${byId.get(id).name}: the pictures and places Chooms! comes with.` });
      break;
    }
    case 'browse':
      channel.post(browse(m));
      break;
    case 'peek': {
      // { path, name }: a preview of the image selected in the window's picker.
      const r = readPicked(m);
      const type = r.ext === 'jpg' ? 'jpeg' : r.ext;
      channel.post({ type: 'peek', path: m.path, name: m.name, ...(r.error ? { error: r.error } : { data: `data:image/${type};base64,${r.buf.toString('base64')}` }) });
      break;
    }
    case 'try-post': {
      // A hand-written test post with one of the person's setting images, before C4 makes them.
      const s = p?.settings[m.index];
      if (!s) break;
      if (!store.data) {
        channel.post({ type: 'error', text: 'Load a save first: posts belong to a playthrough.' });
        break;
      }
      const a = byId.get(id);
      if (!store.known(id)) {
        channel.post({ type: 'error', text: `V has not met ${a.name} yet in this playthrough, so the post would not show.` });
        break;
      }
      store.newPost(s.description ? `${s.description}.` : 'Out and about.', id, { file: s.file, alt: s.description || `A photo by ${a.name}` }, randomInt(20, 900));
      if (!store.relation(id).follows) store.follow(id, true);
      changed();
      channel.post({ type: 'note', text: `${a.name} posted it. Open Chooms! on the phone.` });
      break;
    }
  }
});
