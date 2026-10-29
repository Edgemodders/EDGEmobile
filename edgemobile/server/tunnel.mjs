// Cloudflare's cloudflared: fetched on first use, then run by the tunnel keeper (keeper.mjs).
//
// cloudflared is Cloudflare's (Apache-2.0). EDGEmobile does not carry it: it fetches one
// pinned version from Cloudflare's GitHub releases, checks it against the SHA-256 pinned
// here, and keeps it in <dataDir>/cloudflared/<version>/.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLOUDFLARED = {
  version: '2026.10.6',
  sha256: 'd521b3bf68982165f0d06d76732f22d9a105ef057ff3ae4c0986f3a23190950f',
  size: 55390656,
  url: 'https://github.com/cloudflare/cloudflared/releases/download/2026.10.6/cloudflared-windows-amd64.exe',
};

const KEEPER = join(dirname(fileURLToPath(import.meta.url)), 'keeper.mjs');

/** The path of the fetched cloudflared.exe, or null. */
export function findCloudflared(dataDir) {
  const exe = join(dataDir, 'cloudflared', CLOUDFLARED.version, 'cloudflared.exe');
  return existsSync(exe) ? exe : null;
}

/** Downloads and checks cloudflared. onProgress gets (received, total). Resolves with its path. */
export async function fetchCloudflared(dataDir, onProgress = () => {}) {
  const root = join(dataDir, 'cloudflared');
  const dir = join(root, CLOUDFLARED.version);
  const part = join(root, `cloudflared-${CLOUDFLARED.version}.part`);
  mkdirSync(root, { recursive: true });
  try {
    const res = await fetch(CLOUDFLARED.url);
    if (!res.ok || !res.body) throw new Error(`GitHub answered ${res.status}`);
    const total = Number(res.headers.get('content-length')) || CLOUDFLARED.size;
    const hash = createHash('sha256');
    const out = createWriteStream(part);
    let received = 0;
    let last = 0;
    for await (const chunk of res.body) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (Date.now() - last > 250) {
        last = Date.now();
        onProgress(received, total);
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    onProgress(received, total);
    if (hash.digest('hex') !== CLOUDFLARED.sha256) throw new Error("the download did not match the checksum pinned in EDGEmobile, so it was not kept");
    mkdirSync(dir, { recursive: true });
    renameSync(part, join(dir, 'cloudflared.exe'));
  } finally {
    rmSync(part, { force: true });
  }
  // Older versions are no longer used.
  for (const d of readdirSync(root)) if (d !== CLOUDFLARED.version) rmSync(join(root, d), { recursive: true, force: true });
  return findCloudflared(dataDir);
}

export async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * The tunnel, through its keeper. `onState` gets the keeper's state ({ status, url, error })
 * and { status: 'ended' } when the link is lost. A keeper still running from before a mod
 * restart is linked again, so the address stays.
 */
export class Tunnel {
  constructor({ dataDir, localPort, onState, log = console.log }) {
    this.dataDir = dataDir;
    this.localPort = localPort;
    this.onState = onState;
    this.log = log;
    this.file = join(dataDir, 'tunnel.json');
    this.sock = null;
    this.stopping = false;
  }

  /** Links to a keeper left running by the last start of the mod. Resolves true when it did. */
  async relink() {
    let saved;
    try {
      saved = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      return false;
    }
    if (saved.localPort !== this.localPort) return false;
    const ok = await this.#link(saved.linkPort, saved.token, 1);
    if (ok) this.log(`Tunnel: linked again to the running tunnel (keeper ${saved.keeperPid})`);
    else rmSync(this.file, { force: true });
    return ok;
  }

  /** Starts a keeper and its tunnel. */
  async start(exe) {
    this.stopping = false;
    const linkPort = await freePort();
    const token = randomBytes(32).toString('base64url');
    // The host's own program runs keeper.mjs as plain Node. Detached, because Node ends the
    // children it starts when its process ends (they go into a job object of Node's own), and
    // the keeper must outlive a restart of this mod: the restarted mod finds it through
    // tunnel.json. It stays in REDnode's job, so it still ends with the game, and it ends
    // itself 15 s after the mod is gone.
    const keeper = spawn(process.execPath, [KEEPER, exe, String(this.localPort), String(linkPort), join(this.dataDir, 'tunnel.log')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', EDGEMOBILE_LINK_TOKEN: token },
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    keeper.on('error', (err) => this.onState({ status: 'ended', error: `The tunnel keeper did not start: ${err.message}` }));
    keeper.unref();
    writeFileSync(this.file, JSON.stringify({ keeperPid: keeper.pid, linkPort, token, localPort: this.localPort, at: new Date().toISOString() }, null, 2));
    this.log(`Tunnel: keeper ${keeper.pid} started with ${process.execPath}`);
    if (!(await this.#link(linkPort, token, 20))) {
      this.onState({ status: 'ended', error: 'The tunnel keeper did not answer. See tunnel.log in EDGEmobile\'s data folder.' });
    }
  }

  /** Asks the keeper to stop the tunnel now. */
  stop() {
    this.stopping = true;
    if (this.sock) this.sock.write(`${JSON.stringify({ t: 'stop' })}\n`);
    rmSync(this.file, { force: true });
  }

  async #link(port, token, tries) {
    for (let i = 0; i < tries; i++) {
      if (i) await new Promise((r) => setTimeout(r, 250));
      const sock = await new Promise((resolve) => {
        const s = net.connect(port, '127.0.0.1');
        s.once('connect', () => resolve(s));
        s.once('error', () => resolve(null));
      });
      if (!sock) continue;
      this.sock = sock;
      sock.setEncoding('utf8');
      sock.write(`${JSON.stringify({ t: 'hello', token })}\n`);
      let buf = '';
      let answered = false;
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(answered), 2000);
        sock.on('data', (chunk) => {
          buf += chunk;
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const msg = JSON.parse(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
            if (!answered) {
              answered = true;
              clearTimeout(timer);
              resolve(true);
            }
            if (msg.status === 'ended') rmSync(this.file, { force: true });
            this.onState(msg);
          }
        });
        sock.on('error', () => {});
        sock.on('close', () => {
          if (this.sock === sock) this.sock = null;
          if (!answered) {
            clearTimeout(timer);
            resolve(false);
          } else this.onState({ status: 'ended', error: this.stopping ? null : 'The tunnel stopped.' });
        });
      });
    }
    return false;
  }
}
