// EDGEmobile's phone in the game. The screen is the shell from the mod's server at 127.0.0.1,
// with a local session for this run of the mod. The drawer is Connect a phone: the mod
// (mod.mjs) sends its whole state over the package channel; this page draws it and sends the
// buttons back.

const { channel } = await import('rednode');
const $ = (id) => document.getElementById(id);

let state = null;
let askedKey = 0;
let run = null; // the mod's run: a restarted mod (hot reload) needs a new local session
let lastPending = null;

channel.on((m) => {
  if (m.type === 'state') draw(m);
  if (m.type === 'local') {
    $('screen').src = m.url;
    $('screen').hidden = false;
    $('wait').hidden = true;
  }
});

function draw(s) {
  state = s;
  if (s.run !== run) {
    run = s.run;
    channel.post({ type: 'local' });
  }
  if (s.webError) {
    $('wait').textContent = s.webError;
    $('wait').hidden = false;
    $('screen').hidden = true;
  }

  // A phone asking to pair opens the drawer, so the player sees the code.
  const pendingCode = s.pending?.code ?? null;
  if (pendingCode && pendingCode !== lastPending) $('drawer').hidden = false;
  lastPending = pendingCode;
  $('connect').classList.toggle('alert', !!s.pending);

  $('error').hidden = !s.error;
  $('error').textContent = s.error ?? '';

  const t = s.tunnel.status;
  $('get').hidden = s.cloudflared.have;
  $('cfVersion').textContent = s.cloudflared.version;
  $('cfSize').textContent = s.cloudflared.mb;
  $('progress').hidden = !s.fetching;
  if (s.fetching) {
    $('progress').setAttribute('max', s.fetching.total);
    $('progress').setAttribute('value', s.fetching.received);
  }
  $('fetch').toggleAttribute('disabled', !!s.fetching);
  $('start').hidden = !s.cloudflared.have || !['off', 'ended'].includes(t);
  $('starting').hidden = t !== 'starting';
  $('ready').hidden = t !== 'ready';

  $('pending').hidden = !s.pending;
  $('scan').hidden = !!s.pending;
  if (s.pending) {
    $('pendingName').textContent = s.pending.name;
    $('pendingCode').textContent = `${s.pending.code.slice(0, 3)} ${s.pending.code.slice(3)}`;
  }
  if (t === 'ready') {
    $('address').textContent = s.tunnel.url;
    if (s.qr) $('qr').innerHTML = s.qr.svg;
    else if (!s.pending && !$('drawer').hidden) newKey();
  }
  $('autoStart').toggleAttribute('checked', s.autoStart);

  $('phones').replaceChildren(...(s.phones.length ? s.phones.map(phoneRow) : [fine('None yet.')]));
}

function newKey() {
  if (Date.now() - askedKey < 3000) return;
  askedKey = Date.now();
  channel.post({ type: 'new-key' });
}

function phoneRow(p) {
  const row = document.createElement('div');
  row.className = `item${p.online ? ' on' : ''}`;
  const text = document.createElement('div');
  text.className = 'text';
  const name = document.createElement('div');
  name.textContent = p.name;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = p.online ? `online${p.rtt ? ` · round trip ${p.rtt.median} ms` : ''}` : `offline · last seen ${new Date(p.lastSeen).toLocaleString()}`;
  text.append(name, meta);
  const off = document.createElement('rn-button');
  off.setAttribute('variant', 'ghost');
  off.textContent = 'Disconnect';
  off.addEventListener('click', () => channel.post({ type: 'disconnect', id: p.id }));
  row.append(text, off);
  return row;
}

function fine(text) {
  const p = document.createElement('p');
  p.className = 'fine';
  p.textContent = text;
  return p;
}

// The countdown, and a new code when the old one runs out, while the drawer is open.
setInterval(() => {
  if ($('drawer').hidden || !state?.qr || state.pending || state.tunnel.status !== 'ready') return;
  const left = Math.max(0, Math.ceil((state.qr.expires - Date.now()) / 1000));
  $('left').textContent = left;
  if (left === 0) newKey();
}, 500);

$('connect').addEventListener('click', () => {
  $('drawer').hidden = !$('drawer').hidden;
  if (!$('drawer').hidden && state) draw(state);
});
$('fetch').addEventListener('click', () => channel.post({ type: 'fetch' }));
$('go').addEventListener('click', () => channel.post({ type: 'start' }));
$('stop').addEventListener('click', () => channel.post({ type: 'stop' }));
$('allow').addEventListener('click', () => channel.post({ type: 'allow' }));
$('deny').addEventListener('click', () => channel.post({ type: 'deny' }));
$('autoStart').addEventListener('change', (e) => channel.post({ type: 'auto-start', on: e.detail.checked }));

channel.post({ type: 'hello' });
