// C2 spike: what the game's journal holds for a save, so Chooms! can know who V has met, the
// story so far and V's texts. Reads only (Get and Is functions); changes nothing in the game.
//
// Copy this folder into the game's red4ext/plugins/REDnode/apps/ while the game runs. Each time
// a save is loaded (and once at start, with V in the world) it writes the journal to
// <pkg.dataDir>/scan-<date>.json and latest.json. That data comes from the game: it stays on the
// PC and is never committed. Remove the folder from the apps folder when done.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { api, game, loc, pkg } from 'rednode';

const SEEN = { inactive: false, active: true, succeeded: true, failed: true };
const EVERY = { inactive: true, active: true, succeeded: true, failed: true };
const TITLED = new Set(['gameJournalCodexEntry', 'gameJournalPhoneConversation', 'gameJournalQuestPhase', 'gameJournalQuestObjective', 'gameJournalQuestSubObjective', 'gameJournalCodexDescription']);

// game.state() is a promise in a Node mod; onState follows it. V arriving in the world (at start
// or after a load) asks for a scan.
let pending = true;
let running = false;
let inWorld = false;
const onState = (s) => {
  const now = !!(s?.connected && s?.world);
  if (now && !inWorld) pending = true;
  inWorld = now;
};
game.onState(onState);
game.state().then(onState).catch(() => {});
setInterval(() => {
  if (pending && !running && inWorld) {
    pending = false;
    scan().catch((err) => console.log(`Scan failed: ${err.stack ?? err}`));
  }
}, 3000);

