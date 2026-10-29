// The tunnel keeper: a small Node process that runs Cloudflare's cloudflared for EDGEmobile's
// mod, and ends it when the mod is gone.
//
// REDnode stops a mod by ending its thread, with no last call, so the mod cannot stop
// cloudflared itself. The keeper holds a link to the mod instead. When the link has been gone
// for GRACE_MS it stops cloudflared and exits. A mod restarted by hot reload links again within
// that time and keeps the tunnel and its address. When the game ends, Windows ends the keeper
// and cloudflared with it: REDnode's host runs in a job object that ends every process in it.
//
// Started by tunnel.mjs with the host's own program and ELECTRON_RUN_AS_NODE=1:
//   keeper.mjs <cloudflared.exe> <local port> <link port> <log file>
// with the link's token in EDGEMOBILE_LINK_TOKEN.
//
// The link is newline-delimited JSON over TCP on 127.0.0.1:<link port>.
//   mod -> keeper: { t: 'hello', token }, { t: 'stop' }
//   keeper -> mod: { t: 'state', status, url, startedAt, error? }
//     status: 'starting', 'ready' (the address answers) or 'ended'

import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';
import { appendFileSync, renameSync, statSync } from 'node:fs';
import net from 'node:net';

const [exe, localPort, linkPort, logFile] = process.argv.slice(2);
const TOKEN = Buffer.from(process.env.EDGEMOBILE_LINK_TOKEN ?? '');
const GRACE_MS = 15000; // the mod gone this long: stop
const FIRST_LINK_MS = 30000; // no mod linked this long after start: stop
const READY_MS = 45000; // the address must answer within this time
const URL_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/; // not the API it asks for one

const env = { ...process.env };
delete env.EDGEMOBILE_LINK_TOKEN;
delete env.ELECTRON_RUN_AS_NODE;

function log(line) {
  try {
    if (statSync(logFile, { throwIfNoEntry: false })?.size > 1_000_000) renameSync(logFile, `${logFile}.old`);
    appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // a log that cannot be written must not stop the tunnel
  }
}

const state = { t: 'state', status: 'starting', url: null, startedAt: Date.now() };
const links = new Set();
let lonely = null;
let ending = false;

function send(sock, msg) {
  if (!sock.destroyed) sock.write(`${JSON.stringify(msg)}\n`);
}

function update(change) {
  Object.assign(state, change);
  for (const sock of links) send(sock, state);
}

function waitAlone(ms, why) {
  clearTimeout(lonely);
  lonely = setTimeout(() => end(why), ms);
}

function end(why) {
  if (ending) return;
  ending = true;
  log(`Stopping: ${why}`);
  update({ status: 'ended', error: why });
  child?.kill();
  setTimeout(() => process.exit(0), 3000).unref();
}

// The metrics server answers /ready with 200 once cloudflared has a connection to Cloudflare.
async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// Ready means connected, and the new name published. A phone that scans before the name exists
// gets "not found", and its resolver keeps that answer for 60 s (the zone's negative TTL). So
// the name is checked at trycloudflare.com's own name servers, which keep no cache: asking a
// public resolver too early would make it remember the miss for every phone that uses it.
async function authoritative() {
  try {
    const names = await dns.resolveNs('trycloudflare.com');
    const ips = (await Promise.all(names.map((n) => dns.resolve4(n).catch(() => [])))).flat();
    if (!ips.length) return null;
    const resolver = new dns.Resolver({ timeout: 2000, tries: 1 });
    resolver.setServers(ips);
    return resolver;
  } catch {
    return null;
  }
}

async function waitReady(metricsPort, host) {
  const until = Date.now() + READY_MS;
  const resolver = await authoritative();
  if (!resolver) log('Could not find trycloudflare.com\'s name servers: waiting 5 s after connecting instead');
  let connected = false;
  while (!ending && Date.now() < until) {
    try {
      if (!connected) {
        connected = (await fetch(`http://127.0.0.1:${metricsPort}/ready`)).ok;
        if (connected && !resolver) {
          await new Promise((r) => setTimeout(r, 5000));
          return true;
        }
      }
      if (connected && (await resolver.resolve4(host)).length) return true;
    } catch {
      // not listening, or not published yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const metricsPort = await freePort();
const args = ['tunnel', '--no-autoupdate', '--metrics', `127.0.0.1:${metricsPort}`, '--url', `http://127.0.0.1:${localPort}`];
log(`Starting ${exe} ${args.join(' ')}`);
const child = spawn(exe, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

let seen = '';
const read = (chunk) => {
  const text = chunk.toString();
  for (const line of text.split(/\r?\n/)) if (line.trim()) log(`cloudflared: ${line}`);
  if (state.url) return;
  seen = (seen + text).slice(-4000);
  const found = URL_RE.exec(seen);
  if (!found) return;
  const url = found[0];
  log(`Address: ${url}`);
  const t0 = Date.now();
  waitReady(metricsPort, new URL(url).host).then((ok) => {
    log(`Ready check: ${ok ? 'ready' : 'gave up'} after ${Date.now() - t0} ms`);
    if (ending) return;
    if (ok) update({ status: 'ready', url });
    else end('the tunnel did not connect to Cloudflare, or its address was not found, in time');
  });
  state.url = url; // stops the search; announced once it answers
};
child.stdout.on('data', read);
child.stderr.on('data', read);
child.on('error', (err) => end(`cloudflared did not start: ${err.message}`));
child.on('exit', (code) => {
  log(`cloudflared ended with code ${code}`);
  if (!ending) end(`cloudflared ended (code ${code})`);
  setTimeout(() => process.exit(0), 200);
});

const server = net.createServer((sock) => {
  let buf = '';
  let known = false;
  const refuse = setTimeout(() => sock.destroy(), 2000);
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    buf += chunk;
    if (buf.length > 4096) return sock.destroy();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return sock.destroy();
      }
      if (!known) {
        const token = Buffer.from(String(msg.token ?? ''));
        if (msg.t !== 'hello' || token.length !== TOKEN.length || !timingSafeEqual(token, TOKEN)) return sock.destroy();
        known = true;
        clearTimeout(refuse);
        clearTimeout(lonely);
        links.add(sock);
        send(sock, state);
      } else if (msg.t === 'stop') {
        end('EDGEmobile asked to stop');
      }
    }
  });
  sock.on('error', () => {});
  sock.on('close', () => {
    clearTimeout(refuse);
    if (links.delete(sock) && links.size === 0 && !ending) waitAlone(GRACE_MS, 'EDGEmobile has stopped');
  });
});
server.on('error', (err) => end(`the link could not listen: ${err.message}`));
server.listen(Number(linkPort), '127.0.0.1');
waitAlone(FIRST_LINK_MS, 'EDGEmobile never linked');
