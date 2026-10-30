// EDGEmobile's phone OS, served by the player's PC (docs/design.md, "The OS" and "M3 plan"):
// pairing, the home screen and Settings. The same page runs on the real phone (through the
// tunnel, inside the loader) and in the game's phone window (from 127.0.0.1).
//
// The phone proves itself by signing the PC's challenge for each connection. Inside the loader,
// the loader signs, with a key it keeps on its own origin and will not give out. Opened
// directly, this page keeps a key of its own, which lasts only as long as this tunnel address.
// The in-game window instead brings a local session (#s=), good through 127.0.0.1 only.

const $ = (id) => document.getElementById(id);
const LOADER_ORIGIN = 'https://mobile.edgemodders.ai';
const THEMES = ['nightcity', 'edgemodders'];
const framed = window.parent !== window;
let apps = []; // the installed mobile apps, as the PC lists them
let openApp = null; // the app open full screen, if any

// The key or session arrives after the #, which never leaves the phone. Take it out of the
// address bar at once.
const hash = new URLSearchParams(location.hash.slice(1));
let key = hash.get('k');
const session = hash.get('s');
if (location.hash) history.replaceState(null, '', location.pathname);
const inGame = !!session; // the game's own phone window: no dock
document.body.classList.toggle('in-game', inGame);

// The last theme seen, until the PC says which: no flash of the wrong colours.
try {
  applyTheme(localStorage.getItem('edgemobile.theme'));
} catch {
  // storage blocked
}

// Tell the loader the page is up, so it shows the frame.
if (framed && !inGame) window.parent.postMessage({ edgemobile: 'ready' }, LOADER_ORIGIN);

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const signedText = (origin, challenge) => new TextEncoder().encode(`edgemobile-auth\n${origin}\n${challenge}`);

// Asking the loader, which answers only its own frame.
const asks = new Map();
let nextAsk = 1;
window.addEventListener('message', (e) => {
  if (e.source !== window.parent || e.origin !== LOADER_ORIGIN) return;
  const done = asks.get(e.data?.id);
  if (!done) return;
  asks.delete(e.data.id);
  done(e.data);
});
function askLoader(msg, ms = 3000) {
  return new Promise((resolve, reject) => {
    const id = nextAsk++;
    const timer = setTimeout(() => {
      asks.delete(id);
      reject(new Error('the loader did not answer'));
    }, ms);
    asks.set(id, (m) => {
      clearTimeout(timer);
      if (m.error) reject(new Error(m.error));
      else resolve(m);
    });
    window.parent.postMessage({ ...msg, id }, LOADER_ORIGIN);
  });
}

const loaderSigner = {
  pub: async () => (await askLoader({ edgemobile: 'pub' })).pub,
  sign: async (challenge) => (await askLoader({ edgemobile: 'sign', challenge })).sig,
};

// This page's own key, for a browser without the loader. Non-extractable, kept in IndexedDB.
const ownSigner = {
  pair: null,
  async keys() {
    this.pair ??= await keptKeys();
    return this.pair;
  },
  async pub() {
    const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', (await this.keys()).publicKey);
    return { kty, crv, x, y };
  },
  async sign(challenge) {
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, (await this.keys()).privateKey, signedText(location.origin, challenge));
    return b64url(sig);
  },
};

async function keptKeys() {
  const make = () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('edgemobile', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('keys');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return make(); // storage blocked: the key lasts as long as the page
  }
  const get = () => new Promise((resolve) => {
    const req = db.transaction('keys').objectStore('keys').get('phone');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  const found = await get();
  if (found) return found;
  const pair = await make();
  await new Promise((resolve) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(pair, 'phone');
    tx.oncomplete = tx.onerror = resolve;
  });
  return pair;
}

let signer = null;
async function pickSigner() {
  if (framed) {
    try {
      await loaderSigner.pub();
      return loaderSigner;
    } catch {
      // not inside the loader after all
    }
  }
  return ownSigner;
}

// --- Screens -----------------------------------------------------------------------------------

function screen(id) {
  for (const s of ['gate', 'home', 'settings']) $(s).hidden = s !== id;
}
function status(text, tone = '') {
  $('status').textContent = text;
  $('status').className = `status ${tone}`;
}
function gate(panel) {
  screen('gate');
  for (const p of ['pairing', 'refused']) $(p).hidden = p !== panel;
}

let toastTimer = null;
function toast(head, text) {
  $('toastHead').textContent = head;
  $('toastText').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 4000);
}

