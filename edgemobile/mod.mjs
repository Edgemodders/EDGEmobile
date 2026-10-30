// EDGEmobile's Node mod (docs/design.md): the web server and WebSocket on 127.0.0.1, Cloudflare's
// quick tunnel through the keeper, pairing with Allow and Deny, paired phones that prove
// themselves by signature, and the game's time sent to each phone. The Connect window is
// connect/window.html; it talks to this mod over the package channel.

import { api, channel, game, loc, pkg } from 'rednode';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import qrcode from 'qrcode-generator';
import { Phones } from './server/phones.mjs';
import { CLOUDFLARED, Tunnel, fetchCloudflared, findCloudflared } from './server/tunnel.mjs';
import { startWeb } from './server/web.mjs';

// The loader: a fixed page on its own origin that the phone installs, showing the PC's page in a frame.
const LOADER_ORIGIN = 'https://mobile.edgemodders.ai';
const LOADER = `${LOADER_ORIGIN}/`;
const TICK_MS = 1000;
const THEMES = ['nightcity', 'edgemodders'];

mkdirSync(pkg.dataDir, { recursive: true });

// One fixed local port, chosen at first start and kept, so a restarted mod can reuse the tunnel.
const settingsFile = join(pkg.dataDir, 'settings.json');
let settings = {};
try {
  settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
} catch {
  // first start
}
if (!settings.port) {
  settings.port = await pickPort();
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}
if (!THEMES.includes(settings.theme)) settings.theme = 'nightcity';
const port = settings.port;
const localOrigin = `http://127.0.0.1:${port}`;
const saveSettings = () => writeFileSync(settingsFile, JSON.stringify(settings, null, 2));

const view = {
  cloudflared: { have: !!findCloudflared(pkg.dataDir), version: CLOUDFLARED.version, mb: Math.round(CLOUDFLARED.size / 1e6) },
  fetching: null,
  error: null,
  tunnel: { status: 'off', url: null },
  autoStart: !!settings.autoStart,
  qr: null,
  port,
  webError: null,
};
const conns = new Set(); // { ws, id, name, local, rtt: [] }

// For EDGEphone, the phone in the game (service.mjs): its screen is the shell from 127.0.0.1,
// with a local session for this run of the mod. A restarted mod (hot reload) has a new run, and
// the phone then asks for a new screen.
export const RUN = randomBytes(4).toString('hex');
export function screenUrl() {
  if (view.webError) throw new Error(view.webError);
  return `${localOrigin}/#s=${phones.localSession()}`;
}

const phones = new Phones({
  dataDir: pkg.dataDir,
  onChange: () => {
    if (!phones.key) view.qr = null; // a used key: the window asks for a new one
    post();
  },
});
const tunnel = new Tunnel({
  dataDir: pkg.dataDir,
  localPort: port,
  onState: (s) => {
    view.tunnel = { status: s.status, url: s.url ?? null };
    if (s.error && !tunnel.stopping) view.error = s.error;
    if (s.status !== 'ready') view.qr = null;
    if (s.status === 'ended') for (const c of conns) if (!c.local) c.ws.close();
    post();
  },
});

function post() {
  const online = new Map();
  for (const c of conns) online.set(c.id, c);
  channel.post({
    type: 'state',
    ...view,
    pending: phones.pending ? { code: phones.pending.code, name: phones.pending.name } : null,
    phones: phones.saved.map((p) => ({ id: p.id, name: p.name, lastSeen: p.lastSeen, online: online.has(p.id), rtt: stats(online.get(p.id)?.rtt) })),
    local: online.has('local') ? { rtt: stats(online.get('local').rtt) } : null,
  });
}

function stats(list) {
  if (!list?.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return { last: list[list.length - 1], median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted[sorted.length - 1] };
}

function showKey() {
  if (view.tunnel.status !== 'ready') return;
  const key = phones.newKey();
  const host = new URL(view.tunnel.url).host;
  const link = `${LOADER}#h=${host}&k=${key.value}`;
  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  view.qr = { svg: qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true }), link, expires: key.expires };
  post();
}

// The page's own origins: the tunnel's address through the tunnel, 127.0.0.1 when local.
function originOk(origin, viaTunnel) {
  if (!viaTunnel) return origin === localOrigin;
  return !!view.tunnel.url && origin === view.tunnel.url;
}

