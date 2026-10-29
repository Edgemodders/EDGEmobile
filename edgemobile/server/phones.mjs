// Pairing, and how a paired phone proves itself (docs/design.md, "Pairing and security" and
// "M2 plan").
//
// A new phone gets in only with both: the QR code's one-time key (128 random bits, one use,
// about a minute), and the player's Allow in the game after comparing pairing codes. One pairing
// waits at a time. Every refusal looks the same and comes after a pause.
//
// A phone proves itself with an ECDSA P-256 key pair its browser keeps and will not give out
// (the loader's, or the page's own without the loader). On each connection the PC sends a fresh
// challenge; the phone signs "edgemobile-auth", the origin it is talking to, and the challenge.
// phones.json keeps only public keys, so a copy of it lets no one in. A paired phone that signs
// is in, with no key and no Allow: after a game restart, one scan of the new QR code is enough.
//
// The in-game window gets a local session for this run, through 127.0.0.1 only.

import { createHash, createPublicKey, randomBytes, randomInt, timingSafeEqual, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY_MS = 60000;
const DECIDE_MS = 60000;
const REFUSE_PAUSE_MS = 1000;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const B64URL_32 = /^[A-Za-z0-9_-]{43}$/; // 32 bytes

/** "Chrome 131 on Android 14" from a user agent. */
export function phoneName(ua = '') {
  const os = /Android [\d.]+/.exec(ua)?.[0] ?? /iPhone|iPad/.exec(ua)?.[0] ?? /Windows|Mac OS X|Linux/.exec(ua)?.[0] ?? 'an unknown system';
  const names = { Version: 'Safari', CriOS: 'Chrome', EdgA: 'Edge', Edg: 'Edge', SamsungBrowser: 'Samsung Internet', FxiOS: 'Firefox' };
  const b = /(SamsungBrowser|FxiOS|Firefox|EdgA|Edg|CriOS|Chrome|Version)\/(\d+)/.exec(ua);
  return `${b ? `${names[b[1]] ?? b[1]} ${b[2]}` : 'A browser'} on ${os}`;
}

/** A P-256 public key as JWK, with only its four public fields, or null. */
export function publicJwk(jwk) {
  if (jwk?.kty !== 'EC' || jwk.crv !== 'P-256' || !B64URL_32.test(jwk.x ?? '') || !B64URL_32.test(jwk.y ?? '')) return null;
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

/** The key's RFC 7638 thumbprint: the phone's lasting identity. */
export function thumbprint(jwk) {
  return createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('base64url');
}

/** What a phone signs: bound to the origin it talks to, so a signature for one site is worthless at another. */
export function signedText(origin, challenge) {
  return `edgemobile-auth\n${origin}\n${challenge}`;
}

function signatureOk(jwk, origin, challenge, sig) {
  if (typeof sig !== 'string' || sig.length > 200) return false;
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    // WebCrypto signs ECDSA as raw r || s (IEEE P1363), not DER.
    return verify('sha256', Buffer.from(signedText(origin, challenge)), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  } catch {
    return false; // not a point on the curve, or not a signature
  }
}

export class Phones {
  constructor({ dataDir, onChange, log = console.log }) {
    this.file = join(dataDir, 'phones.json');
    this.onChange = onChange;
    this.key = null; // { value, expires }
    this.pending = null; // { code, name, decide }
    this.local = new Set(); // hashes of this run's local sessions
    let saved = [];
    try {
      saved = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      // none yet
    }
    // M1 kept session hashes; those phones pair once more.
    this.saved = saved.filter((p) => p.thumb && publicJwk(p.jwk));
    if (this.saved.length !== saved.length) {
      log(`Pairing: ${saved.length - this.saved.length} phone(s) from EDGEmobile 0.0.2 must pair again`);
      this.#save();
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

  /** A fresh challenge for one connection. */
  challenge() {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Answers a phone's first message. `origin` is the connection's own (checked by the web
   * server), `challenge` the one sent on it, `send` talks to it. Resolves with
   * { id, name, local } once it is in, or null after sending the refusal.
   */
  async hello(msg, { ua, local, origin, challenge, send }) {
    if (typeof msg?.session === 'string') {
      if (local && this.local.has(sha(msg.session))) return { id: 'local', name: 'This PC (in the game)', local: true };
      return this.#refuse(send);
    }
    const jwk = publicJwk(msg?.pub);
    if (!jwk || !signatureOk(jwk, origin, challenge, msg.sig)) return this.#refuse(send);
    const thumb = thumbprint(jwk);

    const known = this.saved.find((p) => p.thumb === thumb);
    if (known) {
      known.lastSeen = new Date().toISOString();
      this.#save();
      return { id: known.id, name: known.name, local: false };
    }

    if (typeof msg.key !== 'string' || !this.key || Date.now() > this.key.expires || !same(msg.key, this.key.value) || this.pending) {
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
    const now = new Date().toISOString();
    const phone = { id: randomBytes(6).toString('hex'), name, thumb, jwk, pairedAt: now, lastSeen: now };
    this.saved.push(phone);
    this.#save();
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
