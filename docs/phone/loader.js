// The EDGEmobile loader's script (docs/design.md, "M2 plan"). The QR code's link carries the
// tunnel's host and the one-time key after the # (#h=<host>&k=<key>), which never leaves the
// phone. The loader keeps the host, so the installed app opens the same game again while it
// runs, and passes the key on to the PC's page in its frame. Only Cloudflare quick tunnel hosts
// are ever framed.
//
// The loader also holds the phone's identity: an ECDSA P-256 key pair made by the browser,
// non-extractable, kept in IndexedDB on the loader's own origin. The page in the frame may ask
// for the public key and for a signature over the PC's challenge. The loader signs
// "edgemobile-auth", the origin of its own frame and the challenge, so a signature made for one
// site is worthless at any other.

const $ = (id) => document.getElementById(id);
const HOST_RE = /^[a-z0-9-]+\.trycloudflare\.com$/;
const STORE = 'edgemobile.host';
const WAIT_MS = 10000;

const hash = new URLSearchParams(location.hash.slice(1));
if (location.hash) history.replaceState(null, '', location.pathname);
let host = hash.get('h');
const key = hash.get('k');
if (host && HOST_RE.test(host)) keepHost(host);
else {
  try {
    host = localStorage.getItem(STORE);
  } catch {
    host = null;
  }
  if (!host || !HOST_RE.test(host)) host = null;
}

function keepHost(h) {
  try {
    localStorage.setItem(STORE, h);
  } catch {
    // storage blocked: the host lasts as long as the page
  }
}

// --- The phone's key pair -------------------------------------------------------------------

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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
  const found = await new Promise((resolve) => {
    const req = db.transaction('keys').objectStore('keys').get('phone');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  if (found) return found;
  const pair = await make();
  await new Promise((resolve) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(pair, 'phone');
    tx.oncomplete = tx.onerror = resolve;
  });
  // Ask the browser not to clear it when space runs low (granted to installed apps).
  navigator.storage?.persist?.().catch(() => {});
  return pair;
}
let keys = null;
const getKeys = () => (keys ??= keptKeys());

// --- The frame -------------------------------------------------------------------------------

let waiting = null;

function panel(id) {
  for (const p of ['scan', 'connecting', 'offline', 'scanner']) $(p).hidden = p !== id;
}

function offline() {
  clearTimeout(waiting);
  $('frame').hidden = true;
  panel('offline');
}

// The frame stays hidden until the PC's page says it is up, so the browser's own error page
// for an address that is gone (the game restarted) never shows.
function open(withKey) {
  if (!host) {
    panel('scan');
    return;
  }
  $('frame').hidden = true;
  panel('connecting');
  $('frame').src = `https://${host}/${withKey ? `#k=${encodeURIComponent(withKey)}` : ''}`;
  clearTimeout(waiting);
  waiting = setTimeout(offline, WAIT_MS);
  // A name that no longer exists fails at once; anything that answers waits for the page.
  fetch(`https://${host}/`, { mode: 'no-cors', cache: 'no-store' }).catch(offline);
}

// The PC's page talks to the loader. Only the frame, from the origin the loader put in it.
window.addEventListener('message', async (e) => {
  if (!host || e.source !== $('frame').contentWindow || e.origin !== `https://${host}`) return;
  const m = e.data;
  if (m?.edgemobile === 'ready') {
    clearTimeout(waiting);
    panel(null);
    $('frame').hidden = false;
    return;
  }
  const reply = (answer) => e.source.postMessage({ id: m.id, ...answer }, e.origin);
  try {
    if (m?.edgemobile === 'pub') {
      const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', (await getKeys()).publicKey);
      reply({ pub: { kty, crv, x, y } });
    } else if (m?.edgemobile === 'sign' && typeof m.challenge === 'string' && m.challenge.length <= 100) {
      const text = new TextEncoder().encode(`edgemobile-auth\n${e.origin}\n${m.challenge}`);
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, (await getKeys()).privateKey, text);
      reply({ sig: b64url(sig) });
    }
  } catch (err) {
    reply({ error: err.message });
  }
});

// --- Scanning the game's QR code inside the app ------------------------------------------------

let stream = null;
let scanTimer = null;

async function canScan() {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    return (await BarcodeDetector.getSupportedFormats()).includes('qr_code');
  } catch {
    return false;
  }
}

// Only our own QR codes: this loader's address with a quick tunnel host after the #.
function useLink(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.origin !== location.origin) return false;
  const p = new URLSearchParams(url.hash.slice(1));
  const h = p.get('h');
  if (!h || !HOST_RE.test(h)) return false;
  stopScan();
  host = h;
  keepHost(h);
  open(p.get('k'));
  return true;
}

async function startScan() {
  panel('scanner');
  $('scanNote').textContent = 'Point the camera at the QR code in the game.';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    $('video').srcObject = stream;
    await $('video').play();
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    scanTimer = setInterval(async () => {
      try {
        for (const code of await detector.detect($('video'))) if (useLink(code.rawValue)) return;
      } catch {
        // a frame that could not be read; the next one may
      }
    }, 250);
  } catch (err) {
    stopScan();
    panel(host ? 'offline' : 'scan');
    for (const n of document.querySelectorAll('.scan-error')) n.textContent = `The camera did not start (${err.name}). Scan the code with your phone's camera app instead.`;
  }
}

function stopScan() {
  clearInterval(scanTimer);
  for (const t of stream?.getTracks() ?? []) t.stop();
  stream = null;
}

for (const b of document.querySelectorAll('.scan-btn')) b.addEventListener('click', startScan);
$('scanCancel').addEventListener('click', () => {
  stopScan();
  panel(host ? 'offline' : 'scan');
});
$('retry').addEventListener('click', () => open(null));
canScan().then((yes) => {
  for (const b of document.querySelectorAll('.scan-btn')) b.hidden = !yes;
});

// --- Installing ----------------------------------------------------------------------------------

// Android offers to install once the page qualifies; show our own button for it.
let prompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  prompt = e;
  $('install').hidden = false;
});
$('installYes').addEventListener('click', async () => {
  $('install').hidden = true;
  await prompt?.prompt();
  prompt = null;
});
$('installNo').addEventListener('click', () => {
  $('install').hidden = true;
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

open(key);
