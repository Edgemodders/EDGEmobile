// A stand-in for REDnode's `rednode` package (0.47.2), enough for EDGEmobile's and Chooms!'s mods.
// One instance per package: hooks.mjs loads this file as ?pkg=<id> for each. The game, the
// services between packages and the facts are shared through the harness (globalThis.__harness).
// The game's district and weather follow the shapes in REDnode's game API reference (2.5).
// game.state().world and loc.text follow REDnode #25 and #26: world is false until the harness
// puts V in the world (H.setWorld), and GameInstance calls are refused while it is false.
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const H = globalThis.__harness;
const PKG = new URL(import.meta.url).searchParams.get('pkg') ?? 'edgemobile';

export const pkg = PKG === 'edgemobile'
  ? { id: 'edgemobile', dir: H.pkgDir, dataDir: H.dataDir, appsDirs: [] }
  : { id: PKG, dir: H.pkgDirs[PKG], dataDir: join(H.dataDir, '..', PKG), appsDirs: [] };

// The package channel: EDGEmobile's is H.toMod / H.fromMod (as before); others H.chan[id].
const handlers = [];
H.chan ??= {};
export const channel = {
  post: (m) => (PKG === 'edgemobile' ? H.fromMod(m) : H.chan[PKG]?.fromMod?.(m)),
  on: (h) => handlers.push(h),
};
if (PKG === 'edgemobile') H.toMod = (m) => handlers.forEach((h) => h(m));
else (H.chan[PKG] ??= {}).toMod = (m) => handlers.forEach((h) => h(m));

// The game's state, shared. Until the plugin's first ui-state REDnode reports the main menu, no world.
H.world ??= false;
H.mainMenu ??= !H.world;
H.stateHandlers ??= [];
H.time ??= 3 * 86400 + 14 * 3600 + 5 * 60;
const gameState = () => ({ connected: true, overlay: 'closed', menu: !!H.menu, photoMode: false, scene: false, mainMenu: !!H.mainMenu, world: !!H.world });
// H.menu = true, then H.emitState(): a menu opens (the C3 check waits for it to close).
H.emitState ??= () => H.stateHandlers.forEach((h) => h(gameState()));
H.setWorld ??= (world, mainMenu = false) => {
  H.world = world;
  H.mainMenu = mainMenu;
  H.stateHandlers.forEach((h) => h(gameState()));
};
H.gameOn ??= {};
H.fire ??= (name, e) => (H.gameOn[name] ?? []).forEach((h) => h(e));
export const game = {
  instance: { $type: 'GameInstance' },
  // Game events (REDnode 0.73.0's combat and npcDowned, #61): H.fire(name, event) sends one.
  on: (name, h) => {
    (H.gameOn[name] ??= []).push(h);
    return () => H.gameOn[name].splice(H.gameOn[name].indexOf(h), 1);
  },
  onState: (h) => H.stateHandlers.push(h),
  state: async () => gameState(),
  player: { position: async () => (H.world ? { x: 0, y: 0, z: 0 } : Promise.reject(new Error('no player'))) },
};

