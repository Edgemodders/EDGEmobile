// Chooms!'s posts by themselves (docs/design.md, "C3 plan"): who posts each check, the questions
// to REDagent (agent.ask with tools: false, REDnode #54), the spoiler checks, comments with V
// answered first, likes worked out from game time, follows and Choom Requests at their story
// points, and the spending against the daily cap. mod.mjs gives it the game: the district, the
// time, whether V is free to be posted at. Everything it writes goes through the store, stamped
// with the game time, so an older save drops it as it drops V's own posts.

import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { cardsFor } from './cards.mjs';
import { forbiddenFor, leaks, spoilerWords } from './spoilers.mjs';
import { Store, isOrg } from './store.mjs';

/** How long a gang remembers a fight with V, in game seconds: three game days. */
export const FIGHT_MEMORY = 3 * 86400;

/** A gang's chance to post when V has fought it lately: three times the setting, at least 30%; none if gangs are off. */
export const fightChance = (gangChance) => (gangChance > 0 ? Math.min(100, Math.max(30, gangChance * 3)) : 0);

/**
 * The game's top districts, by their record's enum name (TweakDB, `Districts.*`, parentDistrict
 * none), as roster.json names them. The game has three top districts for the Badlands, and two
 * for Dogtown. Morro Rock and the Langley clinic are no one's.
 */
export const DISTRICTS = {
  Watson: 'Watson',
  Westbrook: 'Westbrook',
  Heywood: 'Heywood',
  SantoDomingo: 'Santo Domingo',
  Pacifica: 'Pacifica',
  CityCenter: 'City Center',
  Dogtown: 'Dogtown',
  Dogtown_Brooklyn: 'Dogtown',
  Badlands: 'Badlands',
  NorthBadlands: 'Badlands',
  SouthBadlands: 'Badlands',
};

/** A district record's enum name, readable: "LittleChina" is Little China, "Kabuki_LizziesBar" Lizzies Bar. */
export const placeName = (enumName) => String(enumName ?? '').split('_').pop().replace(/([a-z])([A-Z])/g, '$1 $2');

/** Why a question to REDagent failed, from the host's and REDagent's own words. */
export function problemOf(message) {
  const m = String(message ?? '');
  if (/agent permission|has not allowed/i.test(m)) return 'not-allowed';
  if (/No assistant is running|agent needs the REDnode host/i.test(m)) return 'no-agent';
  if (/daily limit/i.test(m)) return 'agent-cap';
  if (/paused this mod/i.test(m)) return 'agent-paused';
  return 'error';
}

/** The JSON object in an answer, or null. Models sometimes wrap it in a sentence or a code block. */
export function parseAnswer(text) {
  const t = String(text ?? '');
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i < 0 || j < i) return null;
  try {
    const o = JSON.parse(t.slice(i, j + 1));
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

// --- Likes ----------------------------------------------------------------------------------
// Worked out, never written: a post Chooms! wrote gathers likes over game time, quickly at
// first, more for an account with more followers. Each post's share is fixed by its id, so the
// count is the same every time it is drawn. Hand-written seed posts keep their own counts.

const FANS = { cast: 3000, figure: 8000, delamain: 6000, corp: 300000, gang: 20000 };
const fansOf = (a) => a?.fans ?? FANS[a?.kind] ?? 1000;
const share = (id) => 0.5 + createHash('sha1').update(String(id)).digest()[0] / 255;
const RISE = 4 * 3600; // game seconds

/** The likes a post (or, with `comment`, a comment) has gathered by game time `now`. */
export function grownLikes(item, { now, account, vFans, comment = false }) {
  if (item.seed || (!item.gen && item.by !== 'v')) return 0;
  const fans = item.by === 'v' ? vFans : fansOf(account);
  const age = Math.max(0, now - item.at);
  return Math.round(fans * (comment ? 0.002 : 0.03) * share(item.id) * (1 - Math.exp(-age / RISE)));
}

// --- Spending -------------------------------------------------------------------------------

const localDay = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD, the player's own day

/** What Chooms! spent on REDagent today, and a log of what it asked, kept in one file. */
export class Ledger {
  constructor(file) {
    this.file = file;
    this.data = { day: localDay(), usd: 0, log: [] };
    try {
      const d = JSON.parse(readFileSync(file, 'utf8'));
      this.data = { day: String(d.day ?? ''), usd: Number(d.usd) || 0, log: Array.isArray(d.log) ? d.log : [] };
    } catch {
      // first start
    }
  }

  #roll() {
    if (this.data.day !== localDay()) {
      this.data.day = localDay();
      this.data.usd = 0;
    }
  }

  get today() {
    this.#roll();
    return this.data.usd;
  }

  get log() {
    return this.data.log;
  }

  spend(cost) {
    this.#roll();
    this.data.usd += Number(cost) || 0;
    this.#save();
  }

  /** { who, what: 'post' | 'comment' | 'reply' | 'request', text?, cost?, note? } */
  add(entry) {
    this.data.log = [{ at: Date.now(), ...entry }, ...this.data.log].slice(0, 30);
    this.#save();
  }

  #save() {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data));
    renameSync(`${this.file}.tmp`, this.file);
  }
}