function applyTheme(theme) {
  if (!THEMES.includes(theme)) return;
  document.documentElement.dataset.theme = theme;
  toApp({ op: 'theme', theme });
  for (const b of document.querySelectorAll('[data-theme-choice]')) b.setAttribute('aria-checked', String(b.dataset.themeChoice === theme));
  try {
    localStorage.setItem('edgemobile.theme', theme);
  } catch {
    // storage blocked
  }
}

// --- The connection ---------------------------------------------------------------------------

let ws = null;
let send = () => {};
let wasIn = false;
let refused = false;
let wait = 1000;

function connect() {
  status('Connecting to your game…');
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  const socket = ws;
  send = (m) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(m));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'challenge') {
      hello(m.challenge).catch((err) => {
        status(`Could not sign in: ${err.message}`, 'bad');
        socket.close();
      });
    } else handle(m);
  };
  ws.onclose = () => {
    failCalls('Lost the connection to your game.');
    if (refused || !wasIn) return;
    gate(null);
    status(`Lost the connection to your game. Trying again in ${Math.round(wait / 1000)} s…`, 'bad');
    setTimeout(connect, wait);
    wait = Math.min(wait * 2, 10000);
  };
}

async function hello(challenge) {
  if (session) return send({ t: 'hello', session });
  signer ??= await pickSigner();
  const [pub, sig] = await Promise.all([signer.pub(), signer.sign(challenge)]);
  send({ t: 'hello', pub, sig, ...(key ? { key } : {}) });
  key = null; // used once, whatever happens
}

function handle(m) {
  switch (m.t) {
    case 'code':
      gate('pairing');
      $('code').textContent = `${m.code.slice(0, 3)} ${m.code.slice(3)}`;
      status('Waiting for the game to allow this phone…');
      break;
    case 'refused':
      refused = true;
      gate('refused');
      status('Not connected', 'bad');
      break;
    case 'in':
      wasIn = true;
      wait = 1000;
      if ($('settings').hidden) screen('home');
      if (openApp) send({ t: 'app-open', app: openApp.id });
      break;
    case 'apps':
      renderApps(m.apps);
      break;
    case 'app-result': {
      const call = calls.get(m.id);
      if (!call) break;
      calls.delete(m.id);
      if (openApp && call.app === openApp.id) toApp({ op: 'result', id: call.appId, ok: m.ok, value: m.value, error: m.error });
      break;
    }
    case 'app-event':
      if (openApp && m.app === openApp.id) toApp({ op: 'event', event: m.event, data: m.data });
      break;
    case 'theme':
      applyTheme(m.theme);
      break;
    case 'tick':
      send({ t: 'tock', at: m.at });
      home(m);
      break;
  }
}

// --- The home screen -------------------------------------------------------------------------

const RAIN = { light: 'Light rain', heavy: 'Heavy rain' };
let lastSeconds = null;

