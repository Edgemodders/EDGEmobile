// Chooms! history for one playthrough (docs/design.md, "Playthroughs"): posts, comments, likes,
// follows, Choom Requests and DMs, each stamped with the game time it happened at. Loading an
// older save of the same playthrough takes the game time back; what happened after it is
// dropped, as that branch of the story did not happen.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A corporation or a gang: an organisation, with no Choom Requests, no DMs and no person's settings. */
export const isOrg = (a) => a?.kind === 'corp' || a?.kind === 'gang';

const MAX_TEXT = 500;

// A value that can change back and forth (a follow, a like, a request): its value before any
// change, and each change with its game time, so going back in time finds the value it had.
function stamp(obj, key, value, now) {
  const log = `${key}Log`;
  if (!obj[log]) {
    obj[`${key}Base`] = obj[key];
    obj[log] = [];
  }
  obj[log].push({ at: now, v: value });
  obj[key] = value;
}
function rewind(obj, key, now) {
  const log = obj[`${key}Log`];
  if (!log) return;
  obj[`${key}Log`] = log.filter((e) => e.at <= now);
  const last = obj[`${key}Log`].at(-1);
  obj[key] = last ? last.v : obj[`${key}Base`];
}

export class Store {
  /** `dir` holds one file per playthrough. `roster` is roster.json's accounts. */
  constructor({ dir, roster }) {
    this.dir = dir;
    this.roster = new Map(roster.map((a) => [a.id, a]));
    this.data = null;
    mkdirSync(dir, { recursive: true });
  }

  get id() {
    return this.data?.id ?? null;
  }

