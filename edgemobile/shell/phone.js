// EDGEmobile's phone page, served by the player's PC (docs/design.md, "M2 plan"): pairing, then
// a connected screen with Night City's clock. The home screen comes in M3.
//
// The phone proves itself by signing the PC's challenge for each connection. Inside the loader,
// the loader signs, with a key it keeps on its own origin and will not give out. Opened
// directly, this page keeps a key of its own, which lasts only as long as this tunnel address.
// The in-game window instead brings a local session (#s=), good through 127.0.0.1 only.

const $ = (id) => document.getElementById(id);
const LOADER_ORIGIN = 'https://mobile.edgemodders.ai';
const framed = window.parent !== window;

// The key or session arrives after the #, which never leaves the phone. Take it out of the
// address bar at once.
const hash = new URLSearchParams(location.hash.slice(1));
let key = hash.get('k');
const session = hash.get('s');
if (location.hash) history.replaceState(null, '', location.pathname);

// Tell the loader the page is up, so it shows the frame.
if (framed) window.parent.postMessage({ edgemobile: 'ready' }, LOADER_ORIGIN);

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

function status(text, tone = '') {
  $('status').textContent = text;
  $('status').className = `status ${tone}`;
}
function show(...ids) {
  for (const id of ['pairing', 'refused', 'connected']) $(id).hidden = !ids.includes(id);
}

let ws = null;
let wasIn = false;
let refused = false;
let wait = 1000;

function connect() {
  status('Connecting to your game…');
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  const send = (m) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'challenge') {
      hello(m.challenge, send).catch((err) => {
        status(`Could not sign in: ${err.message}`, 'bad');
        ws.close();
      });
    } else handle(m, send);
  };
  ws.onclose = () => {
    if (refused || !wasIn) return;
    status(`Lost the connection. Trying again in ${Math.round(wait / 1000)} s…`, 'bad');
    setTimeout(connect, wait);
    wait = Math.min(wait * 2, 10000);
  };
}

async function hello(challenge, send) {
  if (session) return send({ t: 'hello', session });
  signer ??= await pickSigner();
  const [pub, sig] = await Promise.all([signer.pub(), signer.sign(challenge)]);
  send({ t: 'hello', pub, sig, ...(key ? { key } : {}) });
  key = null; // used once, whatever happens
}

function handle(m, send) {
  switch (m.t) {
    case 'code':
      show('pairing');
      $('code').textContent = `${m.code.slice(0, 3)} ${m.code.slice(3)}`;
      status('Waiting for the game to allow this phone…');
      break;
    case 'refused':
      refused = true;
      show('refused');
      status('Not connected', 'bad');
      break;
    case 'in':
      wasIn = true;
      wait = 1000;
      show('connected');
      status(`Connected as ${m.name}`, 'ok');
      break;
    case 'tick':
      send({ t: 'tock', at: m.at });
      clock(m.seconds);
      break;
  }
}

let lastSeconds = null;
function clock(seconds) {
  const live = typeof seconds === 'number';
  if (live) lastSeconds = seconds;
  $('signal').textContent = live ? 'live' : 'No signal from Night City';
  $('clockbox').classList.toggle('dim', !live);
  if (lastSeconds === null) return;
  const days = Math.floor(lastSeconds / 86400);
  const h = Math.floor((lastSeconds % 86400) / 3600);
  const min = Math.floor((lastSeconds % 3600) / 60);
  $('clock').textContent = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  // The game has no calendar date: day 0 of the playthrough is 1 January 2077.
  const date = new Date(Date.UTC(2077, 0, 1 + days));
  $('date').textContent = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

connect();