function onSocket(ws, info) {
  const send = (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  let conn = null;
  let waiting = false;
  const refuse = setTimeout(() => ws.close(), 10000); // the first message must come soon
  // A fresh challenge for this connection only: the phone signs it to prove who it is.
  const challenge = phones.challenge();
  send({ t: 'challenge', challenge });
  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return ws.close();
    }
    if (!conn) {
      if (waiting || msg.t !== 'hello') return;
      clearTimeout(refuse);
      waiting = true;
      const who = await phones.hello(msg, { ua: info.ua, local: info.local, origin: info.origin, challenge, send });
      waiting = false;
      if (!who || ws.readyState !== ws.OPEN) return ws.close();
      conn = { ws, ...who, rtt: [] };
      conns.add(conn);
      send({ t: 'in', name: who.name, local: who.local, id: who.id });
      send({ t: 'theme', theme: settings.theme });
      console.log(`Phone in: ${who.name}${who.local ? '' : ' (through the tunnel)'}`);
      post();
      return;
    }
    if (msg.t === 'theme' && THEMES.includes(msg.theme)) setTheme(msg.theme);
    else if (msg.t === 'ping') send({ t: 'pong', at: msg.at });
    else if (msg.t === 'tock' && typeof msg.at === 'number') {
      conn.rtt.push(Math.round(performance.now() - msg.at));
      if (conn.rtt.length > 30) conn.rtt.shift();
      send({ t: 'rtt', ...stats(conn.rtt) });
    }
  });
  ws.on('close', () => {
    clearTimeout(refuse);
    if (waiting) phones.gone();
    if (conn) {
      conns.delete(conn);
      post();
    }
  });
  ws.on('error', () => {});
}

// Whether V is in the world: REDnode's game.state().world (REDnode #25), false while the game
// starts, at the main menu and from the start of every load. Every call into the game's world
// systems waits for it: calling GetWeatherSystem while the game booted crashed it (2026-10-29).
// REDnode also refuses those calls while it is false, but only the GameInstance ones, not methods
// on objects a mod holds, so nothing from the world is kept between ticks.
let inWorld = false;

// A load can start between two calls of one round, before onState tells the mod: REDnode then
// refuses the next call (2026-10-30, the 0.0.7 test). That refusal is the world going away, not
// a failure: the round stops there, and onState brings V back.
const NO_WORLD = /not in the world yet/i;
function worldGone(err) {
  if (!NO_WORLD.test(err?.message ?? '')) return false;
  inWorld = false;
  place.district = null;
  place.rain = null;
  place.at = 0;
  return true;
}

// The game's time for each phone, once a second. Outside the world there is none.
async function gameSeconds() {
  if (!inWorld) return null;
  try {
    const timeSystem = await api.GameInstance.GetTimeSystem(game.instance);
    return (await timeSystem.GetGameTime()).seconds;
  } catch (err) {
    worldGone(err);
    return null;
  }
}

// Where V is, for the status line: the top district's name, and the rain. Read every few
// seconds. The game's script API gives only rain, not the named weather (docs/design.md, "M3 plan").
const PLACE_MS = 5000;
const RAIN = { LightRain: 'light', HeavyRain: 'heavy', 1: 'light', 2: 'heavy' };
const place = { district: null, rain: null, at: 0 };
const failed = new Set();
function failOnce(what, err) {
  if (failed.has(what)) return;
  failed.add(what);
  console.log(`Status line: could not read the ${what}: ${err?.message ?? err}`);
}

async function gamePlace() {
  if (!inWorld) return { district: null, rain: null };
  if (Date.now() - place.at < PLACE_MS) return place;
  place.at = Date.now();
  try {
    const container = await api.GameInstance.GetScriptableSystemsContainer(game.instance);
    const prevention = await container.Get('PreventionSystem');
    const district = await prevention.GetCurrentDistrict();
    let record = district ? await district.GetDistrictRecord() : null;
    // A sub-district (Little China) has a parent (Watson): the status line names the top one.
    for (let i = 0; record && i < 4; i++) {
      const parent = await record.ParentDistrict();
      if (!parent) break;
      record = parent;
    }
    place.district = record ? await districtName(record) : null;
  } catch (err) {
    if (worldGone(err)) return place;
    place.district = null;
    failOnce('district', err);
  }
  try {
    const weather = await api.GameInstance.GetWeatherSystem(game.instance);
    const type = await weather.GetRainIntensityType();
    place.rain = RAIN[type?.value ?? type?.name ?? type] ?? null;
  } catch (err) {
    if (worldGone(err)) return place;
    place.rain = null;
    failOnce('rain', err);
  }
  return place;
}

