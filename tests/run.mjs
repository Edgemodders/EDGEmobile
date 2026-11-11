// The checks outside the game: EDGEmobile's mod.mjs (and Chooms!'s package, in the apps mode) in
// plain Node with a stand-in rednode (rednode-stub.mjs), against real quick tunnels. Node's
// WebCrypto plays the loader: it signs exactly as a phone's browser does. tests/README.md says more.
//   node tests/run.mjs full     start, pair, every refusal; leaves the keeper running
//   node tests/run.mjs relink   a restarted mod: same tunnel, the paired phone is in by signature; then stop
//   node tests/run.mjs auto     setting on, phone paired: the tunnel starts with the mod
//   node tests/run.mjs boot     the game starting, V arriving and leaving; no tunnel
//   node tests/run.mjs apps     mobile apps and Chooms!; no tunnel; ends with headless Chrome screenshots
//   node tests/run.mjs browser <minutes>   a tunnel and QR links for a real browser, Allow pressed
// full, relink and auto run in that order in one command (node tests/all.mjs does). Each mode
// exits with 1 when a check fails. What a run writes goes in tests/.out/, not committed.
import { register, createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync, lstatSync, unlinkSync, symlinkSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dns from 'node:dns';
import https from 'node:https';
import http from 'node:http';
import { CLOUDFLARED, fetchCloudflared } from '../edgemobile/server/tunnel.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const WebSocket = createRequire(join(REPO, 'edgemobile', 'package.json'))('ws');
const { subtle } = globalThis.crypto;

const mode = process.argv[2] ?? 'full';
const resolver = new dns.Resolver();
resolver.setServers(['1.1.1.1']);
const lookup = (host, opts, cb) => {
  if (!host.endsWith('trycloudflare.com')) return dns.lookup(host, opts, cb);
  resolver.resolve4(host, (err, a) => (err ? cb(err) : opts.all ? cb(null, a.map((address) => ({ address, family: 4 }))) : cb(null, a[0], 4)));
};
const get = (url) => new Promise((resolve, reject) => {
  (url.startsWith('https') ? https : http).get(url, url.startsWith('https') ? { lookup } : {}, (res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  }).on('error', reject);
});

// Everything a run writes: the packages' data folders (data/edgemobile, data/chooms), copies of
// the apps, the picker's test folder, screenshots.
const OUT = join(HERE, '.out');
const PKG = join(REPO, 'edgemobile');
const dataDir = join(OUT, 'data', 'edgemobile');
mkdirSync(dataDir, { recursive: true });

// The tunnel's cloudflared. Windows Firewall allows a program by its path, so the tests use the
// game's own copy (the one EDGEmobile's Connect window fetched), through a junction, rather than a
// copy of their own that the firewall would ask about again. With no copy in the game's folder,
// they fetch one as the mod does.
if (['full', 'relink', 'auto', 'browser'].includes(mode)) {
  const own = join(dataDir, 'cloudflared');
  const game = join(process.env.APPDATA ?? '', '@rednode', 'overlay', 'packages', 'edgemobile', 'cloudflared');
  if (!existsSync(join(own, CLOUDFLARED.version, 'cloudflared.exe'))) {
    let link = null;
    try { link = lstatSync(own); } catch {}
    if (link?.isSymbolicLink()) unlinkSync(own); // a junction to an older version: only the link goes
    if (existsSync(join(game, CLOUDFLARED.version, 'cloudflared.exe')) && !existsSync(own)) {
      symlinkSync(game, own, 'junction');
      console.log(`cloudflared: the game's copy, ${game}`);
    } else {
      console.log(`cloudflared ${CLOUDFLARED.version} is not in the game's folder: fetching it into ${own} (the firewall may ask about it)`);
      await fetchCloudflared(dataDir);
    }
  }
}

// Phones, as the loader would make them: non-extractable keys, the public key as JWK.
const b64url = (buf) => Buffer.from(buf).toString('base64url');
async function makePhone() {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const { kty, crv, x, y } = await subtle.exportKey('jwk', pair.publicKey);
  return {
    pub: { kty, crv, x, y },
    sign: async (origin, challenge) => b64url(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(`edgemobile-auth\n${origin}\n${challenge}`))),
  };
}
// The harness keeps its phone's key between runs as a JWK (a real loader keeps it non-extractable).
async function keptPhone() {
  const f = join(dataDir, 'phone-key.json');
  let jwk;
  if (existsSync(f)) jwk = JSON.parse(readFileSync(f, 'utf8'));
  else {
    const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    jwk = await subtle.exportKey('jwk', pair.privateKey);
    writeFileSync(f, JSON.stringify(jwk));
  }
  const priv = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const { kty, crv, x, y } = jwk;
  return {
    pub: { kty, crv, x, y },
    sign: async (origin, challenge) => b64url(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(`edgemobile-auth\n${origin}\n${challenge}`))),
  };
}

let state = null;
const waiters = [];
const logs = [];
globalThis.__harness = {
  services: {},
  pkgDir: PKG,
  dataDir,
  world: mode !== 'boot', // boot: the game starts with no V; the others start with V in the world
  fromMod: (m) => {
    if (m.type === 'state') state = m;
    for (const w of [...waiters]) if (w.test(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  },
};
const until = (test, ms = 60000, what = 'a message') => new Promise((resolve, reject) => {
  if (state && test(state)) return resolve(state);
  const w = { test, resolve };
  waiters.push(w);
  setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms);
});
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); };

if (mode === 'full') {
  // A phone paired with M1 (a session hash): must be dropped.
  writeFileSync(join(dataDir, 'phones.json'), JSON.stringify([{ id: 'old', name: 'Old phone', hash: 'ab'.repeat(32), pairedAt: '2026-10-29T00:00:00Z', lastSeen: '2026-10-29T00:00:00Z' }]));
}
if (mode === 'auto') {
  const s = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'));
  writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ ...s, autoStart: true }));
}

// Mobile apps: the apps mode gets a fresh copy of the repo's Chooms! app beside a fresh Chooms!
// package data folder; the other modes an empty apps folder, so they test what they did before.
const appsRoot = join(OUT, mode === 'apps' ? 'apps-test' : 'apps-empty');
rmSync(appsRoot, { recursive: true, force: true });
mkdirSync(join(appsRoot, 'mobile-apps'), { recursive: true });
if (mode === 'apps') {
  cpSync(join(REPO, 'chooms', 'mobile'), join(appsRoot, 'mobile-apps', 'chooms'), { recursive: true });
  rmSync(join(dataDir, '..', 'chooms'), { recursive: true, force: true });
}
process.env.EDGEMOBILE_APPS_DIR = join(appsRoot, 'mobile-apps');
// The apps mode runs a copy of Chooms!'s package with bundled test pictures and places in content/.
const CHOOMS = mode === 'apps' ? join(appsRoot, 'pkg', 'chooms', 'rednode') : join(REPO, 'chooms', 'rednode');
const TEST_PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360f8cfc0f01f0005000201c5e8e0d50000000049454e44ae426082', 'hex');
const variant = (n) => Buffer.concat([TEST_PNG, Buffer.from(`variant ${n}`)]);
if (mode === 'apps') {
  cpSync(join(REPO, 'chooms', 'rednode'), CHOOMS, { recursive: true, filter: (f) => !/[\\/]content([\\/]|$)/.test(f.slice(join(REPO, 'chooms', 'rednode').length)) });
  mkdirSync(join(CHOOMS, 'content', 'people', 'viktor'), { recursive: true });
  for (const n of [1, 2, 3]) writeFileSync(join(CHOOMS, 'content', 'people', 'viktor', `v${n}.png`), variant(n));
  writeFileSync(join(CHOOMS, 'content', 'content.json'), JSON.stringify({ people: {
    viktor: { portrait: 'people/viktor/v1.png', places: [
      { file: 'people/viktor/v2.png', description: 'His clinic, under the boxing gym', activities: ['patching up a merc'] },
      { file: 'people/viktor/v3.png', description: 'The ring upstairs', activities: [] },
    ] },
    misty: { body: 'people/misty/missing.png' },
  } }));
}
globalThis.__harness.pkgDirs = { chooms: CHOOMS };
if (mode === 'apps') globalThis.__harness.world = false;

const origLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); origLog('  [mod]', ...a); };
register(pathToFileURL(join(HERE, 'hooks.mjs')));
if (mode === 'apps') globalThis.__harness.services.chooms = await import(pathToFileURL(join(CHOOMS, 'service.mjs')).href);
await import(pathToFileURL(join(PKG, 'mod.mjs')).href);
console.log = origLog;
const H = globalThis.__harness;
const port = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).port;

function socket(base, origin) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { headers: { Origin: origin }, lookup });
  const got = [];
  const next = (t, ms = 15000) => take(got, [t], ms).then((m) => m ?? Promise.reject(new Error(`no ${t}`)));
  ws.on('message', (d) => got.push(JSON.parse(d)));
  const opened = new Promise((resolve) => { ws.once('open', () => resolve(true)); ws.once('error', (e) => resolve(e.message)); });
  return { ws, next, opened, got, send: (m) => ws.send(JSON.stringify(m)) };
}
// Opens a connection, signs its challenge as `phone` for `signFor`, sends hello with `extra`.
async function hello(url, phone, { signFor = url, extra = {}, sig } = {}) {
  const s = socket(url, url);
  await s.opened;
  const { challenge } = await s.next('challenge');
  s.send({ t: 'hello', pub: phone.pub, sig: sig ?? (await phone.sign(signFor, challenge)), ...extra });
  return { ...s, challenge };
}
// The first message of one of `types`, taken out of `got`; null after `ms`.
function take(got, types, ms) {
  return new Promise((resolve) => {
    const look = () => {
      const i = got.findIndex((m) => types.includes(m.t));
      if (i < 0) return false;
      clearInterval(iv);
      clearTimeout(to);
      resolve(got.splice(i, 1)[0]);
      return true;
    };
    const iv = setInterval(look, 20);
    const to = setTimeout(() => { clearInterval(iv); resolve(null); }, ms);
    look();
  });
}
const answer = async (s) => (await take(s.got, ['in', 'refused', 'code'], 15000))?.t ?? 'timeout';

async function freshKey() {
  H.toMod({ type: 'new-key' });
  await until((m) => m.type === 'state' && !!m.qr, 5000, 'a QR code');
  return { link: state.qr.link, key: new URLSearchParams(new URL(state.qr.link).hash.slice(1)).get('k') };
}

