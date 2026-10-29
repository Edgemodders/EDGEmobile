// Pairing and sessions (docs/design.md, "Pairing and security").
//
// A phone gets in only with both: the QR code's one-time key (128 random bits, one use, about
// a minute), and the player's Allow in the game after comparing pairing codes. A paired phone
// gets a 256-bit session key; phones.json keeps only its SHA-256. One pairing waits at a time.
// Every refusal looks the same and comes after a pause.
//
// M1 spike: no reconnect by scan after a restart yet, and the in-game window gets a local
// session for this run only.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY_MS = 60000;
const DECIDE_MS = 60000;
const REFUSE_PAUSE_MS = 1000;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** "Chrome 131 on Android 14" from a user agent. */
export function phoneName(ua = '') {
  const os = /Android [\d.]+/.exec(ua)?.[0] ?? /iPhone|iPad/.exec(ua)?.[0] ?? /Windows|Mac OS X|Linux/.exec(ua)?.[0] ?? 'an unknown system';
  const names = { Version: 'Safari', CriOS: 'Chrome', EdgA: 'Edge', Edg: 'Edge', SamsungBrowser: 'Samsung Internet', FxiOS: 'Firefox' };
  const b = /(SamsungBrowser|FxiOS|Firefox|EdgA|Edg|CriOS|Chrome|Version)\/(\d+)/.exec(ua);
  return `${b ? `${names[b[1]] ?? b[1]} ${b[2]}` : 'A browser'} on ${os}`;
}

export class Phones {
  constructor({ dataDir, onChange }) {
    this.file = join(dataDir, 'phones.json');
    this.onChange = onChange;
    this.key = null; // { value, expires }
    this.pending = null; // { code, name, decide }
    this.local = new Set(); // hashes of this run's local sessions
    try {
      this.saved = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      this.saved = [];
    }
  }

  /** A new one-time key for the QR code. The old one stops working. */
  newKey() {
    this.key = { value: randomBytes(16).toString('base64url'), expires: Date.now() + KEY_MS };
    return this.key;
  }

  /** A session for the in-game window, through 127.0.0.1 only, for this run. */
  localSession() {
    const session = randomBytes(32).toString('base64url');
    this.local.add(sha(session));
    return session;
  }

  /**
   * Answers a phone's first message. `send` talks to it. Resolves with
   * { id, name, local } once it is in, or null after sending the refusal.
   */
  async hello(msg, { ua, local, send }) {
    if (typeof msg?.session === 'string') {
      const hash = sha(msg.session);
      if (local && this.local.has(hash)) return { id: 'local', name: 'This PC (in the game)', local: true };
      const phone = this.saved.find((p) => same(p.hash, hash));
      if (phone) {
        phone.lastSeen = new Date().toISOString();
        this.#save();
        return { id: phone.id, name: phone.name, local: false };
      }
      return this.#refuse(send);
    }
    if (typeof msg?.key !== 'string' || !this.key || Date.now() > this.key.expires || !same(msg.key, this.key.value) || this.pending) {
      return this.#refuse(send);
    }
    this.key = null; // used once
    const name = phoneName(ua);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    send({ t: 'code', code });
    const allowed = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), DECIDE_MS);
      this.pending = {
        code,
        name,
        decide: (yes) => {
          clearTimeout(timer);
          resolve(yes);
        },
      };
      this.onChange();
    });
    this.pending = null;
    this.onChange();
    if (!allowed) return this.#refuse(send, 0);
    const session = randomBytes(32).toString('base64url');
    const phone = { id: randomBytes(6).toString('hex'), name, hash: sha(session), pairedAt: new Date().toISOString(), lastSeen: new Date().toISOString() };
    this.saved.push(phone);
    this.#save();
    send({ t: 'welcome', session, id: phone.id });
    return { id: phone.id, name, local: false };
  }

  /** The player's Allow or Deny for the waiting phone. */
  decide(yes) {
    this.pending?.decide(yes);
  }

  /** Called when the waiting phone goes away before a decision. */
  gone() {
    this.pending?.decide(false);
  }

  remove(id) {
    this.saved = this.saved.filter((p) => p.id !== id);
    this.#save();
  }

  async #refuse(send, pause = REFUSE_PAUSE_MS) {
    if (pause) await new Promise((r) => setTimeout(r, pause));
    send({ t: 'refused' });
    return null;
  }

  #save() {
    writeFileSync(this.file, JSON.stringify(this.saved, null, 2));
  }
}