// Every call into the game's world, counted. One made while V is not in the world is a bad
// call: REDnode refuses the GameInstance ones, but not methods on objects a mod already holds.
// H.loadAt = 'GetWeatherSystem': a load starts just as that call is made, and the mods hear of
// it only H.eventLate ms later (the 0.0.7 test: the world went away between two calls of a round).
H.worldCalls ??= 0;
H.badCalls ??= 0;
H.refused ??= 0;
const gate = (fn, name) => async (...a) => {
  if (H.loadAt === name) {
    H.loadAt = null;
    H.world = false;
    H.loadStarted = Date.now();
    setTimeout(() => H.stateHandlers.forEach((h) => h(gameState())), H.eventLate ?? 3000);
  }
  H.worldCalls++;
  if (!H.world) {
    H.badCalls++;
    H.refused++;
    throw new Error("V is not in the world yet: this call reaches the game's world");
  }
  return fn(...a);
};
const held = (fn) => async (...a) => {
  H.worldCalls++;
  if (!H.world) H.badCalls++;
  return fn(...a);
};
// The journal, in the shapes the C2 spike found (docs/design.md, "C2 spike"). H.journal is the
// loaded save's: entries by path ({ state, at }; any other path is a real entry, Inactive), the
// codex's character entries (base game and Phantom Liberty), and contacts (id -> known). By
// default an early save in which V has met C1's test people. H.journalFail breaks the codex.
H.journal ??= {
  entries: {
    'quests/main_quest/prologue/q000_corpo': { state: 'Succeeded', at: 81000 },
    'quests/main_quest/prologue/q001_intro': { state: 'Succeeded', at: 252000 },
  },
  codex: ['v_corpo_f', 'judy_alvarez', 'jackie_welles', 'panam_palmer', 'river_ward', 'kerry_eurodyne'],
  codexEp1: [],
  contacts: { judy: true, jackie: true, panam: true, takemura: false },
};
H.journalCalls ??= 0;
const jheld = (fn) => held(async (...a) => (H.journalCalls++, fn(...a)));
const jentry = (id, extra = {}) => ({ $type: 'gameJournalEntry', GetId: jheld(async () => id), ...extra });
function journalManager() {
  const J = H.journal;
  const cat = (id, groups) => jentry(id, { $kids: groups });
  const group = (id, ids) => jentry(id, { $kids: ids.map((x) => jentry(x)) });
  return {
    GetEntryByString: jheld(async (path) => jentry(path.split('/').pop(), { $path: path })),
    GetEntryState: jheld(async (e) => J.entries[e.$path]?.state ?? 'Inactive'),
    GetEntryTimestamp: jheld(async (e) => ({ seconds: J.entries[e.$path]?.at ?? 0 })),
    GetChildren: jheld(async (e) => ({ result: undefined, out: { childEntries: e.$kids ?? [] } })),
    GetCodexCategories: jheld(async () => {
      if (H.journalFail) throw new Error('the codex broke');
      return { result: undefined, out: { entries: [cat('glossary', [group('world', ['night_city'])]), cat('characters', [group('quests', J.codex), group('fixers', [])]), cat('characters', [group('quest', J.codexEp1 ?? [])])] } };
    }),
    GetContacts: jheld(async () => ({ result: undefined, out: { entries: Object.entries(J.contacts).map(([id, known]) => jentry(id, { IsKnown: jheld(async () => known) })) } })),
  };
}

const watson = { ParentDistrict: held(async () => null), LocalizedName: held(async () => 'LocKey#10947'), EnumName: held(async () => 'Watson') };
const littleChina = { ParentDistrict: held(async () => watson), LocalizedName: held(async () => 'LocKey#10963'), EnumName: held(async () => 'LittleChina') };
export const api = {
  GameInstance: {
    GetTimeSystem: gate(async () => ({ GetGameTime: held(async () => ({ seconds: H.time })) }), 'GetTimeSystem'),
    GetScriptableSystemsContainer: gate(async () => ({
      Get: held(async (name) => (name === 'PreventionSystem' ? { GetCurrentDistrict: held(async () => ({ GetDistrictRecord: held(async () => littleChina) })) } : null)),
    }), 'GetScriptableSystemsContainer'),
    GetWeatherSystem: gate(async () => ({ GetRainIntensityType: held(async () => H.rain ?? 'LightRain') }), 'GetWeatherSystem'),
    GetJournalManager: gate(async () => journalManager(), 'GetJournalManager'),
  },
};