if (mode === 'full') {
  H.toMod({ type: 'hello' });
  await until((s) => s.type === 'state');
  check('an M1 phone (session hash) is dropped', logs.some((l) => /must pair again/.test(l)) && state.phones.length === 0);
  const t1 = Date.now();
  H.toMod({ type: 'start' });
  await until((s) => s.type === 'state' && (s.tunnel.status === 'ready' || s.tunnel.status === 'ended'), 90000, 'the tunnel');
  check('tunnel ready', state.tunnel.status === 'ready', `${state.tunnel.url} in ${Math.round((Date.now() - t1) / 1000)} s ${state.error ?? ''}`);
  const url = state.tunnel.url;

  let r = await get(url + '/');
  const csp = r.headers['content-security-policy'] ?? '';
  check('the page through the tunnel, framed only by the loader', r.status === 200 && r.body.includes('Pairing code') && /frame-ancestors https:\/\/mobile\.edgemodders\.ai(;|$)/.test(csp), csp.split('; ').pop());
  r = await get(`http://127.0.0.1:${port}/`);
  check('the page from 127.0.0.1 may be framed by file:// pages only (the game window)', r.status === 200 && /frame-ancestors file:(;|$)/.test(r.headers['content-security-policy']));
  r = await get(url + '/phone.js');
  check('GET /phone.js', r.status === 200 && r.body.includes('edgemobile-auth'));
  for (const p of ['/phones.json', '/connect/window.js', '/../mod.mjs', '/spike/phone.html']) {
    r = await get(url + p);
    if (r.status !== 404 || r.body !== 'Not found.') check(`refused alike: ${p}`, false, String(r.status));
  }
  check('phones.json, the window and the mod are not served', true);

  let s = socket(url, 'https://evil.example');
  check('WebSocket from another origin refused', (await s.opened) !== true);

  const { link, key } = await freshKey();
  check('QR link goes to the loader at its own address', link.startsWith('https://mobile.edgemodders.ai/#h=') && link.includes(new URL(url).host), link);

  const phone = await keptPhone();
  s = socket(url, url);
  await s.opened;
  const first = await s.next('challenge');
  check('each connection gets a challenge first', /^[A-Za-z0-9_-]{43}$/.test(first.challenge));
  s.ws.close();

  // Refusals, each after the pause, none using up the key.
  let t = Date.now();
  let a = await hello(url, phone, { extra: {} });
  check('an unknown phone without a key is refused', (await answer(a)) === 'refused' && Date.now() - t >= 900, `${Date.now() - t} ms`);
  a = await hello(url, phone, { signFor: 'https://evil-site.trycloudflare.com', extra: { key } });
  check('a signature made for another site is refused, even with the key', (await answer(a)) === 'refused');
  const old = await hello(url, phone, { extra: {} });
  await answer(old);
  a = await hello(url, phone, { sig: await phone.sign(url, old.challenge), extra: { key } });
  check('a signature over another connection\'s challenge is refused', (await answer(a)) === 'refused');
  a = await hello(url, phone, { sig: 'AAAA', extra: { key } });
  check('a broken signature is refused', (await answer(a)) === 'refused');
  const s2 = socket(url, url);
  await s2.opened;
  await s2.next('challenge');
  s2.send({ t: 'hello', key });
  check('the key alone, with no public key, is refused', (await answer(s2)) === 'refused');
  const other = await makePhone();
  a = await hello(url, other, { extra: { key: 'AAAAAAAAAAAAAAAAAAAAAA' } });
  check('a wrong key is refused', (await answer(a)) === 'refused');

  // Pairing: key, signature, code, Allow.
  const p = await hello(url, phone, { extra: { key } });
  const code = await p.next('code');
  await until((m) => m.type === 'state' && !!m.pending, 5000, 'the pending phone');
  check('the game shows the same pairing code', state.pending.code === code.code, code.code);
  check('the used key is dropped from the window', state.qr === null);
  a = await hello(url, other, { extra: { key } });
  check('the same key refused a second time', (await answer(a)) === 'refused');
  H.toMod({ type: 'allow' });
  await p.next('in');
  check('allowed: in', true);
  const saved = JSON.parse(readFileSync(join(dataDir, 'phones.json'), 'utf8'));
  const keyFile = JSON.parse(readFileSync(join(dataDir, 'phone-key.json'), 'utf8'));
  check('phones.json keeps the public key only', saved.length === 1 && saved[0].jwk.x === phone.pub.x && !('d' in saved[0].jwk) && !readFileSync(join(dataDir, 'phones.json'), 'utf8').includes(keyFile.d), Object.keys(saved[0]).join(','));
  const tick = await p.next('tick');
  check('game time arrives', tick.seconds === 3 * 86400 + 14 * 3600 + 5 * 60);

  // M3: the status line, the theme, the fonts.
  check('the top district and the rain arrive with the time', tick.district === 'Watson' && tick.rain === 'light', `${tick.district} · ${tick.rain}`);
  const firstTheme = p.got.find((m) => m.t === 'theme');
  check('the theme is sent on connecting (Night City by default)', firstTheme?.theme === 'nightcity', firstTheme?.theme);
  const second = await hello(url, phone, { extra: {} });
  await answer(second);
  p.send({ t: 'theme', theme: 'edgemodders' });
  const pushed = await second.next('theme').then(() => second.next('theme'));
  const savedTheme = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).theme;
  check('a theme chosen on one screen reaches the others and is kept on the PC', pushed.theme === 'edgemodders' && savedTheme === 'edgemodders');
  p.send({ t: 'theme', theme: 'not-a-theme' });
  await new Promise((r) => setTimeout(r, 300));
  check('an unknown theme is ignored', JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).theme === 'edgemodders');
  p.send({ t: 'theme', theme: 'nightcity' });
  second.ws.close();
  r = await get(url + '/fonts/fonts.css');
  const faces = (r.body.match(/@font-face/g) ?? []).length;
  r = await get(url + '/fonts/rajdhani-latin-500-normal.woff2');
  check('the fonts are served from the PC', faces === 16 && r.status === 200 && r.headers['content-type'] === 'font/woff2' && /max-age=86400/.test(r.headers['cache-control']), `${faces} faces`);
  r = await get(url + '/');
  check('the page allows fonts and styles from itself only', /font-src 'self'/.test(r.headers['content-security-policy']) && !/googleapis|gstatic/.test(r.headers['content-security-policy'] + r.body));
  r = await get(url + '/fonts/../mod.mjs');
  check('nothing else is served from the fonts folder', r.status === 404);

  // Back with no key and no Allow: by signature alone.
  t = Date.now();
  a = await hello(url, phone, { extra: {} });
  check('the paired phone is back by signature alone', (await answer(a)) === 'in' && !state.pending, `${Date.now() - t} ms`);
  a = await hello(url, phone, { extra: { key: 'AAAAAAAAAAAAAAAAAAAAAA' } });
  check('a paired phone with a stale key is still in', (await answer(a)) === 'in');
  a = await hello(url, phone, { signFor: 'https://evil-site.trycloudflare.com' });
  check('the paired phone\'s signature for another site is refused', (await answer(a)) === 'refused');

  // Deny.
  const k2 = (await freshKey()).key;
  const d = await hello(url, other, { extra: { key: k2 } });
  await d.next('code');
  await until((m) => m.type === 'state' && !!m.pending, 5000);
  H.toMod({ type: 'deny' });
  check('a denied phone is refused', (await answer(d)) === 'refused');

  // Disconnect, then pair a third phone to keep for the restart checks.
  const k3 = (await freshKey()).key;
  const third = await makePhone();
  const x = await hello(url, third, { extra: { key: k3 } });
  await x.next('code');
  await until((m) => m.type === 'state' && !!m.pending, 5000);
  H.toMod({ type: 'allow' });
  await x.next('in');
  const thirdId = state.phones.find((ph) => ph.x === undefined && ph.id !== saved[0].id)?.id;
  H.toMod({ type: 'disconnect', id: thirdId });
  const closed = await new Promise((resolve) => { x.ws.once('close', () => resolve(true)); setTimeout(() => resolve(false), 3000); });
  a = await hello(url, third, { extra: {} });
  check('Disconnect closes the phone and drops its key', closed && (await answer(a)) === 'refused' && state.phones.length === 1);

  // The local session still works at 127.0.0.1 only.
  const localUrl = await new Promise((resolve) => { H.fromMod = ((orig) => (m) => { orig(m); if (m.type === 'local') resolve(m.url); })(H.fromMod); H.toMod({ type: 'local' }); });
  const ls = new URLSearchParams(new URL(localUrl).hash.slice(1)).get('s');
  const l = socket(`http://127.0.0.1:${port}`, `http://127.0.0.1:${port}`);
  await l.opened;
  await l.next('challenge');
  l.send({ t: 'hello', session: ls });
  check('local session in at 127.0.0.1', (await answer(l)) === 'in');
  const lt = socket(url, url);
  await lt.opened;
  await lt.next('challenge');
  lt.send({ t: 'hello', session: ls });
  check('local session refused through the tunnel', (await answer(lt)) === 'refused');

  writeFileSync(join(dataDir, 'run.json'), JSON.stringify({ url }));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed. Exiting without stopping (like a thread ending).`);
  process.exit(results.every(Boolean) ? 0 : 1);
}

if (mode === 'relink') {
  const prev = JSON.parse(readFileSync(join(dataDir, 'run.json'), 'utf8'));
  await until((s) => s.type === 'state' && s.tunnel.status === 'ready', 10000, 'the relinked tunnel');
  check('restarted mod reuses the running tunnel', state.tunnel.url === prev.url, state.tunnel.url);
  const a = await hello(prev.url, await keptPhone(), { extra: {} });
  check('the paired phone is in by signature after the restart', (await answer(a)) === 'in');
  H.toMod({ type: 'stop' });
  await until((s) => s.type === 'state' && s.tunnel.status === 'ended', 10000, 'the stop');
  check('Stop the tunnel ends it', true);
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed.`);
  process.exit(results.every(Boolean) ? 0 : 1);
}

