// EDGEmobile's Node mod. M1, the tunnel spike (docs/design.md, "Phases"): the web server and
// WebSocket on 127.0.0.1, Cloudflare's quick tunnel through the keeper, pairing with Allow and
// Deny, and the game's time sent to each phone with the delay both ways. The in-game window is
// spike/window.html; it talks to this mod over the package channel.

import { api, channel, game, pkg } from 'rednode';
import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import qrcode from 'qrcode-generator';
import { Phones } from './server/phones.mjs';
import { CLOUDFLARED, Tunnel, fetchCloudflared, findCloudflared } from './server/tunnel.mjs';
import { startWeb } from './server/web.mjs';

const LOADER = 'https://edgemodders.github.io/EDGEmobile/phone/';
const TICK_MS = 1000;

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
const port = settings.port;
const localOrigin = `http://127.0.0.1:${port}`;

const view = {
  cloudflared: { have: !!findCloudflared(pkg.dataDir), version: CLOUDFLARED.version, mb: Math.round(CLOUDFLARED.size / 1e6) },
  fetching: null,
  error: null,
  tunnel: { status: 'off', url: null },
  direct: false,
  qr: null,
  port,
};
const conns = new Set(); // { ws, id, name, local, rtt: [] }
let mainMenu = true;

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
  const link = view.direct ? `${view.tunnel.url}/#k=${key.value}` : `${LOADER}#h=${host}&k=${key.value}`;
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
      const who = await phones.hello(msg, { ua: info.ua, local: info.local, send });
      waiting = false;
      if (!who || ws.readyState !== ws.OPEN) return ws.close();
      conn = { ws, ...who, rtt: [] };
      conns.add(conn);
      send({ t: 'in', name: who.name, local: who.local, id: who.id });
      console.log(`Phone in: ${who.name}${who.local ? '' : ' (through the tunnel)'}`);
      post();
      return;
    }
    if (msg.t === 'ping') send({ t: 'pong', at: msg.at });
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

// The game's time for each phone, once a second. At the main menu there is none.
let timeSystem = null;
async function gameSeconds() {
  if (mainMenu) return null;
  try {
    timeSystem ??= await api.GameInstance.GetTimeSystem(game.instance);
    return (await timeSystem.GetGameTime()).seconds;
  } catch {
    timeSystem = null;
    return null;
  }
}
game.on('PlayerPuppet.OnGameAttached', () => {
  timeSystem = null;
});
game.onState((s) => {
  mainMenu = !s.connected || s.mainMenu;
});
game
  .state()
  .then((s) => {
    mainMenu = !s.connected || s.mainMenu;
  })
  .catch(() => {});
setInterval(async () => {
  if (!conns.size) return;
  const seconds = await gameSeconds();
  for (const c of conns) if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify({ t: 'tick', seconds, at: performance.now() }));
  post();
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
    case 'direct':
      view.direct = !!msg.on;
      showKey();
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
      channel.post({ type: 'local', url: `${localOrigin}/#s=${phones.localSession()}` });
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

try {
  await startWeb({ dir: pkg.dir, port, originOk, onSocket });
  console.log(`EDGEmobile M1 spike: web server on ${localOrigin}`);
} catch (err) {
  view.error = `The web server could not start on port ${port}: ${err.message}`;
  console.log(view.error);
}
// A tunnel left running by the last start of this mod (hot reload) is used again.
if (await tunnel.relink()) console.log('Tunnel reused after a restart');
post();