// Quest facts (REDnode's quests), kept per save in the game: here H.facts. Reading one goes
// through the game's quests system, so it needs the world like any GameInstance call.
H.facts ??= {};
const questsGate = gate(async () => true, 'GetQuestsSystem');
export const quests = {
  fact: async (name) => (await questsGate(), H.facts[name] ?? 0),
  facts: async (names) => (await questsGate(), Object.fromEntries(names.map((n) => [n, H.facts[n] ?? 0]))),
  setFact: async (name, value) => {
    await questsGate();
    H.facts[name] = Math.trunc(value);
  },
};

// The game's text (REDnode #26). H.lang picks the language; H.locNull makes every key unknown.
const TEXT = {
  en: { 'LocKey#10947': 'Watson', 'LocKey#10963': 'Little China' },
  ru: { 'LocKey#10947': 'Уотсон', 'LocKey#10963': 'Маленький Китай' },
};
H.locCalls ??= 0;
const one = (key) => {
  H.locCalls++;
  const k = typeof key === 'number' ? `LocKey#${key}` : key;
  return H.locNull ? null : (TEXT[H.lang ?? 'en'][k] ?? null);
};
export const loc = {
  text: async (key) => (Array.isArray(key) ? key.map(one) : one(key)),
  language: async () => H.lang ?? 'en',
};

// The AI assistant (agent.ask, REDnode 0.72.0 with #54): a stand-in REDagent with set answers.
// H.agent(prompt, options, pkg) answers ({ text, cost }) or throws; with none, the host's own
// refusal when no assistant runs. Every question is kept in H.asks. The limits are REDnode's.
H.asks ??= [];
export const agent = {
  ask: async (prompt, options = {}) => {
    const json = options.context === undefined ? '' : JSON.stringify(options.context);
    H.asks.push({ pkg: PKG, prompt, context: options.context, tools: options.tools, model: options.model, contextChars: json.length });
    if (prompt.length > 20000) throw new Error(`The question is ${prompt.length} characters; agent.ask takes at most 20000. Put the data in context.`);
    if (json.length > 65536) throw new Error(`The context is ${json.length} characters of JSON; agent.ask takes at most 65536. Send less, such as only the recent posts.`);
    if (!H.agent) throw new Error('No assistant is running. Install REDagent and switch it on.');
    return H.agent(prompt, options, PKG);
  },
};

// TweakDB ids (tweakdb.id): a stand-in hash in the game's "0x" and 16 hex digits form.
export const tweakdb = { id: (path) => `0x${createHash('sha1').update(String(path)).digest('hex').slice(0, 16).toUpperCase()}` };

// Services between packages. H.services[id] is a package's service file, once it runs; a call
// sets that provider's caller to this package for the call. H.caller still overrides EDGEmobile's
// own caller for the tests of its service.
H.services ??= {};
H.callers ??= {};
H.events ??= new Map(); // `${provider} ${name}` -> Set of handlers
export const service = {
  caller: () => (PKG === 'edgemobile' ? H.caller ?? null : H.callers[PKG] ?? null),
  emit: (name, data) => {
    for (const h of H.events.get(`${PKG} ${name}`) ?? []) h(data);
  },
  connect: async (id) => {
    const handle = new Proxy({}, {
      get(_t, fn) {
        if (fn === 'then') return undefined;
        if (fn === '$with') return () => handle;
        if (fn === '$on') {
          return (name, h) => {
            const key = `${id} ${name}`;
            if (!H.events.has(key)) H.events.set(key, new Set());
            H.events.get(key).add(h);
            return () => H.events.get(key).delete(h);
          };
        }
        return async (...args) => {
          const mod = H.services[id];
          if (!mod) throw new Error(`${id} is not running`);
          if (typeof mod[fn] !== 'function') throw new Error(`${id} has no function ${String(fn)}`);
          H.callers[id] = { id: PKG, name: PKG };
          try {
            return await mod[fn](...JSON.parse(JSON.stringify(args)));
          } finally {
            H.callers[id] = null;
          }
        };
      },
    });
    if (!H.services[id]) throw new Error(`${id} is not running`);
    return handle;
  },
};
export { join };