/** Thrown to end a round: the cap is reached, or REDagent cannot answer. */
export class Stop extends Error {
  constructor(kind, message = kind) {
    super(message);
    this.kind = kind;
  }
}

// --- The questions --------------------------------------------------------------------------

const KIND_WORDS = { cast: 'a person', figure: 'a person', delamain: "the AI that runs the Delamain cab company", corp: 'a corporation', gang: 'a gang' };

const VOICE = {
  person: 'Write in their own voice, as they would post it.',
  corp: "Write as the corporation's official account, in its public voice. It knows nothing about V.",
  gang: 'Write as the gang\'s account: one of the crew posting for all of them, in their voice. It knows V only as its cards say.',
};

const STORY_RULE = "Nothing in the story has happened beyond what the cards in the context say; the last card is where they are now. Never mention people, places or events from later in Cyberpunk 2077's story, even ones you know.";
const V_RULE = 'V is the player: a merc they know. Mention V only as their cards allow; most posts are about their own life, not about V.';

const FIGHT_RULE = 'V fought them lately: "fightsWithV" in the context says when, where and how many of theirs V downed or killed. They may call it out, threaten payback, mourn their own or play it down, as this gang would. Unless their cards name V, to them V is only a merc.';

const pronouns = (body) => (body === 'feminine' ? 'she/her' : body === 'masculine' ? 'he/him' : 'they/them');

/**
 * Posts and comments by Chooms!'s accounts. Its parts are passed in, so the offline tests drive
 * it with a stand-in REDagent and set dice:
 *   store, roster, story, cards  the history and the content
 *   general()                    the settings window's General values, read each time
 *   personOn(id)                 whether a person's posts are on in the settings
 *   media(id)                    their images: { images, portrait, body, places: [{ description, activities }] }
 *   ask(prompt, options)         agent.ask
 *   ledger                       a Ledger
 *   gate()                       null when V is free to be posted at, else why not
 *   onChange()                   something the app shows changed
 */
export class Poster {
  constructor({ store, roster, story, cards, general, personOn = () => true, media = () => null, ask, ledger, gate = () => null, onChange = () => {}, log = () => {}, rand = Math.random, replyDelayMs = [60000, 120000] }) {
    Object.assign(this, { store, roster, story, cards, general, personOn, media, ask, ledger, gate, onChange, log, rand, replyDelayMs });
    this.byId = new Map(roster.map((a) => [a.id, a]));
    this.words = spoilerWords({ cards, story, roster });
    this.where = { district: null, area: null, time: null, day: null };
    this.problem = null; // { kind, text } from the last question that failed, cleared by the next answer
    this.replies = []; // V's posts and comments waiting for an answer: { due, by, post, pid }
    this.chain = Promise.resolve();
  }

  passed() {
    return this.store.data?.story?.points ?? {};
  }

  /** Accounts that may post now, in `district` (roster.json's name, or null off every district's map). */
  candidates(district) {
    const s = this.store;
    const out = { people: [], corps: [], gangs: [] };
    if (!s.data?.story) return out;
    for (const a of this.roster) {
      if (!s.known(a.id)) continue;
      if (isOrg(a)) {
        if (district && a.districts?.includes(district)) (a.kind === 'gang' ? out.gangs : out.corps).push(a);
        continue;
      }
      if (!s.alive(a.id) || !this.personOn(a.id)) continue;
      // Story figures post only for V, once V follows them.
      if (a.kind === 'figure' && !s.relation(a.id).follows) continue;
      out.people.push(a);
    }
    return out;
  }

