// EDGEmobile M1 spike: the phone page's script. Connects to the PC's WebSocket, pairs with the
// QR code's one-time key (#k=) or the in-game window's local session (#s=), then shows the
// game's time and the delay both ways.

const $ = (id) => document.getElementById(id);
const LOADER_ORIGIN = 'https://edgemodders.github.io';
const STORE = 'edgemobile.session';

// The key or session arrives after the #, which never leaves the phone. Take it out of the
// address bar at once.
const hash = new URLSearchParams(location.hash.slice(1));
let key = hash.get('k');
let session = hash.get('s') ?? read();
if (location.hash) history.replaceState(null, '', location.pathname);

function read() {
  try {
    return localStorage.getItem(STORE);
  } catch {
    return null;
  }
}
function keep(value) {
  try {
    if (value) localStorage.setItem(STORE, value);
    else localStorage.removeItem(STORE);
  } catch {
    // storage blocked: the session lasts as long as the page
  }
}

function status(text, tone = '') {
  $('status').textContent = text;
  $('status').className = `status ${tone}`;
}
function show(...ids) {
  for (const id of ['pairing', 'refused', 'nc', 'delay', 'checks', 'about']) $(id).hidden = !ids.includes(id);
}

// Tell the loader the page is up, so it can stop waiting.
if (window.parent !== window) window.parent.postMessage({ edgemobile: 'ready' }, LOADER_ORIGIN);

let ws = null;
let pinger = null;
let wait = 1000;
const up = [];

function connect() {
  if (!key && !session) {
    show('refused');
    status('Not connected', 'bad');
    return;
  }
  status('Connecting to your game…');
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    ws.send(JSON.stringify(key ? { t: 'hello', key } : { t: 'hello', session }));
    key = null; // used once, whatever happens
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => {
    clearInterval(pinger);
    if (!session) return;
    status(`Lost the connection. Trying again in ${Math.round(wait / 1000)} s…`, 'bad');
    setTimeout(connect, wait);
    wait = Math.min(wait * 2, 10000);
  };
}

function handle(m) {
  switch (m.t) {
    case 'code':
      show('pairing');
      $('code').textContent = `${m.code.slice(0, 3)} ${m.code.slice(3)}`;
      status('Waiting for the game to allow this phone…');
      break;
    case 'welcome':
      session = m.session;
      keep(session);
      break;
    case 'refused':
      session = null;
      keep(null);
      show('refused');
      status('Not connected', 'bad');
      break;
    case 'in':
      wait = 1000;
      show('nc', 'delay', 'checks', 'about');
      status(`Connected as ${m.name}`, 'ok');
      facts();
      pinger = setInterval(() => ws.send(JSON.stringify({ t: 'ping', at: performance.now() })), 2000);
      break;
    case 'tick':
      ws.send(JSON.stringify({ t: 'tock', at: m.at }));
      clock(m.seconds);
      break;
    case 'pong':
      up.push(Math.round(performance.now() - m.at));
      if (up.length > 30) up.shift();
      $('up').textContent = [...up].sort((a, b) => a - b)[Math.floor(up.length / 2)];
      $('upLast').textContent = up[up.length - 1];
      break;
    case 'rtt':
      $('down').textContent = m.median;
      $('downLast').textContent = m.last;
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

function facts() {
  const standalone = matchMedia('(display-mode: standalone)').matches;
  const rows = [
    ['Address', location.host],
    ['In a frame', window.parent !== window ? 'yes' : 'no'],
    ['Installed app', standalone ? 'yes' : 'no'],
    ['Camera API', navigator.mediaDevices?.getUserMedia ? 'yes' : 'no'],
  ];
  $('facts').replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}

$('photo').addEventListener('change', () => {
  const file = $('photo').files[0];
  if (!file) return;
  $('shot').src = URL.createObjectURL(file);
  $('shot').hidden = false;
  $('camNote').textContent = `Photo: ${Math.round(file.size / 1024)} KB, ${file.type}`;
});

let stream = null;
$('live').addEventListener('click', async () => {
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
    $('video').hidden = true;
    $('live').textContent = 'Live camera';
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    $('video').srcObject = stream;
    $('video').hidden = false;
    await $('video').play();
    $('live').textContent = 'Stop camera';
    $('camNote').textContent = 'Live camera works.';
  } catch (err) {
    $('camNote').textContent = `Live camera failed: ${err.name}: ${err.message}`;
  }
});

connect();
