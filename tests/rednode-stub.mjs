// A stand-in for REDnode's `rednode` package (0.47.2), enough for EDGEmobile's and Chooms!'s mods.
// One instance per package: hooks.mjs loads this file as ?pkg=<id> for each. The game, the
// services between packages and the facts are shared through the harness (globalThis.__harness).
// The game's district and weather follow the shapes in REDnode's game API reference (2.5).
// game.state().world and loc.text follow REDnode #25 and #26: world is false until the harness
// puts V in the world (H.setWorld), and GameInstance calls are refused while it is false.
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
const gameState = () => ({ connected: true, overlay: 'closed', menu: false, photoMode: false, scene: false, mainMenu: !!H.mainMenu, world: !!H.world });
H.setWorld ??= (world, mainMenu = false) => {
  H.world = world;
  H.mainMenu = mainMenu;
  H.stateHandlers.forEach((h) => h(gameState()));
};
export const game = {
  instance: { $type: 'GameInstance' },
  on: () => {},
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
const watson = { ParentDistrict: held(async () => null), LocalizedName: held(async () => 'LocKey#10947'), EnumName: held(async () => 'Watson') };
const littleChina = { ParentDistrict: held(async () => watson), LocalizedName: held(async () => 'LocKey#10963'), EnumName: held(async () => 'LittleChina') };
export const api = {
  GameInstance: {
    GetTimeSystem: gate(async () => ({ GetGameTime: held(async () => ({ seconds: H.time })) }), 'GetTimeSystem'),
    GetScriptableSystemsContainer: gate(async () => ({
      Get: held(async (name) => (name === 'PreventionSystem' ? { GetCurrentDistrict: held(async () => ({ GetDistrictRecord: held(async () => littleChina) })) } : null)),
    }), 'GetScriptableSystemsContainer'),
    GetWeatherSystem: gate(async () => ({ GetRainIntensityType: held(async () => H.rain ?? 'LightRain') }), 'GetWeatherSystem'),
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