async function scan() {
  running = true;
  const t0 = Date.now();
  let calls = 0;
  const call = (p) => (calls++, p);
  console.log('Scanning...');
  try {
    const jm = await api.GameInstance.GetJournalManager(game.instance);
    const typeOf = async (e) => e.$type ?? String(await call(e.GetClassName())).replace(/^.*::/, '');
    const kids = async (e, filter = SEEN) => (await call(jm.GetChildren(e, filter, []))).out.childEntries.filter(Boolean);
    const when = async (e) => (await call(jm.GetEntryTimestamp(e)))?.seconds ?? null;

    // An entry and its children to `depth`, with only the entries V has seen.
    async function node(e, depth, filter = SEEN) {
      const type = await typeOf(e);
      const [id, state, at] = await Promise.all([call(e.GetId()), call(jm.GetEntryState(e)), when(e)]);
      const n = { id, type, state, at };
      if (TITLED.has(type)) n.title = await call(e.GetTitle()).catch(() => null);
      if (type === 'gameJournalQuestObjective') n.optional = await call(jm.GetIsObjectiveOptional(e)).catch(() => null);
      if (depth > 0) {
        const list = await kids(e, filter);
        if (list.length) n.children = [];
        for (const k of list) n.children.push(await node(k, depth - 1, filter));
      }
      return n;
    }
    // The path of ids from the journal's root, as REDnode's game_journal shows it.
    async function path(e) {
      const ids = [];
      for (let at = e; at; at = await call(jm.GetParentEntry(at))) ids.unshift(await call(at.GetId()));
      return ids.filter(Boolean).join('/');
    }

    // Quests: each with its phases and objectives.
    const quests = [];
    for (const q of (await call(jm.GetQuests({ stateFilter: SEEN }, []))).out.entries.filter(Boolean)) {
      const n = await node(q, 2);
      const [title, kind, p] = await Promise.all([call(q.GetTitle(jm)), call(q.GetType()), path(q)]);
      quests.push({ ...n, title, kind, path: p });
      if (quests.length % 20 === 0) console.log(`  ${quests.length} quests so far, ${calls} calls`);
    }

    console.log(`${quests.length} quests, ${calls} calls, ${Math.round((Date.now() - t0) / 1000)} s`);
    // Contacts, known or not, with their conversations, messages and V's replies.
    const contacts = [];
    for (const c of (await call(jm.GetContacts({ stateFilter: EVERY }, []))).out.entries.filter(Boolean)) {
      const [id, name, avatar, kind, known, callable, state, at] = await Promise.all([
        call(c.GetId()), call(c.GetLocalizedName(jm)), call(c.GetAvatarID(jm)), call(c.GetType()),
        call(c.IsKnown(jm)), call(c.IsCallable(jm)), call(jm.GetEntryState(c)), when(c),
      ]);
      const conversations = [];
      for (const conv of (await call(jm.GetConversations(c, []))).out.conversations.filter(Boolean)) try {
        const [cid, title, cstate, cat] = await Promise.all([call(conv.GetId()), call(conv.GetTitle()), call(jm.GetEntryState(conv)), when(conv)]);
        const { messages, choiceEntries } = (await call(jm.GetMessagesAndChoices(conv, [], []))).out;
        const msgs = [];
        // The messages list holds V's reply choices too (gameJournalPhoneChoiceEntry): they go with the choices.
        for (const m of messages.filter(Boolean)) {
          if ((await typeOf(m)) === 'gameJournalPhoneChoiceEntry') {
            choiceEntries.push(m);
            continue;
          }
          const [mid, sender, text, image, mstate, mat] = await Promise.all([call(m.GetId()), call(m.GetSender()), call(m.GetText()), call(m.GetImageID()), call(jm.GetEntryState(m)), when(m)]);
          msgs.push({ id: mid, sender, text, image: image && image !== '0' ? image : undefined, state: mstate, at: mat });
        }
        const choices = [];
        for (const ch of choiceEntries.filter(Boolean)) {
          const [chid, text, chstate, chat] = await Promise.all([call(ch.GetId()), call(ch.GetText()), call(jm.GetEntryState(ch)), when(ch)]);
          choices.push({ id: chid, text, state: chstate, at: chat, i: messages.indexOf(ch) });
        }
        conversations.push({ id: cid, title, state: cstate, at: cat, messages: msgs, choices });
      } catch (err) {
        conversations.push({ error: String(err.message ?? err) });
      }
      contacts.push({ id, name, avatar, kind, known, callable, state, at, conversations });
    }

    console.log(`${contacts.length} contacts, ${calls} calls, ${Math.round((Date.now() - t0) / 1000)} s`);
    // The codex (the database): its characters entries unlock as V meets people.
    const codex = [];
    for (const cat of (await call(jm.GetCodexCategories({ stateFilter: SEEN }, []))).out.entries.filter(Boolean)) {
      const n = await node(cat, 2);
      codex.push({ ...n, name: await call(cat.GetCategoryName()).catch(() => null) });
    }

    // Every LocKey above, in the player's language.
    const keys = new Set();
    JSON.stringify({ quests, contacts, codex }, (k, v) => (typeof v === 'string' && /^LocKey#\d+$/.test(v) && keys.add(v), v));
    const list = [...keys];
    const texts = {};
    for (let i = 0; i < list.length; i += 200) {
      const got = await loc.text(list.slice(i, i + 200));
      list.slice(i, i + 200).forEach((k, j) => (texts[k] = got[j]));
    }

    const time = (await call(api.GameInstance.GetTimeSystem(game.instance)).then((ts) => ts.GetGameTimeStamp()).catch(() => null));
    const out = { scanned: new Date().toISOString(), gameTime: time, calls, ms: Date.now() - t0, quests, contacts, codex, texts };
    mkdirSync(pkg.dataDir, { recursive: true });
    const file = join(pkg.dataDir, `scan-${out.scanned.replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(out, null, 1));
    writeFileSync(join(pkg.dataDir, 'latest.json'), JSON.stringify(out, null, 1));
    console.log(`Scanned: ${quests.length} quests, ${contacts.length} contacts, ${codex.length} codex categories, ${calls} calls in ${Math.round(out.ms / 1000)} s -> ${file}`);
  } finally {
    running = false;
  }
}
