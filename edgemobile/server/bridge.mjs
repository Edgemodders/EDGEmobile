// The bridge from a mobile app to its REDnode package (docs/design.md, "C1 plan"). An app's page
// asks the shell, the shell asks this mod over its signed-in WebSocket, and this mod calls the
// one function the app's package offers to phones: `mobile(request)` in its service file. The
// package's `mobile` events come back to the screens that have the app open. A phone reaches
// that function only: never another package, never REDnode's `api`.
//
// Images: a package's answer may hold { $media: 'path' }, a file inside the package's own data
// folder. The bridge swaps it for { url: '/media/<token>' }, a random address that works for an
// hour, so no file path reaches the phone and no other file can be asked for.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inside } from './apps.mjs';
import { typeOf } from './web.mjs';

const CALL = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
const MAX_ARGS = 16;
const MAX_IN_FLIGHT = 16;
const CALL_MS = 15000;

export class Bridge {
  /**
   * `apps` is the installed apps (server/apps.mjs); `service` is REDnode's; `dataDir` is
   * EDGEmobile's own data folder, beside which REDnode keeps each package's (`packages/<id>`;
   * *unverified* as a promise of REDnode's, seen in its logs). `send(conn, msg)` writes to one
   * screen; `screens()` lists the signed-in ones.
   */
  constructor({ apps, service, dataDir, send, screens, mediaMs = 3600_000, log = console.log }) {
    this.apps = apps;
    this.service = service;
    this.dataRoot = dirname(dataDir);
    this.send = send;
    this.screens = screens;
    this.mediaMs = mediaMs;
    this.log = log;
    this.handles = new Map(); // package id -> service handle
    this.tokens = new Map(); // token -> { file, type, expires }
    this.byFile = new Map(); // file -> token, to reuse a live one
    this.badges = new Map(); // app id -> count
  }

  /** The apps as the home screen shows them. */
  list() {
    return this.apps.list.map((a) => ({
      id: a.id,
      name: a.name,
      icon: a.icon ? `/apps/${a.id}/${a.icon}` : null,
      entry: `/apps/${a.id}/${a.entry}`,
      badge: this.badges.get(a.id) ?? 0,
    }));
  }

  /** The file and type behind a media address, while it lasts. */
  media(token) {
    const m = this.tokens.get(token);
    if (!m) return null;
    if (m.expires < Date.now()) {
      this.tokens.delete(token);
      this.byFile.delete(m.file);
      return null;
    }
    return m;
  }

  #mediaUrl(pkgId, rel) {
    const file = inside(join(this.dataRoot, pkgId), rel);
    const type = file && typeOf(file);
    if (!type || !type.startsWith('image/') || !existsSync(file)) return null;
    const now = Date.now();
    let token = this.byFile.get(file);
    const live = token && this.tokens.get(token);
    // A token with less than a quarter of its time left is not handed out again.
    if (!live || live.expires - now < this.mediaMs / 4) {
      token = randomBytes(18).toString('base64url');
      this.tokens.set(token, { file, type, expires: now + this.mediaMs });
      this.byFile.set(file, token);
    }
    if (this.tokens.size > 5000) for (const [t, m] of this.tokens) if (m.expires < now) this.tokens.delete(t);
    return `/media/${token}`;
  }

  // Swaps every { $media } in a package's answer for an address, or null.
  #withMedia(pkgId, value, depth = 0) {
    if (depth > 12 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => this.#withMedia(pkgId, v, depth + 1));
    if (typeof value.$media === 'string') {
      const url = this.#mediaUrl(pkgId, value.$media);
      return url ? { url } : null;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = this.#withMedia(pkgId, v, depth + 1);
    return out;
  }

  async #handle(pkgId) {
    let h = this.handles.get(pkgId);
    if (h) return h;
    h = await this.service.connect(pkgId);
    h.$on('mobile', (e) => this.#event(pkgId, e));
    this.handles.set(pkgId, h);
    return h;
  }

  // A package's event: to every screen with one of its apps open, or to the one it names.
  #event(pkgId, e) {
    if (!e || typeof e.event !== 'string') return;
    for (const app of this.apps.list.filter((a) => a.package === pkgId)) {
      // A badge goes on the app's icon, and to the app too, if it is open.
      if (e.event === 'badge') {
        this.badges.set(app.id, Math.max(0, Math.trunc(Number(e.data?.count) || 0)));
        for (const c of this.screens()) this.send(c, { t: 'apps', apps: this.list() });
      }
      for (const c of this.screens()) {
        if (c.openApp !== app.id || (e.screen && e.screen !== screenOf(c))) continue;
        this.send(c, { t: 'app-event', app: app.id, event: e.event, data: this.#withMedia(pkgId, e.data ?? null) });
      }
    }
  }

  /** Connects to every app's package, so badges arrive before an app is opened. */
  async start() {
    for (const app of this.apps.list) if (app.package) await this.#handle(app.package).catch(() => {});
  }

  /** One call from a screen: { t: 'app-call', id, app, call, args }. Answers with app-result. */
  async call(conn, msg) {
    const answer = (ok, payload) => this.send(conn, { t: 'app-result', id: msg.id, ...(ok ? { ok: true, value: payload } : { ok: false, error: payload }) });
    const app = this.apps.get(msg.app);
    if (!app) return answer(false, 'That app is not installed.');
    if (!app.package) return answer(false, `${app.name} has no package on the PC.`);
    if (typeof msg.call !== 'string' || !CALL.test(msg.call)) return answer(false, 'Not a call.');
    const args = Array.isArray(msg.args) ? msg.args : [];
    if (args.length > MAX_ARGS) return answer(false, 'Too many arguments.');
    conn.inFlight ??= 0;
    if (conn.inFlight >= MAX_IN_FLIGHT) return answer(false, 'Too many calls at once.');
    conn.inFlight++;
    try {
      const h = await this.#handle(app.package);
      const value = await h.$with({ timeoutMs: CALL_MS }).mobile({ app: app.id, screen: screenOf(conn), call: msg.call, args });
      answer(true, this.#withMedia(app.package, value ?? null));
    } catch (err) {
      this.handles.delete(app.package);
      const off = /not (installed|running|switched on)|no such package|unknown package|not found/i.test(err?.message ?? '');
      answer(false, off ? `${app.name} needs its REDnode package switched on in the Mod Manager.` : String(err?.message ?? err));
    } finally {
      conn.inFlight--;
    }
  }
}

/** 'game' for the phone in the game, 'phone' for a real phone. */
export const screenOf = (conn) => (conn.local ? 'game' : 'phone');
