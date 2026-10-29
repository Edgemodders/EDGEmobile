// The EDGEmobile loader's script. The QR code's link carries the tunnel's host and the one-time
// key after the # (#h=<host>&k=<key>), which never leaves the phone. The loader keeps the host,
// so the installed app opens the same game again while it runs, and passes the key on to the
// PC's page in its frame. Only Cloudflare quick tunnel hosts are ever framed.

const $ = (id) => document.getElementById(id);
const HOST_RE = /^[a-z0-9-]+\.trycloudflare\.com$/;
const STORE = 'edgemobile.host';
const WAIT_MS = 10000;

const hash = new URLSearchParams(location.hash.slice(1));
if (location.hash) history.replaceState(null, '', location.pathname);
let host = hash.get('h');
const key = hash.get('k');
if (host && HOST_RE.test(host)) {
  try {
    localStorage.setItem(STORE, host);
  } catch {
    // storage blocked: the host lasts as long as the page
  }
} else {
  try {
    host = localStorage.getItem(STORE);
  } catch {
    host = null;
  }
  if (!host || !HOST_RE.test(host)) host = null;
}

let waiting = null;

function open(withKey) {
  $('offline').hidden = true;
  if (!host) {
    $('scan').hidden = false;
    return;
  }
  $('frame').src = `https://${host}/${withKey ? `#k=${encodeURIComponent(withKey)}` : ''}`;
  $('frame').hidden = false;
  clearTimeout(waiting);
  waiting = setTimeout(() => {
    $('frame').hidden = true;
    $('offline').hidden = false;
  }, WAIT_MS);
}

// The PC's page says it is up. Only its own origin counts.
window.addEventListener('message', (e) => {
  if (host && e.origin === `https://${host}` && e.data?.edgemobile === 'ready') clearTimeout(waiting);
});

$('retry').addEventListener('click', () => open(null));

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