  #file(id) {
    return join(this.dir, `${id}.json`);
  }

  /** Opens a playthrough's history, made from `seed` the first time, at game time `now`. */
  open(id, now, seed) {
    if (this.data?.id === id) return false;
    const file = this.#file(id);
    if (existsSync(file)) {
      this.data = JSON.parse(readFileSync(file, 'utf8'));
    } else {
      this.data = { v: 1, id, seq: 0, now, accounts: {}, posts: [], dms: {} };
      this.#seed(seed, now);
      this.save();
    }
    return true;
  }

  save() {
    if (!this.data) return;
    const file = this.#file(this.data.id);
    writeFileSync(`${file}.tmp`, JSON.stringify(this.data));
    renameSync(`${file}.tmp`, file);
  }

  #next(prefix) {
    this.data.seq += 1;
    return `${prefix}${this.data.seq}`;
  }

  #seed(seed, now) {
    const at = (ago) => Math.max(0, now - (Number(ago) || 0));
    for (const a of this.roster.values()) {
      if (isOrg(a)) continue;
      // Who V has met comes from the save's journal (setStory), not from here.
      this.data.accounts[a.id] = { follows: false, followsV: false, request: null };
    }
    for (const [id, r] of Object.entries(seed.relations ?? {})) {
      const acc = this.data.accounts[id];
      if (!acc) continue;
      acc.follows = !!r.follows;
      acc.followsV = !!r.followsV;
      acc.request = r.request ?? null;
    }
    for (const p of seed.posts ?? []) {
      this.data.posts.push({
        id: this.#next('p'),
        by: p.by,
        at: at(p.ago),
        seed: true,
        text: p.text,
        image: null,
        likes: p.likes ?? 0,
        liked: false,
        comments: (p.comments ?? []).map((c) => ({ id: this.#next('c'), by: c.by, at: at(c.ago), seed: true, text: c.text, likes: c.likes ?? 0, liked: false })),
      });
    }
    for (const [who, list] of Object.entries(seed.dms ?? {})) {
      this.data.dms[who] = list.map((m) => ({ id: this.#next('m'), from: m.from, at: at(m.ago), seed: true, text: m.text, read: m.from === 'v' || m.read !== false }));
    }
  }

  /**
   * The game time now. Earlier than what the history has seen means an older save of this
   * playthrough was loaded: everything after it is dropped. Returns whether anything was.
   * What the seed wrote stands for the time before the history began, so it stays: its game
   * times are only for the order of the feed, and an older save can be earlier than them.
   */
  setNow(now) {
    if (!this.data || typeof now !== 'number') return false;
    const back = now < this.data.now;
    this.data.now = now;
    if (!back) return false;
    const d = this.data;
    const before = JSON.stringify(d);
    d.posts = d.posts.filter((p) => p.seed || p.at <= now);
    for (const p of d.posts) {
      p.comments = p.comments.filter((c) => c.seed || c.at <= now);
      rewind(p, 'liked', now);
      for (const c of p.comments) rewind(c, 'liked', now);
    }
    for (const [who, list] of Object.entries(d.dms)) {
      d.dms[who] = list.filter((m) => m.seed || m.at <= now);
      if (!d.dms[who].length) delete d.dms[who];
    }
    for (const acc of [...Object.values(d.accounts), ...Object.values(d.corps ?? {})]) {
      for (const key of ['follows', 'followsV', 'request']) rewind(acc, key, now);
    }
    const changed = JSON.stringify(d) !== before;
    this.save();
    return changed;
  }

  // --- What V does -----------------------------------------------------------------------------

  account(id) {
    return this.roster.get(id) ?? null;
  }

  /** The relation between V and a person; corporations have none beyond following. */
  relation(id) {
    const a = this.roster.get(id);
    if (!a) return null;
    this.data.corps ??= {};
    if (isOrg(a)) return (this.data.corps[id] ??= { follows: false });
    return (this.data.accounts[id] ??= { follows: false, followsV: false, request: null });
  }

  /**
   * What the loaded save's journal says (journal.mjs): the lifepath, the body, the story points
   * passed with their game times, who V has met, who has died. Read again on each load, so an
   * older save's journal simply says less. Returns whether it changed.
   */
  setStory(s) {
    if (!this.data) return false;
    const next = { lifepath: s.lifepath ?? null, body: s.body ?? null, points: s.points ?? {}, met: [...(s.met ?? [])].sort(), dead: [...(s.dead ?? [])].sort() };
    if (JSON.stringify(next) === JSON.stringify(this.data.story ?? null)) return false;
    this.data.story = next;
    this.save();
    return true;
  }

  /** Whether V knows of this account: a person V has met (the save's journal); any corporation. */
  known(id) {
    const a = this.roster.get(id);
    if (!a) return false;
    if (isOrg(a)) return true;
    return !!this.data.story?.met.includes(id);
  }

  /** Whether this person is alive in the loaded save's story. */
  alive(id) {
    return !this.data.story?.dead.includes(id);
  }

  follow(id, on) {
    if (!this.known(id)) throw new Error('No such account.');
    const r = this.relation(id);
    if (r.follows === !!on) return false;
    stamp(r, 'follows', !!on, this.data.now);
    this.save();
    return true;
  }

  /** V accepts a Choom Request. V cannot send one (the user's rule, 2026-10-30). */
  accept(id) {
    const r = this.relation(id);
    if (!r || r.request !== 'pending') throw new Error('There is no Choom Request from them.');
    stamp(r, 'request', 'accepted', this.data.now);
    this.save();
    return true;
  }

  isChoom(id) {
    return this.data.accounts[id]?.request === 'accepted';
  }

  like(postId, on) {
    const p = this.data.posts.find((x) => x.id === postId);
    if (!p) throw new Error('No such post.');
    if (p.liked !== !!on) stamp(p, 'liked', !!on, this.data.now);
    this.save();
    return p;
  }

  likeComment(postId, commentId, on) {
    const c = this.data.posts.find((x) => x.id === postId)?.comments.find((x) => x.id === commentId);
    if (!c) throw new Error('No such comment.');
    if (c.liked !== !!on) stamp(c, 'liked', !!on, this.data.now);
    this.save();
    return c;
  }

  comment(postId, text) {
    const p = this.data.posts.find((x) => x.id === postId);
    if (!p) throw new Error('No such post.');
    const c = { id: this.#next('c'), by: 'v', at: this.data.now, text: clean(text), likes: 0, liked: false };
    p.comments.push(c);
    this.save();
    return c;
  }

  /** A new post at the game time now. `extra` is kept with it: { gen, kind, scene } for one Chooms! wrote (C3). */
  newPost(text, by = 'v', image = null, likes = 0, extra = {}) {
    const p = { id: this.#next('p'), by, at: this.data.now, text: clean(text), image, likes, liked: false, comments: [], ...extra };
    this.data.posts.push(p);
    this.save();
    return p;
  }

  /** Someone other than V comments on a post (C3), at the game time now. */
  npcComment(postId, by, text, extra = {}) {
    const p = this.data.posts.find((x) => x.id === postId);
    if (!p) throw new Error('No such post.');
    const c = { id: this.#next('c'), by, at: this.data.now, text: clean(text), likes: 0, liked: false, gen: true, ...extra };
    p.comments.push(c);
    this.save();
    return c;
  }

  /** A person follows V (C3). Returns whether it changed. */
  followV(id) {
    const r = this.relation(id);
    if (!r || isOrg(this.roster.get(id)) || r.followsV) return false;
    stamp(r, 'followsV', true, this.data.now);
    this.save();
    return true;
  }

  /** A person sends V a Choom Request (C3). Returns whether it was sent. */
  sendRequest(id) {
    const r = this.relation(id);
    if (!r || isOrg(this.roster.get(id)) || r.request) return false;
    stamp(r, 'request', 'pending', this.data.now);
    this.save();
    return true;
  }

  /** V writes to a choom. Replies come in C5. */
  send(id, text) {
    if (!this.isChoom(id)) throw new Error('You can only message your chooms.');
    if (!this.alive(id)) throw new Error('They are gone.');
    const m = { id: this.#next('m'), from: 'v', at: this.data.now, text: clean(text), read: true };
    (this.data.dms[id] ??= []).push(m);
    this.save();
    return m;
  }

  markRead(id) {
    let changed = false;
    for (const m of this.data.dms[id] ?? []) {
      if (!m.read) changed = m.read = true;
    }
    if (changed) this.save();
    return changed;
  }

  /** Pending Choom Requests and unread messages: the app's badge. */
  unseen() {
    if (!this.data) return 0;
    let n = 0;
    for (const [id, r] of Object.entries(this.data.accounts)) if (r.request === 'pending' && this.known(id)) n++;
    for (const list of Object.values(this.data.dms)) n += list.filter((m) => !m.read).length;
    return n;
  }
}

function clean(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!t) throw new Error('Write something first.');
  return t;
}