  /** The fights V had with a gang in the last FIGHT_MEMORY, newest first, as the questions tell them. */
  fightsWith(gang) {
    const now = this.store.data?.now ?? 0;
    const ago = (s) => (s < 86400 ? 'today' : s < 2 * 86400 ? 'yesterday' : `${Math.floor(s / 86400)} days ago`);
    return (this.store.data?.fights ?? [])
      .filter((f) => f.gang === gang && now - f.at <= FIGHT_MEMORY && Object.keys(f.people).length)
      .sort((a, b) => b.at - a.at)
      .map((f) => {
        const s = Store.fightSummary(f);
        return { when: ago(now - f.at), district: s.district, downed: s.downed, killed: s.killed };
      });
  }

  // An account that posted in the last three game hours waits.
  #fresh(id) {
    const now = this.store.data.now;
    return !this.store.data.posts.some((p) => p.by === id && p.gen && now - p.at < 3 * 3600);
  }

  #shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  /**
   * Who posts this check: each person with the people's chance, each corporation in the district
   * with the corporation chance, and at most one gang of the district with the gang chance; then
   * at most `maxPerCheck` of them. A gang of the district that V fought lately raises the gang
   * chance (fightChance) and is the one that posts. `force` (Post now) picks one when the dice pick none; `who`
   * picks that account, if it may post.
   */
  pick(district, { force = false, who = null } = {}) {
    const g = this.general();
    const c = this.candidates(district);
    if (who) return [...c.people, ...c.corps, ...c.gangs].filter((a) => a.id === who);
    const roll = (pct) => this.rand() * 100 < pct;
    const won = [...c.people.filter((a) => this.#fresh(a.id) && roll(g.peopleChance)), ...c.corps.filter((a) => this.#fresh(a.id) && roll(g.corpChance))];
    const gangs = c.gangs.filter((a) => this.#fresh(a.id));
    const fought = gangs.filter((a) => this.fightsWith(a.id).length);
    const pool = fought.length ? fought : gangs;
    if (pool.length && roll(fought.length ? fightChance(g.gangChance) : g.gangChance)) won.push(pool[Math.floor(this.rand() * pool.length)]);
    const picked = this.#shuffle(won).slice(0, g.maxPerCheck);
    if (force && !picked.length) {
      const any = [...c.people, ...c.corps, ...(c.gangs.length ? [c.gangs[Math.floor(this.rand() * c.gangs.length)]] : [])];
      if (any.length) picked.push(any[Math.floor(this.rand() * any.length)]);
    }
    return picked;
  }

  // What a question says about the account: who they are, their cards for this save, their last posts.
  #about(a) {
    const s = this.store;
    const story = s.data.story;
    const out = {
      account: { name: a.name, handle: `@${a.handle}`, is: KIND_WORDS[a.kind] ?? 'a person', tag: a.tag ?? null, bio: a.bio ?? '', home: a.home ?? null, districts: a.districts },
      cards: cardsFor(this.cards, a.id, this.passed(), this.story).map(({ point, text }) => ({ point, text })),
      theirRecentPosts: s.data.posts.filter((p) => p.by === a.id).sort((x, y) => y.at - x.at).slice(0, 3).map((p) => p.text),
      now: { district: this.where.district, area: this.where.area, time: this.where.time, day: this.where.day },
    };
    if (a.kind === 'gang') {
      const fights = this.fightsWith(a.id);
      if (fights.length) out.fightsWithV = fights;
    }
    if (!isOrg(a)) {
      const r = s.relation(a.id);
      out.v = { pronouns: pronouns(story?.body), relation: r.request === 'accepted' ? 'V is their choom on Chooms!' : r.followsV ? 'they follow V on Chooms!' : 'they know V' };
    }
    return out;
  }

  #voice(a) {
    return VOICE[isOrg(a) ? a.kind : 'person'];
  }

  // A person's photo for this post, by the weights, if their images allow one: a selfie at one of
  // their places, or them doing one of its activities (which needs their body image). C4 makes
  // the picture from the scene line; until then the post is shown as text.
  #photo(a) {
    if (isOrg(a)) return { kind: 'text' };
    const m = this.media(a.id);
    if (!m?.images || !m.portrait || !m.places?.length) return { kind: 'text' };
    const g = this.general();
    const withActs = m.places.map((p, i) => ({ ...p, i })).filter((p) => p.activities?.length);
    const w = [g.weightText, g.weightSelfie, m.body && withActs.length ? g.weightActivity : 0].map((x) => Math.max(0, Number(x) || 0));
    let r = this.rand() * (w[0] + w[1] + w[2]);
    if (!(r >= 0) || r < w[0]) return { kind: 'text' };
    r -= w[0];
    if (r < w[1]) {
      const i = Math.floor(this.rand() * m.places.length);
      return { kind: 'selfie', place: i, description: m.places[i].description || 'one of their places' };
    }
    const p = withActs[Math.floor(this.rand() * withActs.length)];
    return { kind: 'activity', place: p.i, description: p.description || 'one of their places', activity: p.activities[Math.floor(this.rand() * p.activities.length)] };
  }

  // One question, counted against the cap. A refusal names what is wrong (problemOf) and ends the
  // round. The second check of an answer already paid for runs even past the cap, so a post is
  // never thrown away half done; the next post waits for tomorrow.
  async #ask(prompt, context, model, { capped = true } = {}) {
    const g = this.general();
    if (capped && this.ledger.today >= g.dailyCapUsd) throw new Stop('cap');
    let res;
    try {
      res = await this.ask(prompt, { context, tools: false, model });
    } catch (err) {
      const msg = String(err?.message ?? err);
      this.problem = { kind: problemOf(msg), text: msg };
      throw new Stop(this.problem.kind, msg);
    }
    this.problem = null;
    const cost = Number(res?.cost) || 0;
    this.ledger.spend(cost);
    return { text: String(res?.text ?? ''), cost };
  }

  // The second check: a cheap model reads the text against the story points passed and not.
  async #check(a, text) {
    const passed = this.passed();
    const done = this.story.points.filter((p) => p.id in passed).map((p) => p.note);
    const notYet = this.story.points.filter((p) => !(p.id in passed)).map((p) => p.note);
    const prompt = `Check one post on Chooms!, a social feed in Cyberpunk 2077's Night City, for spoilers. It is by ${a.name}. The player's story has reached only the points in "done"; those in "notYet" have not happened. Does the post mention, hint at or depend on anything that has not happened yet, or that ${a.name} could not know by now? Public facts about Night City are fine. Answer only with JSON: {"leak": true or false, "why": "a few words"}.`;
    const res = await this.#ask(prompt, { post: text, by: a.name, done, notYet }, 'haiku', { capped: false });
    const o = parseAnswer(res.text);
    return { leak: o?.leak === true, why: String(o?.why ?? '').slice(0, 120), cost: res.cost };
  }

  // Asks, checks, and asks once more if the answer is thrown away. Returns { answer, cost, why }.
  async #write(a, prompt, context) {
    const forbidden = forbiddenFor(this.words, this.passed());
    let cost = 0;
    let why = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.#ask(attempt ? `${prompt}\n\nYour last answer was thrown away (${why}). Write a different one.` : prompt, context, this.general().postModel);
      cost += res.cost;
      const ans = parseAnswer(res.text);
      if (typeof ans?.text !== 'string' || !ans.text.trim()) {
        why = 'it was not the JSON asked for';
        continue;
      }
      const found = leaks(`${ans.text} ${ans.scene ?? ''}`, forbidden);
      if (found.length) {
        why = `it named ${found.join(', ')}, which has not come up in the story yet`;
        this.log(`${a.name}: an answer thrown away: it named ${found.join(', ')}`);
        continue;
      }
      if (this.general().secondCheck) {
        const chk = await this.#check(a, ans.text);
        cost += chk.cost;
        if (chk.leak) {
          why = `it gave away something that has not happened yet: ${chk.why}`;
          this.log(`${a.name}: an answer thrown away by the check: ${chk.why}`);
          continue;
        }
      }
      return { answer: ans, cost, why: '' };
    }
    return { answer: null, cost, why };
  }

  /** One post by `a`. Returns the post, or null when both answers were thrown away. */
  async post(a) {
    const pid = this.store.id;
    const photo = this.#photo(a);
    const lines = [
      `Write one new post for Chooms!, Night City's social feed in 2077, as ${a.name} (@${a.handle}), ${KIND_WORDS[a.kind] ?? 'a person'}. Who they are and what they know is in the context: their knowledge cards, in the story's order.`,
      `${this.#voice(a)} Short: one to three sentences, under 280 characters. No hashtags or emoji unless they would use them. Do not repeat their recent posts. It is ${this.where.time ?? 'some time'} in ${this.where.area ? `${this.where.area}, ` : ''}${this.where.district ?? 'Night City'}; the post may fit the hour, but need not be about the place.`,
      STORY_RULE,
      isOrg(a) ? '' : V_RULE,
      a.kind === 'gang' && this.fightsWith(a.id).length ? FIGHT_RULE : '',
      photo.kind === 'text'
        ? 'Answer only with JSON: {"text": "the post"}.'
        : `The post comes with a photo: ${photo.kind === 'selfie' ? 'a selfie of them' : `them ${photo.activity}`} at ${photo.description}. Write the caption, and "scene": one line describing that photo for an image model (them, the place, what they are doing, their expression, the light). Answer only with JSON: {"text": "the caption", "scene": "the photo"}.`,
    ].filter(Boolean);
    const { answer, cost, why } = await this.#write(a, lines.join('\n'), this.#about(a));
    if (this.store.id !== pid) return null; // another playthrough was loaded meanwhile
    if (!answer) {
      this.ledger.add({ who: a.id, what: 'post', cost, note: `not posted: ${why}` });
      return null;
    }
    const extra = { gen: true, kind: photo.kind };
    if (photo.kind !== 'text') Object.assign(extra, { scene: String(answer.scene ?? '').slice(0, 300), place: photo.place, activity: photo.activity ?? null });
    const p = this.store.newPost(answer.text, a.id, null, 0, extra);
    this.ledger.add({ who: a.id, what: 'post', cost, text: p.text });
    this.log(`${a.name} posted ($${cost.toFixed(4)}): ${p.text.slice(0, 80)}`);
    this.onChange();
    return p;
  }

  /** One comment by `a` on `post`; `toV` when it answers V. Returns the comment or null. */
  async comment(a, post, { toV = false } = {}) {
    const pid = this.store.id;
    const nameOf = (id) => (id === 'v' ? 'V' : this.byId.get(id)?.name ?? id);
    const context = {
      ...this.#about(a),
      post: { by: nameOf(post.by), text: post.text },
      comments: post.comments.slice(-6).map((c) => ({ by: nameOf(c.by), text: c.text })),
    };
    const lines = [
      `Write one comment on a Chooms! post, as ${a.name} (@${a.handle}). The post and the latest comments under it are in the context, with their knowledge cards.`,
      post.by === 'v' ? `The post is V's own.` : post.by === a.id ? 'The post is their own.' : '',
      toV ? 'V wrote the last comment, or the post: answer V.' : '',
      `${this.#voice(a)} One or two short sentences, under 200 characters.`,
      STORY_RULE,
      isOrg(a) ? '' : V_RULE,
      'Answer only with JSON: {"text": "the comment"}.',
    ].filter(Boolean);
    const { answer, cost, why } = await this.#write(a, lines.join('\n'), context);
    const what = toV ? 'reply' : 'comment';
    if (this.store.id !== pid || !this.store.data.posts.includes(post)) return null;
    if (!answer) {
      this.ledger.add({ who: a.id, what, cost, note: `not posted: ${why}` });
      return null;
    }
    const c = this.store.npcComment(post.id, a.id, answer.text, toV ? { toV: true } : {});
    this.ledger.add({ who: a.id, what, cost, text: c.text });
    this.log(`${a.name} ${toV ? 'answered V' : 'commented'} ($${cost.toFixed(4)}): ${c.text.slice(0, 80)}`);
    this.onChange();
    return c;
  }

  // People who may comment: those who may post, less corporations and gangs.
  #commenters() {
    return this.candidates(null).people;
  }

  // Whether `a`'s cards for this save name the author: who they know of.
  #knowsOf(a, authorId) {
    const author = this.byId.get(authorId);
    if (!author) return false;
    const name = author.name.replace(/^The /, '').split(' ')[0];
    return cardsFor(this.cards, a.id, this.passed(), this.story).some((c) => c.text.includes(name));
  }

  /** NPCs' comments on each other's recent posts (and on V's, by those who follow V), at most maxCommentsPerCheck. */
  async comments(n) {
    const s = this.store;
    const now = s.data.now;
    const pairs = [];
    for (const p of s.data.posts) {
      if (now - p.at > 86400) continue;
      if (p.by !== 'v' && !s.known(p.by)) continue;
      for (const a of this.#commenters()) {
        if (a.id === p.by || p.comments.some((c) => c.by === a.id)) continue;
        if (p.by === 'v' ? s.relation(a.id).followsV : this.#knowsOf(a, p.by)) pairs.push([a, p]);
      }
    }
    let made = 0;
    for (const [a, p] of this.#shuffle(pairs)) {
      if (made >= n) break;
      if (this.rand() * 100 >= this.general().peopleChance) continue;
      if (await this.comment(a, p)) made++;
    }
    return made;
  }

  /**
   * Follows and Choom Requests (no AI): each cast member and Delamain whom V has met follows V;
   * the first whose story point (`requestAt`) the save has passed sends V a Choom Request, one
   * per call, so they come one at a time.
   */
  social() {
    const s = this.store;
    if (!s.data?.story) return false;
    const passed = this.passed();
    let changed = false;
    let asked = false;
    for (const a of this.roster) {
      if (a.kind !== 'cast' && a.kind !== 'delamain') continue;
      if (!s.known(a.id) || !s.alive(a.id) || !this.personOn(a.id)) continue;
      if (s.followV(a.id)) changed = true;
      if (!asked && a.requestAt && a.requestAt in passed && s.sendRequest(a.id)) {
        asked = changed = true;
        this.ledger.add({ who: a.id, what: 'request', note: 'sent V a Choom Request' });
        this.log(`${a.name} sent V a Choom Request`);
      }
    }
    if (changed) this.onChange();
    return changed;
  }

  /**
   * V posted or commented (the app): who answers, in a minute or two. A new post of V's: some of
   * those who follow V. A comment on someone's post: its author. A comment on V's own post: the
   * last who commented on it.
   */
  onV({ post: postId }) {
    const s = this.store;
    const post = s.data?.posts.find((p) => p.id === postId);
    if (!post) return;
    const pool = new Map(this.#commenters().map((a) => [a.id, a]));
    let who = [];
    const last = post.comments.at(-1);
    if (last?.by === 'v' && post.by !== 'v') who = pool.has(post.by) ? [post.by] : [];
    else if (last?.by === 'v') {
      const other = [...post.comments].reverse().find((c) => c.by !== 'v' && pool.has(c.by));
      if (other) who = [other.by];
    } else if (post.by === 'v' && !post.comments.length) {
      const fans = this.#shuffle([...pool.values()].filter((a) => s.relation(a.id).followsV).map((a) => a.id));
      who = fans.slice(0, Math.max(1, this.general().maxCommentsPerCheck)).filter((_, i) => i === 0 || this.rand() < 0.6);
    }
    const [lo, hi] = this.replyDelayMs;
    who.forEach((by, i) => {
      if (this.replies.some((r) => r.by === by && r.post === postId)) return;
      this.replies.push({ due: Date.now() + lo + this.rand() * (hi - lo) + i * 15000, by, post: postId, pid: s.id });
    });
  }

  #serial(fn) {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => {});
    return run;
  }

  #stopped(err) {
    if (!(err instanceof Stop)) throw err;
    if (err.kind === 'cap') this.log('Today\'s spending has reached the cap: no more posts today');
    else this.log(`REDagent did not answer: ${err.message}`);
    return err.kind;
  }

  /** Answers due to V, when V is free to be posted at. Called on each of mod.mjs's ticks. */
  tick() {
    if (!this.replies.length || this.gate()) return null;
    const due = this.replies.filter((r) => r.due <= Date.now());
    if (!due.length) return null;
    this.replies = this.replies.filter((r) => !due.includes(r));
    return this.#serial(async () => {
      for (const r of due) {
        const post = this.store.data?.posts.find((p) => p.id === r.post);
        const a = this.byId.get(r.by);
        if (r.pid !== this.store.id || !post || !a) continue;
        await this.comment(a, post, { toV: true });
      }
    }).catch((err) => this.#stopped(err));
  }

  /**
   * A check: follows and requests, posts, then comments. `where` is { district, area, time, day }.
   * Options: `force` and `who` for Post now (`who` posts and nothing else). Resolves with
   * { posts, comments, stopped }.
   */
  cycle(where, { force = false, who = null } = {}) {
    return this.#serial(async () => {
      const out = { posts: 0, comments: 0, stopped: null };
      const why = this.gate();
      if (why) return { ...out, stopped: why };
      this.where = where;
      try {
        if (!who) this.social();
        for (const a of this.pick(where.district, { force, who })) if (await this.post(a)) out.posts++;
        if (!who) out.comments = await this.comments(this.general().maxCommentsPerCheck);
      } catch (err) {
        out.stopped = this.#stopped(err);
      }
      return out;
    });
  }
}