/** The district's name in the player's language (REDnode's loc.text, #26), else its record's name ("CityCenter": "City Center"). */
async function districtName(record) {
  const key = await record.LocalizedName();
  if (typeof key === 'string' && key.startsWith('LocKey#')) {
    const text = await loc.text(key).catch((err) => failOnce('district name', err));
    if (typeof text === 'string' && text) return text;
  } else if (typeof key === 'string' && key) return key;
  const name = await record.EnumName();
  return typeof name === 'string' && name ? name.replace(/([a-z])([A-Z])/g, '$1 $2') : null;
}

// One theme for both screens, kept on the PC: every connected screen switches at once.
function setTheme(theme) {
  settings.theme = theme;
  saveSettings();
  for (const c of conns) if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify({ t: 'theme', theme }));
  console.log(`Theme: ${theme}`);
}
function onGameState(s) {
  const now = !!(s.connected && s.world);
  if (now !== inWorld) place.at = 0; // read the place again as soon as V is back
  inWorld = now;
}
game.onState(onGameState);
game
  .state()
  .then(onGameState)
  .catch(() => {});
// One tick at a time: a call the game is slow to answer must not pile up behind the next.
let ticking = false;
setInterval(async () => {
  if (!conns.size || ticking) return;
  ticking = true;
  try {
    let seconds = await gameSeconds();
    const { district, rain } = await gamePlace();
    if (!inWorld) seconds = null; // the world went away during this round
    for (const c of conns) if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify({ t: 'tick', seconds, district, rain, at: performance.now() }));
    post();
  } finally {
    ticking = false;
  }
}, TICK_MS);

channel.on(async (msg) => {
  switch (msg?.type) {
    case 'hello':
      post();
      break;
    case 'fetch':
      if (view.fetching) break;
      view.error = null;
      view.fetching = { received: 0, total: CLOUDFLARED.size };
      post();
      try {
        await fetchCloudflared(pkg.dataDir, (received, total) => {
          view.fetching = { received, total };
          post();
        });
        view.cloudflared.have = true;
      } catch (err) {
        view.error = `Getting cloudflared failed: ${err.message}`;
      }
      view.fetching = null;
      post();
      break;
    case 'start': {
      const exe = findCloudflared(pkg.dataDir);
      if (!exe || ['starting', 'ready'].includes(view.tunnel.status)) break;
      view.error = null;
      view.tunnel = { status: 'starting', url: null };
      post();
      await tunnel.start(exe);
      break;
    }
    case 'stop':
      tunnel.stop();
      break;
    case 'new-key':
      showKey();
      break;
    case 'auto-start':
      settings.autoStart = !!msg.on;
      saveSettings();
      view.autoStart = settings.autoStart;
      post();
      break;
    case 'allow':
      phones.decide(true);
      break;
    case 'deny':
      phones.decide(false);
      break;
    case 'disconnect':
      phones.remove(msg.id);
      for (const c of conns) if (c.id === msg.id) c.ws.close();
      post();
      break;
    case 'local':
      channel.post({ type: 'local', url: screenUrl() });
      break;
  }
});

async function pickPort() {
  for (;;) {
    const p = randomInt(20000, 60000);
    const free = await new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
    });
    if (free) return p;
  }
}

let webUp = false;
try {
  await startWeb({ dir: pkg.dir, port, loaderOrigin: LOADER_ORIGIN, originOk, onSocket });
  webUp = true;
  console.log(`EDGEmobile: web server on ${localOrigin}`);
} catch (err) {
  view.error = view.webError = `The web server could not start on port ${port}: ${err.message}`;
  console.log(view.error);
}
// A tunnel left running by the last start of this mod (hot reload) is used again. Otherwise,
// with the setting on and a phone paired, the tunnel starts with the game.
if (await tunnel.relink()) console.log('Tunnel reused after a restart');
else if (webUp && settings.autoStart && phones.saved.length && findCloudflared(pkg.dataDir)) {
  console.log('Tunnel: starting with the game (setting on)');
  view.tunnel = { status: 'starting', url: null };
  post();
  await tunnel.start(findCloudflared(pkg.dataDir));
}
post();
