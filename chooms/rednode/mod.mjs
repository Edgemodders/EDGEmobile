// Chooms!'s Node mod (docs/design.md, "Chooms!" and "C1 plan"): the accounts, the history of each
// playthrough, the settings and their images, and the answers its mobile app gets through
// EDGEmobile (service.mjs). C1: hand-written posts, no AI yet.

import { api, channel, game, pkg, quests, service } from 'rednode';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from './store.mjs';

const roster = JSON.parse(readFileSync(join(pkg.dir, 'roster.json'), 'utf8')).accounts;
const seed = JSON.parse(readFileSync(join(pkg.dir, 'seed.json'), 'utf8'));
const byId = new Map(roster.map((a) => [a.id, a]));
const PEOPLE = roster.filter((a) => a.kind !== 'corp');
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
  dailyCapUsd: 1,
};
let settings = { general: { ...DEFAULTS }, people: {} };
try {
  const s = JSON.parse(readFileSync(settingsFile, 'utf8'));
  settings = { general: { ...DEFAULTS, ...s.general }, people: s.people ?? {} };
} catch {
  // first start
}
const person = (id) => (settings.people[id] ??= { on: true, images: true, portrait: null, settings: [] });
function saveSettings() {
  writeFileSync(`${settingsFile}.tmp`, JSON.stringify(settings, null, 2));
  renameSync(`${settingsFile}.tmp`, settingsFile);
}

// --- The game: the playthrough and its time ---------------------------------------------------
// Only while V is in the world (REDnode's game.state().world): calls into the game's world before
// V exists crashed it (EDGEmobile, 2026-10-29). A load can start between two calls; REDnode then
// refuses the next one, which only means the world went away.

let inWorld = false;
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
    if (opened || dropped) changed();
  } catch (err) {
    // A load started between two calls: the world went away; onState brings V back.
    if (NO_WORLD.test(err?.message ?? '')) inWorld = false;
    else console.log(`Could not read the game: ${err?.message ?? err}`);
  } finally {
    reading = false;
  }
}

function onGameState(s) {
  const now = !!(s.connected && s.world);
  if (now === inWorld) return;
  inWorld = now;
  if (inWorld) readGame();
}
game.onState(onGameState);
game.state().then(onGameState, () => {});
setInterval(readGame, NOW_MS);

// --- Events to the app ------------------------------------------------------------------------

function changed() {
  service.emit('mobile', { event: 'changed' });
  service.emit('mobile', { event: 'badge', data: { count: store.unseen() } });
}

// --- What the app sees -----------------------------------------------------------------------

const V = { id: 'v', name: 'V', handle: 'v', initials: 'V', color: 'var(--ink)', kind: 'v', tag: null, avatar: null };

function author(id) {
  if (id === 'v') return V;
  const a = byId.get(id);
  if (!a) return { ...V, id, name: 'Unknown', handle: id, initials: '?' };
  const portrait = a.kind === 'corp' ? null : settings.people[id]?.portrait;
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

function commentView(c) {
  return { id: c.id, by: author(c.by), ago: ago(c.at), text: c.text, likes: c.likes + (c.liked ? 1 : 0), liked: !!c.liked };
}

function postView(p, full = false) {
  return {
    id: p.id,
    by: author(p.by),
    ago: ago(p.at),
    text: p.text,
    image: p.image ? { $media: p.image.file, alt: p.image.alt ?? '' } : null,
    likes: p.likes + (p.liked ? 1 : 0),
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
    canMessage: a.kind !== 'corp' && r.request === 'accepted',
  };
}

const known = () => roster.filter((a) => store.known(a.id));
const chooms = () => known().filter((a) => store.isChoom(a.id)).map((a) => author(a.id));
// You Might Already Know: people V has met but does not follow.
const suggestions = () => known().filter((a) => (a.kind === 'cast' || a.kind === 'delamain') && !store.relation(a.id).follows).map((a) => author(a.id));

function feed() {
  const posts = store.data.posts.filter((p) => {
    if (p.by === 'v') return true;
    const a = byId.get(p.by);
    if (!a || !store.known(p.by)) return false;
    return a.kind === 'corp' || store.relation(p.by).follows;
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
  // Chooms with no messages yet, so V can start one.
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

function search(q) {
  const term = String(q ?? '').trim().toLowerCase().slice(0, 40);
  const results = term ? known().filter((a) => a.name.toLowerCase().includes(term) || a.handle.toLowerCase().includes(term)).map((a) => author(a.id)) : [];
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
      changed();
      return post(a);
    case 'newPost': {
      const p = store.newPost(a);
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
// The window is a page in the overlay with no file access: images come to the mod in pieces
// over the package channel, and go back as small data addresses for its previews.

const IMAGE_MAX = 12 * 1024 * 1024;
const uploads = new Map(); // upload id -> { person, kind, chunks: [], got: 0, n }

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
      return { id: a.id, name: a.name, kind: a.kind, tag: a.tag, on: p.on, images: p.images, portrait: !!p.portrait, settings: p.settings.length };
    }),
    playthrough: store.id,
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
    settings: p.settings.map((s) => ({ description: s.description, activities: s.activities.join('\n'), image: preview(s.file) })),
  };
}

function removeFile(rel) {
  if (rel) rmSync(join(pkg.dataDir, rel), { force: true });
}

const NUMBERS = { everyMinutes: [1, 240], peopleChance: [0, 100], corpChance: [0, 100], maxPerCheck: [0, 10], weightText: [0, 100], weightSelfie: [0, 100], weightActivity: [0, 100], dailyCapUsd: [0, 100] };

channel.on((m) => {
  const id = m?.person;
  const p = id && byId.get(id) && byId.get(id).kind !== 'corp' ? person(id) : null;
  switch (m?.type) {
    case 'hello':
      channel.post(windowState());
      break;
    case 'general': {
      for (const [k, [lo, hi]] of Object.entries(NUMBERS)) {
        if (m.values?.[k] === undefined) continue;
        const n = Number(m.values[k]);
        if (Number.isFinite(n)) settings.general[k] = Math.min(hi, Math.max(lo, n));
      }
      if (typeof m.values?.on === 'boolean') settings.general.on = m.values.on;
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
    case 'portrait-remove':
      if (!p) break;
      removeFile(p.portrait);
      p.portrait = null;
      saveSettings();
      channel.post(personState(id));
      channel.post(windowState());
      changed();
      break;
    case 'upload': {
      // { upload, person, kind: 'portrait' | 'setting', i, n, chunk (base64) }
      if (!p || !['portrait', 'setting'].includes(m.kind) || typeof m.chunk !== 'string') break;
      let u = uploads.get(m.upload);
      if (!u) uploads.set(m.upload, (u = { person: id, kind: m.kind, chunks: [], got: 0, n: m.n }));
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
      const rel = `people/${id}/${randomBytes(6).toString('hex')}.${ext}`;
      mkdirSync(join(pkg.dataDir, 'people', id), { recursive: true });
      writeFileSync(join(pkg.dataDir, rel), buf);
      if (u.kind === 'portrait') {
        removeFile(p.portrait);
        p.portrait = rel;
      } else {
        p.settings.push({ file: rel, description: '', activities: [] });
      }
      saveSettings();
      channel.post(personState(id));
      channel.post(windowState());
      if (u.kind === 'portrait') changed();
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