/** Draws Night City's clock, date, district and rain. No game time: the main menu. */
function home({ seconds, district, rain }) {
  const live = typeof seconds === 'number';
  if (live) lastSeconds = seconds;
  $('time').classList.toggle('dim', !live);
  $('where').textContent = live ? [district, RAIN[rain]].filter(Boolean).join(' · ') || 'Night City' : 'No signal from Night City';
  if (lastSeconds === null) return;
  const days = Math.floor(lastSeconds / 86400);
  const h = Math.floor((lastSeconds % 86400) / 3600);
  const min = Math.floor((lastSeconds % 3600) / 60);
  $('clock').textContent = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  // The game has no calendar date: day 0 of the playthrough is 1 January 2077.
  const date = new Date(Date.UTC(2077, 0, 1 + days));
  $('date').textContent = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// --- Mobile apps -----------------------------------------------------------------------------
// Each app runs in a sandboxed frame (docs/design.md, "C1 plan"): an origin of its own, so it
// cannot read this page's session or the loader's key. It talks to this page by messages only
// (/mobile.js), and this page passes its calls to its package on the PC over the WebSocket.

const calls = new Map(); // WebSocket call id -> { app, appId }
let nextCall = 1;

function renderApps(list) {
  apps = Array.isArray(list) ? list : [];
  for (const el of document.querySelectorAll('#apps .app[data-app]')) el.remove();
  const settingsBtn = $('openSettings');
  for (const a of apps) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app';
    btn.dataset.app = a.id;
    btn.setAttribute('aria-label', a.badge ? `${a.name}, ${a.badge} new` : a.name);
    const icon = document.createElement('img');
    icon.className = 'icon';
    icon.alt = '';
    if (a.icon) icon.src = a.icon;
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = a.name;
    btn.append(icon, label);
    if (a.badge) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = a.badge > 99 ? '99+' : String(a.badge);
      btn.append(badge);
    }
    btn.addEventListener('click', () => openAppById(a.id));
    settingsBtn.before(btn);
  }
  $('appsHint').hidden = apps.length > 0;
  // An app that was removed while open closes.
  if (openApp && !apps.some((a) => a.id === openApp.id)) closeApp();
}

function openAppById(id) {
  const a = apps.find((x) => x.id === id);
  if (!a) return;
  openApp = a;
  $('appFrame').title = a.name;
  $('appFrame').src = a.entry;
  $('app').hidden = false;
  send({ t: 'app-open', app: a.id });
}

function closeApp() {
  if (!openApp) return;
  send({ t: 'app-close', app: openApp.id });
  for (const [id, c] of calls) if (c.app === openApp.id) calls.delete(id);
  openApp = null;
  $('app').hidden = true;
  $('appFrame').removeAttribute('src');
  $('appFrame').src = 'about:blank';
}

function toApp(msg) {
  const frame = $('appFrame');
  if (!openApp || !frame?.contentWindow) return;
  // The frame's origin is opaque, so it cannot be named: '*' goes to that one frame only.
  frame.contentWindow.postMessage({ mobile: 1, ...msg }, '*');
}

function failCalls(error) {
  for (const [id, c] of calls) {
    if (openApp && c.app === openApp.id) toApp({ op: 'result', id: c.appId, ok: false, error });
    calls.delete(id);
  }
}

window.addEventListener('message', (e) => {
  if (!openApp || e.source !== $('appFrame').contentWindow) return;
  const m = e.data;
  if (!m || m.mobile !== 1) return;
  if (m.op === 'hello') {
    toApp({ op: 'init', screen: inGame ? 'game' : 'phone', theme: document.documentElement.dataset.theme });
  } else if (m.op === 'home') {
    closeApp();
  } else if (m.op === 'call' && typeof m.call === 'string') {
    const id = nextCall++;
    calls.set(id, { app: openApp.id, appId: m.id });
    if (ws?.readyState !== WebSocket.OPEN) return failCalls('Not connected to your game.');
    send({ t: 'app-call', id, app: openApp.id, call: m.call, args: Array.isArray(m.args) ? m.args : [] });
  }
});

$('homeBar').addEventListener('click', closeApp);

// --- Settings, and the dock -------------------------------------------------------------------

$('openSettings').addEventListener('click', () => screen('settings'));
$('closeSettings').addEventListener('click', () => screen('home'));
for (const b of document.querySelectorAll('[data-theme-choice]')) {
  b.addEventListener('click', () => {
    applyTheme(b.dataset.themeChoice);
    send({ t: 'theme', theme: b.dataset.themeChoice });
  });
}

// Camera: the phone's own camera. The photo stays on the phone; nothing is sent.
$('cam').addEventListener('change', () => {
  if ($('cam').files.length) toast('Camera', 'Photo taken. Nothing was sent to the game.');
  $('cam').value = '';
});
document.querySelector('label[for="cam"]').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $('cam').click();
  }
});

connect();