if (mode === 'auto') {
  check('the setting is on', state?.autoStart === true || (await until((s) => s.type === 'state', 5000)).autoStart === true);
  await until((s) => s.type === 'state' && (s.tunnel.status === 'ready' || s.tunnel.status === 'ended'), 90000, 'the tunnel');
  check('with the setting on and a phone paired, the tunnel starts with the mod', state.tunnel.status === 'ready' && logs.some((l) => /starting with the game/.test(l)), state.tunnel.url);
  const a = await hello(state.tunnel.url, await keptPhone(), { extra: {} });
  check('a new address: the paired phone is in by signature, no Allow', (await answer(a)) === 'in');
  H.toMod({ type: 'stop' });
  await until((s) => s.type === 'state' && s.tunnel.status === 'ended', 10000, 'the stop');
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed.`);
  process.exit(results.every(Boolean) ? 0 : 1);
}

// The game booting with the phone window open (the crash of 2026-10-29). REDnode reports the
// main menu with no world until the plugin speaks, then the plugin says mainMenu false with no V
// yet (when the old mod crashed the game). The in-game screen connects at once; no world call
// may be made until world is true. Then V arrives: the time, district and rain follow. Then a
// load from the pause menu takes V away without the main menu, and brings V back.
if (mode === 'boot') {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const liveTick = async (s, test = () => true, ms = 6000) => {
    s.got.length = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = s.got.find((m) => m.t === 'tick' && m.seconds !== null && m.district && test(m));
      if (m) return { ...m, after: Date.now() - t0 };
      await wait(100);
    }
    return null;
  };
  H.toMod({ type: 'hello' });
  const localUrl = await new Promise((resolve) => { H.fromMod = ((orig) => (m) => { orig(m); if (m.type === 'local') resolve(m.url); })(H.fromMod); H.toMod({ type: 'local' }); });
  const ls = new URLSearchParams(new URL(localUrl).hash.slice(1)).get('s');
  const l = socket(`http://127.0.0.1:${port}`, `http://127.0.0.1:${port}`);
  await l.opened;
  await l.next('challenge');
  l.send({ t: 'hello', session: ls });
  check('the in-game screen connects while the game boots', (await answer(l)) === 'in');
  await wait(2500);
  H.setWorld(false, false); // the plugin's first ui-state: past the main menu's flag, no V yet
  await wait(4000);
  const bootTicks = l.got.filter((m) => m.t === 'tick');
  check('while the game boots (world false): ticks go on, with no time and no place', bootTicks.length >= 4 && bootTicks.every((m) => m.seconds === null && !m.district && !m.rain), `${bootTicks.length} ticks`);
  check("while the game boots: no call into the game's world at all", H.worldCalls === 0, `${H.worldCalls} calls`);

  H.setWorld(true);
  const live = await liveTick(l);
  check('once world is true, the time, district and rain arrive at once', !!live && live.district === 'Watson' && live.rain === 'light' && live.after < 2500, live ? `${live.after} ms` : 'none');
  check('the district is named through loc.text', H.locCalls > 0, `${H.locCalls} reads`);

  // Another save loads from the pause menu: world goes false without the main menu.
  H.setWorld(false);
  await wait(1200); // a tick already under way may finish
  const before = H.badCalls;
  const callsBefore = H.worldCalls;
  l.got.length = 0;
  await wait(4000);
  const loadTicks = l.got.filter((m) => m.t === 'tick');
  check('during a load from the pause menu: no world call, not even on held objects', H.badCalls === before && H.worldCalls === callsBefore, `${H.worldCalls - callsBefore} calls in 4 s, ${before} bad in all`);
  check('during the load: the time and place are cleared', loadTicks.length >= 2 && loadTicks.every((m) => m.seconds === null && !m.district), `${loadTicks.length} ticks`);

  // V is back, in another language: the name follows the game's text.
  H.lang = 'ru';
  H.setWorld(true);
  const ru = await liveTick(l, (m) => m.district === 'Уотсон');
  check("back in the world, the district is read again at once, in the player's language", !!ru && ru.after < 2500, ru ? `${ru.district}, ${ru.after} ms` : 'none');

  // An unknown key: the record's own name.
  H.locNull = true;
  H.setWorld(false);
  await wait(1200);
  H.setWorld(true);
  const fallback = await liveTick(l, (m) => m.district === 'Watson');
  check("a key the game has no text for: the record's name", !!fallback, fallback?.district ?? 'none');

  // To the main menu.
  H.setWorld(false, true);
  await wait(1200);
  const menuBad = H.badCalls;
  await wait(3000);
  check('at the main menu: no world call, and none made outside the world all run', H.badCalls === menuBad && menuBad === 0, `${menuBad} bad calls in all`);

  // A load starts between two calls of one round (the 0.0.7 test): REDnode refuses the next
  // call, and the mod hears of the load 3 s later. The refusal must stop the round, stop the
  // calls until V is back, and not be logged as a failure.
  for (const what of ['GetScriptableSystemsContainer', 'GetWeatherSystem']) {
    H.locNull = false;
    H.setWorld(true);
    await liveTick(l);
    const seen = [];
    const keep = console.log;
    console.log = (...a) => { seen.push(a.join(' ')); keep(...a); };
    const bad0 = H.badCalls;
    H.eventLate = 3000;
    H.loadAt = what;
    const t0 = Date.now();
    while (!H.loadStarted && Date.now() - t0 < 8000) await wait(50);
    await wait(200);
    const calls0 = H.worldCalls;
    l.got.length = 0;
    await wait(2500); // the mod has not heard of the load yet
    const ticks = l.got.filter((m) => m.t === 'tick');
    console.log = keep;
    H.loadStarted = 0;
    check(`a load between two calls (at ${what}): one refused call, then none until V is back`, H.badCalls - bad0 === 1 && H.worldCalls === calls0, `${H.badCalls - bad0} refused, ${H.worldCalls - calls0} calls after`);
    check(`  and the phone shows no time or place meanwhile`, ticks.length >= 2 && ticks.every((m) => m.seconds === null && !m.district && !m.rain), `${ticks.length} ticks`);
    check(`  and nothing is logged as a failure`, !seen.some((s) => s.includes('Status line')), seen.join(' | ') || 'no lines');
    await wait(1000); // the late event arrives
  }
  H.setWorld(true);
  const back = await liveTick(l);
  check('V back after those loads: the time and place again', !!back, back ? `${back.district}, ${back.after} ms` : 'none');

  // EDGEmobile's service, for EDGEphone only.
  const svc = await import(pathToFileURL(join(PKG, 'service.mjs')).href);
  const mod = await import(pathToFileURL(join(PKG, 'mod.mjs')).href);
  H.caller = { id: 'edgephone', name: 'EDGEphone' };
  const scr = svc.screen();
  check('EDGEphone gets its screen and the run from the service', scr.run === svc.run() && scr.run === mod.RUN && scr.url.startsWith(`http://127.0.0.1:${port}/#s=`), scr.run);
  const ps = socket(`http://127.0.0.1:${port}`, `http://127.0.0.1:${port}`);
  await ps.opened;
  await ps.next('challenge');
  ps.send({ t: 'hello', session: new URLSearchParams(new URL(scr.url).hash.slice(1)).get('s') });
  check('the screen\'s session is in at 127.0.0.1', (await answer(ps)) === 'in');
  let refusedOthers = 0;
  for (const c of [{ id: 'some-mod', name: 'Some mod' }, { assistant: 'claude-code' }, null]) {
    H.caller = c;
    try { svc.screen(); } catch { refusedOthers++; }
    try { svc.run(); } catch { refusedOthers++; }
  }
  check('any other package, an assistant, or no caller is refused', refusedOthers === 6);
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed.`);
  process.exit(results.every(Boolean) ? 0 : 1);
}

// C1: mobile apps and Chooms!. The game starts at the main menu; the in-game screen signs in at
// 127.0.0.1 and opens Chooms! through the bridge, as the shell would.
if (mode === 'apps') {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitMsg = async (s, pred, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = s.got.findIndex(pred);
      if (i >= 0) return s.got.splice(i, 1)[0];
      await wait(30);
    }
    return null;
  };
  const base = `http://127.0.0.1:${port}`;
  // Old events out of the way, so a wait for the next one gets the next one.
  const drain = () => { for (let i = l.got.length - 1; i >= 0; i--) if (l.got[i].t === 'app-event') l.got.splice(i, 1); };
  const viaTunnelGet = (path) => new Promise((resolve, reject) => {
    http.get(base + path, { headers: { 'cf-ray': 'test' } }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); }).on('error', reject);
  });
  const getBin = (path) => new Promise((resolve, reject) => {
    http.get(base + path, (res) => { const parts = []; res.on('data', (d) => parts.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) })); }).on('error', reject);
  });

  // Every call Chooms! answers, to see what a page in the browser asked for.
  const answered = [];
  const svc = H.services.chooms;
  H.services.chooms = { mobile: (req) => (answered.push(req.call), svc.mobile(req)) };

  H.toMod({ type: 'hello' });
  const localUrl = await new Promise((resolve) => { H.fromMod = ((orig) => (m) => { orig(m); if (m.type === 'local') resolve(m.url); })(H.fromMod); H.toMod({ type: 'local' }); });
  const ls = new URLSearchParams(new URL(localUrl).hash.slice(1)).get('s');
  const l = socket(base, base);
  await l.opened;
  await l.next('challenge');
  l.send({ t: 'hello', session: ls });
  check('the in-game screen is in', (await answer(l)) === 'in');
  const appsMsg = await waitMsg(l, (m) => m.t === 'apps');
  const chooms = appsMsg?.apps.find((a) => a.id === 'chooms');
  check('the installed apps arrive: Chooms!, with its icon and page', !!chooms && chooms.name === 'Chooms!' && chooms.icon === '/apps/chooms/icon.svg' && chooms.entry === '/apps/chooms/index.html', JSON.stringify(chooms));

  // Its files, and the rules they come with.
  let r = await get(`${base}/apps/chooms/index.html`);
  const acsp = r.headers['content-security-policy'] ?? '';
  check("the app's page is served, sandboxed with no network of its own", r.status === 200 && r.body.includes('Chooms!') && acsp.includes('sandbox allow-scripts allow-forms') && acsp.includes("connect-src 'none'") && !acsp.includes('allow-same-origin'), acsp);
  check('  and framed only by the shell, in the game window', acsp.includes(`frame-ancestors 'self' ${base} file:`));
  r = await getBin('/apps/chooms/fonts/teko-latin-700-normal.woff2');
  check("the app's font is served for an opaque origin (CORS)", r.status === 200 && r.headers['access-control-allow-origin'] === '*' && r.headers['content-type'] === 'font/woff2');
  r = await get(`${base}/mobile.js`);
  check('the mobile library is served', r.status === 200 && r.body.includes("op: 'call'"));
  let refusedAll = true;
  for (const p of ['/apps/chooms/../../edgemobile/mod.mjs', '/apps/chooms/%2e%2e/%2e%2e/phones.json', '/apps/chooms/..%2f..%2fphones.json', '/apps/nothing/index.html', '/apps/chooms/', '/apps/chooms/app.exe', '/media/nothing']) {
    r = await get(base + p);
    if (r.status !== 404) refusedAll = false, console.log(`  not refused: ${p} ${r.status}`);
  }
  check("nothing outside an app's folder, no unknown app, no unknown media", refusedAll);
  r = await viaTunnelGet('/apps/chooms/index.html');
  check('through the tunnel with no tunnel running: not served', r.status === 404);

  // The bridge.
  let n = 0;
  const callApp = async (call, ...args) => {
    const id = ++n;
    l.send({ t: 'app-call', id, app: 'chooms', call, args });
    const m = await waitMsg(l, (x) => x.t === 'app-result' && x.id === id);
    if (!m) throw new Error('no answer');
    if (!m.ok) throw new Error(m.error);
    return m.value;
  };
  let st = await callApp('state');
  check('before a save is loaded: Chooms! says so', st.ready === false && st.reason === 'no-save', JSON.stringify(st));
  l.send({ t: 'app-call', id: 900, app: 'nothing', call: 'state', args: [] });
  let bad = await waitMsg(l, (x) => x.t === 'app-result' && x.id === 900);
  check('a call for an app that is not installed is refused', bad && !bad.ok, bad?.error);
  l.send({ t: 'app-call', id: 901, app: 'chooms', call: '../x', args: [] });
  bad = await waitMsg(l, (x) => x.t === 'app-result' && x.id === 901);
  check('a call with a bad name is refused before the package', bad && !bad.ok && bad.error === 'Not a call.', bad?.error);
  let refused = 0;
  for (const caller of [{ id: 'some-mod' }, { assistant: 'claude-code' }, null]) {
    H.callers.chooms = caller;
    try { svc.mobile({ app: 'chooms', call: 'state', args: [] }); } catch { refused++; }
  }
  H.callers.chooms = { id: 'edgemobile' };
  try { svc.mobile({ app: 'other', call: 'state', args: [] }); } catch { refused++; }
  H.callers.chooms = null;
  check('Chooms! answers EDGEmobile for its own app only', refused === 4);

  // A save loads: a playthrough, its history, the app told.
  l.send({ t: 'app-open', app: 'chooms' });
  await wait(100);
  H.setWorld(true);
  const ev = await waitMsg(l, (m) => m.t === 'app-event' && m.app === 'chooms' && m.event === 'changed', 8000);
  check('once V is in the world, the open app hears its feed is ready', !!ev);
  const pid = H.facts.chooms_playthrough;
  check('the playthrough gets an id, kept in a game fact', Number.isInteger(pid) && pid > 0, String(pid));
  st = await callApp('state');
  check('  and Chooms! is ready, with its badge', st.ready === true && st.badge === 2, JSON.stringify(st));

  let f = await callApp('feed');
  const by = f.posts.map((p) => p.by.id);
  check('the feed: who V follows, and corporations', by.includes('judy') && by.includes('jackie') && by.includes('militech') && by.includes('arasaka') && !by.includes('panam') && !by.includes('kerry'), by.join(','));
  check('  newest first', f.posts[0].by.id === 'judy' && f.posts[0].ago === '12m', `${f.posts[0].by.id} ${f.posts[0].ago}`);
  check('  chooms: Jackie', f.chooms.map((a) => a.id).join() === 'jackie');
  check('  You Might Already Know: met, not followed', ['panam', 'river', 'kerry'].every((id) => f.suggestions.some((a) => a.id === id)) && !f.suggestions.some((a) => ['judy', 'jackie', 'viktor', 'hanako'].includes(a.id)), f.suggestions.map((a) => a.id).join(','));
  let s = await callApp('search', 'han');
  check('search finds only who V knows of (not Hanako yet)', !s.results.some((a) => a.id === 'hanako'), s.results.map((a) => a.id).join(','));
  s = await callApp('search', 'arasaka');
  check('  corporations, always', s.results.some((a) => a.id === 'arasaka'));
  let fail = await callApp('profile', 'hanako').then(() => null, (e) => e.message);
  check('  and no profile of someone V has not met', fail === 'No such account.', fail);

  // Follow, the Choom Request, comments, likes, messages.
  let p = await callApp('profile', 'judy');
  check("Judy's profile: she follows V and wants to be V's choom", p.relation.followsV && p.relation.request === 'pending' && !p.relation.canMessage);
  fail = await callApp('send', 'judy', 'hey').then(() => null, (e) => e.message);
  check('  no message before V accepts', fail === 'You can only message your chooms.', fail);
  p = await callApp('accept', 'judy');
  const badge = await waitMsg(l, (m) => m.t === 'apps' && m.apps.find((a) => a.id === 'chooms')?.badge === 1, 3000);
  check('V accepts: chooms, and the badge on the home screen drops', p.relation.choom && p.relation.canMessage && !!badge);
  let t = await callApp('send', 'judy', 'Saw your dive pics. Next time I am coming.');
  check('  and V can message her', t.messages.at(-1).mine && t.messages.at(-1).text.startsWith('Saw your dive'));
  fail = await callApp('accept', 'panam').then(() => null, (e) => e.message);
  check('V cannot accept what was never asked (or send a request)', fail === 'There is no Choom Request from them.', fail);
  p = await callApp('follow', 'panam', true);
  f = await callApp('feed');
  check("V follows Panam: her posts join the feed", p.relation.follows && f.posts.some((x) => x.by.id === 'panam') && !f.suggestions.some((a) => a.id === 'panam'));
  const judyPost = f.posts.find((x) => x.by.id === 'judy');
  let post = await callApp('like', judyPost.id, true);
  check('a like counts once', post.liked && post.likes === judyPost.likes + 1);
  post = await callApp('comment', judyPost.id, 'Gorgeous, Judy.');
  check('a comment from V', post.commentList.at(-1).by.id === 'v' && post.commentList.at(-1).text === 'Gorgeous, Judy.' && post.comments === 5);
  post = await callApp('likeComment', judyPost.id, post.commentList[0].id, true);
  check('  and a liked comment', post.commentList[0].liked);
  fail = await callApp('comment', judyPost.id, '   ').then(() => null, (e) => e.message);
  check('  an empty comment is refused', fail === 'Write something first.', fail);
  t = await callApp('threads');
  check('DMs: Jackie has one unread', t.threads.find((x) => x.with.id === 'jackie')?.unread === 1);
  await callApp('thread', 'jackie');
  const b0 = await waitMsg(l, (m) => m.t === 'apps' && m.apps.find((a) => a.id === 'chooms')?.badge === 0, 3000);
  check('  reading it clears the badge', !!b0);
  const ab = await waitMsg(l, (m) => m.t === 'app-event' && m.event === 'badge' && m.data?.count === 0, 3000);
  check('  on the home screen and in the open app', !!ab);
  const mine = await callApp('newPost', 'Heading to the Afterlife.');
  f = await callApp('feed');
  check('V posts: it is first in the feed', f.posts[0].id === mine.id && f.posts[0].by.id === 'v');

  // Images: a portrait and a place, as the settings window sends them, then a test post.
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360f8cfc0f01f0005000201c5e8e0d50000000049454e44ae426082', 'hex');
  const fromWin = [];
  H.chan.chooms.fromMod = (m) => fromWin.push(m);
  H.chan.chooms.toMod({ type: 'upload', upload: 'u1', person: 'judy', kind: 'portrait', i: 0, n: 1, chunk: png.toString('base64') });
  H.chan.chooms.toMod({ type: 'upload', upload: 'u2', person: 'judy', kind: 'setting', i: 0, n: 2, chunk: png.subarray(0, 30).toString('base64') });
  H.chan.chooms.toMod({ type: 'upload', upload: 'u2', person: 'judy', kind: 'setting', i: 1, n: 2, chunk: png.subarray(30).toString('base64') });
  H.chan.chooms.toMod({ type: 'upload', upload: 'u3', person: 'judy', kind: 'setting', i: 0, n: 1, chunk: Buffer.from('not an image at all').toString('base64') });
  H.chan.chooms.toMod({ type: 'upload', upload: 'u4', person: 'judy', kind: 'body', i: 0, n: 1, chunk: png.toString('base64') });
  H.chan.chooms.toMod({ type: 'upload', upload: 'u5', person: 'jackie', kind: 'body', i: 0, n: 1, chunk: png.toString('base64') });
  H.chan.chooms.toMod({ type: 'image-remove', person: 'jackie', kind: 'body' });
  H.chan.chooms.toMod({ type: 'image-remove', person: 'jackie', kind: 'settings' });
  H.chan.chooms.toMod({ type: 'setting-edit', person: 'judy', index: 0, description: 'Lizzies Bar, the back room', activities: 'editing a BD\nfixing her rig' });
  H.chan.chooms.toMod({ type: 'try-post', person: 'judy', index: 0 });
  H.chan.chooms.toMod({ type: 'person', person: 'judy' });
  await wait(200);
  const personMsg = fromWin.filter((m) => m.type === 'person').at(-1);
  check('the window: a portrait and a place, sent in pieces; not-an-image refused', personMsg?.portrait?.startsWith('data:image/png;base64,') && personMsg.settings.length === 1 && personMsg.settings[0].activities === 'editing a BD\nfixing her rig' && fromWin.some((m) => m.type === 'error' && /Only PNG/.test(m.text)));
  const listMsg = fromWin.filter((m) => m.type === 'state').at(-1);
  const lj = (id) => listMsg?.people.find((x) => x.id === id);
  check('  a body image beside the portrait; removing one removes only it', personMsg?.body?.startsWith('data:image/png;base64,') && lj('judy')?.body && lj('judy')?.portrait && lj('jackie') && !lj('jackie').body, JSON.stringify({ judy: lj('judy'), jackie: lj('jackie') }));
  f = await callApp('feed');
  const pic = f.posts.find((x) => x.image);
  check('a test post with the place: its image, and Judy\'s portrait, as media addresses', pic?.by.id === 'judy' && /^\/media\/[A-Za-z0-9_-]{24}$/.test(pic.image.url) && /^\/media\//.test(pic.by.avatar?.url ?? ''), `${pic?.image?.url} ${pic?.by.avatar?.url}`);
  r = await getBin(pic.image.url);
  check('  the media address gives the image', r.status === 200 && r.headers['content-type'] === 'image/png' && r.body.equals(png));
  check('  no file path reaches the screen', !JSON.stringify(f).includes('people/judy'));

  // The window's own picker (the system's opens behind the game): browse, peek, pick.
  const pics = join(OUT, 'pick-test');
  fs.rmSync(pics, { recursive: true, force: true });
  fs.mkdirSync(join(pics, 'Sub folder'), { recursive: true });
  fs.writeFileSync(join(pics, 'shot.png'), png);
  fs.writeFileSync(join(pics, 'Sub folder', 'inner.png'), png);
  fs.writeFileSync(join(pics, 'notes.txt'), 'not shown');
  fs.writeFileSync(join(pics, 'fake.png'), 'not an image at all');
  const winMsg = async (send, pred) => { fromWin.length = 0; H.chan.chooms.toMod(send); for (let i = 0; i < 40; i++) { const m = fromWin.find(pred); if (m) return m; await wait(25); } return null; };
  let bw = await winMsg({ type: 'browse', path: pics }, (m) => m.type === 'browse');
  check('picker: a folder lists its subfolders and images only', bw?.path === pics && bw.dirs.join() === 'Sub folder' && bw.files.map((x) => x.name).sort().join() === 'fake.png,shot.png' && bw.parent === dirname(pics) && bw.places.length > 0, JSON.stringify(bw && { dirs: bw.dirs, files: bw.files.map((x) => x.name), places: bw.places.map((x) => x.name) }));
  bw = await winMsg({ type: 'browse', path: pics, into: 'Sub folder' }, (m) => m.type === 'browse');
  check('  into a subfolder', bw?.path === join(pics, 'Sub folder') && bw.files[0]?.name === 'inner.png');
  bw = await winMsg({ type: 'browse', path: pics, into: '..\\..' }, (m) => m.type === 'browse');
  check('  a name with a path in it is not followed', bw?.path !== pathResolve(pics, '..', '..'), bw?.path);
  const peeked = await winMsg({ type: 'peek', path: pics, name: 'shot.png' }, (m) => m.type === 'peek');
  check("  a preview of the selected image", peeked?.data === `data:image/png;base64,${png.toString('base64')}`);
  const pkBad = await winMsg({ type: 'peek', path: pics, name: 'fake.png' }, (m) => m.type === 'peek');
  check('  not-an-image refused', /Only PNG/.test(pkBad?.error ?? ''));
  const picked = await winMsg({ type: 'upload', upload: 'u6', person: 'judy', kind: 'setting', i: 0, n: 1, chunk: png.toString('base64'), folder: pics, name: 'shot.png' }, (m) => m.type === 'person');
  check('  the picked image, sent by the window, becomes a place in the package\'s folder', picked?.settings.length === 2 && picked.settings[1].image === peeked.data && fromWin.some((m) => m.type === 'note' && m.text === 'shot.png added.'));
  const pickBad = await winMsg({ type: 'peek', path: pics, name: '..\\shot.png' }, (m) => m.type === 'peek');
  check('  a name with a path in it is refused', !!pickBad?.error && !pickBad.data);
  const oldPick = await winMsg({ type: 'pick', person: 'judy', kind: 'setting', path: pics, name: 'shot.png' }, (m) => m.type === 'person');
  check('  the old pick message copies nothing', !oldPick);
  bw = await winMsg({ type: 'browse' }, (m) => m.type === 'browse');
  check('  the picker opens again where the last image came from', bw?.path === pics, bw?.path);

  // Bundled pictures and places (content/): copied into the player's folder at the first start.
  let vk = await winMsg({ type: 'person', person: 'viktor' }, (m) => m.type === 'person' && m.id === 'viktor');
  const viktorDir = join(dataDir, '..', 'chooms', 'people', 'viktor');
  check('bundled pictures: Viktor starts with the portrait and two places Chooms! comes with', vk?.portrait === `data:image/png;base64,${variant(1).toString('base64')}` && vk.settings.length === 2 && vk.settings[0].description === 'His clinic, under the boxing gym' && vk.settings[0].activities === 'patching up a merc' && vk.defaults === true && fs.existsSync(join(viktorDir, 'v2.png')), JSON.stringify(vk && { n: vk.settings.length, d: vk.defaults }));
  const mistyMsg = await winMsg({ type: 'person', person: 'misty' }, (m) => m.type === 'person' && m.id === 'misty');
  check('  a bundled image that is missing is left out', mistyMsg?.body === null);
  H.chan.chooms.toMod({ type: 'setting-remove', person: 'viktor', index: 1 });
  H.chan.chooms.toMod({ type: 'upload', upload: 'u7', person: 'viktor', kind: 'portrait', i: 0, n: 1, chunk: variant(9).toString('base64') });
  await wait(200);
  vk = await winMsg({ type: 'person', person: 'viktor' }, (m) => m.type === 'person' && m.id === 'viktor');
  const ownPortrait = JSON.parse(readFileSync(join(dataDir, '..', 'chooms', 'settings.json'), 'utf8')).people.viktor.portrait;
  check('  the player changes them: a place removed, a portrait of their own', vk?.settings.length === 1 && vk.portrait === `data:image/png;base64,${variant(9).toString('base64')}` && !fs.existsSync(join(viktorDir, 'v3.png')));
  vk = await winMsg({ type: 'reset', person: 'viktor' }, (m) => m.type === 'person' && m.id === 'viktor');
  check('  Reset to default: the bundled ones again, the player\'s own removed', vk?.settings.length === 2 && vk.portrait === `data:image/png;base64,${variant(1).toString('base64')}` && !fs.existsSync(join(dataDir, '..', 'chooms', ownPortrait)));
  const noReset = await winMsg({ type: 'reset', person: 'river' }, (m) => m.type === 'person');
  check('  no reset for a person with nothing bundled', !noReset);
  // The export makes content/ from the player's own: each person's images, named by a hash.
  const exportOut = join(appsRoot, 'export-test');
  const ex = spawnSync(process.execPath, [join(REPO, 'tools', 'chooms', 'export-content.mjs'), '--data', join(dataDir, '..', 'chooms'), '--out', exportOut], { encoding: 'utf8' });
  const exported = ex.status === 0 ? JSON.parse(readFileSync(join(exportOut, 'content.json'), 'utf8')) : null;
  const ej = exported?.people.judy;
  const evk = exported?.people.viktor;
  check('the export: each person\'s portrait, body image and places, named by a hash, with their lines', !!ej?.portrait && !!ej.body && ej.places.length === 2 && ej.places[0].description === 'Lizzies Bar, the back room' && /^people\/judy\/[0-9a-f]{16}\.png$/.test(ej.portrait) && evk?.places.length === 2 && !exported.people.river && fs.existsSync(join(exportOut, ej.places[1].file)), ex.stdout.split('\n').slice(0, 3).join(' | ') + ex.stderr);
  check('  the same image keeps the same name', evk?.places[0].file === `people/viktor/${createHash('sha256').update(variant(2)).digest('hex').slice(0, 16)}.png`);

  // An older save of the same playthrough: what came after it is dropped.
  const before = H.time;
  H.time = before + 3600;
  H.setWorld(false);
  drain();
  H.setWorld(true);
  await waitMsg(l, (m) => m.t === 'app-event' && m.event === 'changed', 3000);
  await callApp('follow', 'kerry', true);
  await callApp('newPost', 'An hour later.');
  H.setWorld(false);
  H.time = before + 1800;
  drain();
  H.setWorld(true);
  await waitMsg(l, (m) => m.t === 'app-event' && m.event === 'changed', 6000);
  f = await callApp('feed');
  p = await callApp('profile', 'kerry');
  const pj = await callApp('profile', 'judy');
  check('an older save: what happened after it is gone, what happened before it stays', !f.posts.some((x) => x.text === 'An hour later.') && f.posts.some((x) => x.text === 'Heading to the Afterlife.') && !p.relation.follows && pj.relation.choom, `kerry follows ${p.relation.follows}`);
  H.setWorld(false);
  H.time = before - 7200;
  drain();
  H.setWorld(true);
  await waitMsg(l, (m) => m.t === 'app-event' && m.event === 'changed', 6000);
  const pj2 = await callApp('profile', 'judy');
  f = await callApp('feed');
  check('  an even older one: the accept, the posts and the likes go too', pj2.relation.request === 'pending' && !f.posts.some((x) => x.by.id === 'v') && !f.posts.some((x) => x.by.id === 'panam'), `judy ${pj2.relation.request}`);
  const ths = await callApp('threads');
  const dive = pj2.posts.find((x) => /Night dive/.test(x.text));
  check('  the hand-written posts, comments and messages stay, though dated after that save', dive?.comments === 4 && f.posts.some((x) => x.by.id === 'jackie') && !!ths.threads.find((t) => t.with.id === 'jackie')?.last, JSON.stringify({ judy: pj2.posts.map((x) => [x.text.slice(0, 12), x.comments]), jackie: ths.threads.find((t) => t.with.id === 'jackie') }));

  // Another playthrough: a history of its own; back to the first: the first again.
  H.setWorld(false);
  H.facts.chooms_playthrough = 0;
  drain();
  H.setWorld(true);
  await waitMsg(l, (m) => m.t === 'app-event' && m.event === 'changed', 6000);
  const pid2 = H.facts.chooms_playthrough;
  f = await callApp('feed');
  check('a new playthrough: its own id and a fresh history', pid2 && pid2 !== pid && !f.posts.some((x) => x.image) && f.posts.some((x) => x.by.id === 'judy'));
  await callApp('follow', 'kerry', true);
  H.setWorld(false);
  H.facts.chooms_playthrough = pid;
  drain();
  H.setWorld(true);
  await waitMsg(l, (m) => m.t === 'app-event' && m.event === 'changed', 6000);
  const pk = await callApp('profile', 'kerry');
  check('  back to the first: its own history again', !pk.relation.follows);
  H.setWorld(false);
  H.facts.chooms_playthrough = pid2;
  drain();
  H.setWorld(true);
  await waitMsg(l, (m) => m.t === 'app-event' && m.event === 'changed', 6000);
  const pk2 = await callApp('profile', 'kerry');
  check('  and the second keeps its own', pk2.relation.follows);

  // Media addresses, by themselves: they end, they stay inside the package's folder.
  const { Bridge } = await import(pathToFileURL(join(PKG, 'server', 'bridge.mjs')).href);
  const fakeApps = { list: [{ id: 'chooms', name: 'Chooms!', package: 'chooms', entry: 'index.html', icon: null }], get: (id) => fakeApps.list.find((a) => a.id === id) };
  const sent = [];
  const fakeService = { connect: async () => ({ $on: () => {}, $with: () => ({ mobile: async () => ({ a: { $media: 'people/judy/../../edgemobile/settings.json' }, b: { $media: '../edgemobile/phones.json' }, c: { $media: 'C:/Windows/win.ini' }, d: { $media: personPath } }) }) }) };
  const personPath = JSON.parse(readFileSync(join(dataDir, '..', 'chooms', 'settings.json'), 'utf8')).people.judy.portrait;
  const br = new Bridge({ apps: fakeApps, service: fakeService, dataDir, send: (c, m) => sent.push(m), screens: () => [], mediaMs: 300 });
  await br.call({ local: true }, { id: 1, app: 'chooms', call: 'x', args: [] });
  const v = sent[0].value;
  check('a media path that leaves the package\'s folder gives nothing', v.a === null && v.b === null && v.c === null && /^\/media\//.test(v.d?.url ?? ''), JSON.stringify(v));
  const tok = v.d.url.slice('/media/'.length);
  const okNow = !!br.media(tok);
  await wait(400);
  check('  and a media address ends', okNow && br.media(tok) === null);

  // An app unpacked while the game runs, then removed.
  const extra = join(appsRoot, 'mobile-apps', 'test-app');
  mkdirSync(extra, { recursive: true });
  writeFileSync(join(extra, 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(join(extra, 'mobile-app.json'), JSON.stringify({ id: 'test-app', name: 'Test app', entry: 'index.html' }));
  let am = await waitMsg(l, (m) => m.t === 'apps' && m.apps.some((a) => a.id === 'test-app'), 5000);
  check('an app unpacked while the game runs shows', !!am);
  rmSync(extra, { recursive: true, force: true });
  am = await waitMsg(l, (m) => m.t === 'apps' && !m.apps.some((a) => a.id === 'test-app'), 5000);
  check('  and goes when removed', !!am);

  // In Chrome: the shell opens Chooms! in its sandboxed frame. The loading screen at the main
  // menu, then the feed once a save is loaded.
  const shots = join(OUT, 'shots');
  mkdirSync(shots, { recursive: true });
  const shoot = (out, script, waitMs = '2500', w = '390', hgt = '845') => new Promise((resolve) => {
    const proc = spawn(process.execPath, [join(HERE, 'shot.mjs'), `${base}/#s=${ls}`, join(shots, out), w, hgt, script, waitMs], { stdio: ['ignore', 'pipe', 'inherit'] });
    let outText = '';
    proc.stdout.on('data', (d) => (outText += d));
    proc.on('exit', () => resolve(outText));
  });
  const OPEN = `(async () => { const b = document.querySelector('[data-app="chooms"]'); if (!b) return 'no icon'; b.click(); await new Promise(r => setTimeout(r, 3500)); const f = document.getElementById('appFrame'); let reach = 'blocked'; try { reach = f.contentDocument ? 'reached' : 'blocked'; } catch { reach = 'blocked'; } return reach; })()`;
  // First with Chooms!'s package switched off: the loading screen stays, and says why.
  answered.length = 0;
  H.services.chooms = { mobile: (req) => { answered.push(req.call); throw new Error('chooms is not running'); } };
  let out = await shoot('c1-loading.png', OPEN);
  check('in Chrome: the app runs in its frame and asks its package (scripts load under the sandbox)', answered.includes('state'), answered.join(','));
  check("  the shell cannot reach into the app's frame", /"blocked"/.test(out), out.trim().split('\n')[0]);
  H.services.chooms = { mobile: (req) => (answered.push(req.call), svc.mobile(req)) };
  answered.length = 0;
  // Then the feed, and a walk through the screens with real clicks: Judy's profile, the DMs, Jackie's thread.
  process.env.SHOT_STEPS = JSON.stringify([
    { click: [140, 457], wait: 1500, shot: 'c1-profile.png' },
    { click: [272, 790], wait: 1500, shot: 'c1-dms.png' },
    { click: [195, 250], wait: 1500, shot: 'c1-thread.png' },
    { click: [350, 790], wait: 1500, shot: 'c1-me.png' },
  ]);
  out = await shoot('c1-feed.png', OPEN, '2500');
  delete process.env.SHOT_STEPS;
  // The home screen with its apps, and the phone in the game (EDGEphone's window, its screen
  // pointed here) opening Chooms! with a click.
  await shoot('c1-home.png', '');
  const phoneWin = pathToFileURL(join(REPO, 'edgephone', 'window.html')).href;
  const POINT = `(() => { const f = document.getElementById('screen'); f.src = ${JSON.stringify(`${base}/#s=`)} + ${JSON.stringify(ls)}; f.hidden = false; document.getElementById('wait').hidden = true; return 'ok'; })()`;
  process.env.SHOT_STEPS = JSON.stringify(JSON.parse(process.env.GAME_STEPS || '[]'));
  await new Promise((resolve) => {
    const proc = spawn(process.execPath, [join(HERE, 'shot.mjs'), phoneWin, join(shots, 'c1-game-home.png'), '352', '720', POINT, '1500'], { stdio: 'inherit' });
    proc.on('exit', resolve);
  });
  delete process.env.SHOT_STEPS;
  check('  once a save is loaded, it shows the feed', answered.includes('feed'), answered.join(','));

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed.`);
  process.exit(results.every(Boolean) ? 0 : 1);
}

// For a real browser: a tunnel, QR links written to .out/data/edgemobile/browser.json, and Allow pressed as a
// player would (after the code shows). Runs until `minutes` pass, then stops the tunnel.
if (mode === 'browser') {
  const minutes = Number(process.argv[3] ?? 8);
  const out = join(dataDir, 'browser.json');
  H.toMod({ type: 'hello' });
  if (!['starting', 'ready'].includes(state?.tunnel.status)) H.toMod({ type: 'start' });
  await until((s) => s.type === 'state' && s.tunnel.status === 'ready', 90000, 'the tunnel');
  const write = (extra = {}) => writeFileSync(out, JSON.stringify({ url: state.tunnel.url, link: state.qr?.link ?? null, phones: state.phones, pending: state.pending, ...extra }, null, 2));
  H.toMod({ type: 'new-key' });
  await until((m) => m.type === 'state' && !!m.qr, 5000);
  write();
  console.log(`READY ${state.qr.link}`);
  const localUrl = await new Promise((resolve) => { H.fromMod = ((orig) => (m) => { orig(m); if (m.type === 'local') resolve(m.url); })(H.fromMod); H.toMod({ type: 'local' }); });
  console.log(`LOCAL ${localUrl}`);
  let allowed = 0;
  let seenCode = null;
  H.fromMod = ((orig) => (m) => {
    orig(m);
    if (m.type !== 'state') return;
    if (m.pending && m.pending.code !== seenCode) {
      seenCode = m.pending.code;
      console.log(`PENDING ${m.pending.code} ${m.pending.name}`);
      setTimeout(() => { allowed++; H.toMod({ type: 'allow' }); }, 1500);
    }
    if (!m.qr && !m.pending) H.toMod({ type: 'new-key' });
    write({ allowed });
  })(H.fromMod);
  setTimeout(() => { H.toMod({ type: 'stop' }); setTimeout(() => process.exit(0), 2000); }, minutes * 60000);
}
