// EDGEmobile's web server, on 127.0.0.1 only. The tunnel brings the phone's requests here.
//
// Anyone may load the files below: the phone page's code and styles, with no game data in
// them, and the installed mobile apps' own files (/apps/<id>/...), which are code too.
// Everything else gets the same short "Not found." The WebSocket at /ws is the only way to
// game data, and phones.mjs decides who gets in. It opens only for the page's own origins: the
// tunnel's current address, or 127.0.0.1 for the in-game window. An image from an app's
// package is served only at a /media/<token> address the mod hands to a signed-in screen.

import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { inside } from './apps.mjs';

const FILES = {
  '/': ['shell/index.html', 'text/html; charset=utf-8'],
  '/phone.js': ['shell/phone.js', 'text/javascript; charset=utf-8'],
  '/mobile.js': ['shell/mobile.js', 'text/javascript; charset=utf-8'],
  '/theme/tokens.css': ['shell/theme/tokens.css', 'text/css; charset=utf-8'],
  '/theme/nc.css': ['shell/theme/nc.css', 'text/css; charset=utf-8'],
  '/theme/themes.css': ['shell/theme/themes.css', 'text/css; charset=utf-8'],
};
// The shipped fonts, their faces and their licences, by name.
const FONT_TYPES = { '.woff2': 'font/woff2', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
// What an app's folder, and a media address, may serve, by extension.
export const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
};
export const typeOf = (name) => TYPES[name.slice(name.lastIndexOf('.')).toLowerCase()] ?? null;

const BASE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
];

// An app's page runs in a sandboxed frame inside the shell: an origin of its own, so it cannot
// read the shell's session or the loader's key. The same rule comes with the page itself, so it
// is sandboxed even when opened on its own. It may load its own files and the shell's styles
// and fonts, and fetch nothing: its calls go through the shell (shell/mobile.js). A sandboxed
// page's origin is opaque, so the server's own address is named as well as 'self'.
function appCsp(own, ancestors) {
  return [
    "default-src 'none'",
    `script-src 'self' ${own}`,
    `style-src 'self' ${own} 'unsafe-inline'`,
    `font-src 'self' ${own}`,
    `img-src 'self' ${own} data: blob:`,
    `media-src 'self' ${own} blob:`,
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    'sandbox allow-scripts allow-forms',
    `frame-ancestors 'self' ${own} ${ancestors}`,
  ].join('; ');
}

/**
 * Starts the server. `originOk(origin, viaTunnel)` says whether a WebSocket may open;
 * `onSocket(ws, info)` gets each one with { ua, origin, viaTunnel, local }. Through the tunnel
 * the page may be framed only by `loaderOrigin`. From 127.0.0.1, only by a file:// page: the
 * game's phone window (REDnode's app pages are file:// pages), never a website.
 * `appsDir` holds the mobile apps and `appIds()` names the installed ones; `tunnelOrigin()` is
 * the tunnel's current address; `media(token)` gives { file, type } behind a media address,
 * or null.
 */
export function startWeb({ dir, port, loaderOrigin, originOk, onSocket, appsDir, appIds = () => [], tunnelOrigin = () => null, media = () => null, log = console.log }) {
  const tunnelCsp = [...BASE_CSP, `frame-ancestors ${loaderOrigin}`].join('; ');
  const localCsp = [...BASE_CSP, 'frame-ancestors file:'].join('; ');
  const localOrigin = `http://127.0.0.1:${port}`;
  const files = { ...FILES };
  for (const name of readdirSync(join(dir, 'shell', 'fonts'))) {
    const type = FONT_TYPES[name.slice(name.lastIndexOf('.'))];
    if (type && /^[A-Za-z0-9.-]+$/.test(name)) files[`/fonts/${name}`] = [`shell/fonts/${name}`, type];
  }
  let firstTunnelRequest = true;
  // Requests through the tunnel come from cloudflared on this PC too, so the address cannot
  // tell them apart. Cloudflare adds its own headers to each one, and a phone cannot remove them.
  const viaTunnel = (req) => 'cf-ray' in req.headers || 'cf-connecting-ip' in req.headers;

  const server = http.createServer(async (req, res) => {
    if (firstTunnelRequest && viaTunnel(req)) {
      firstTunnelRequest = false;
      log(`Web: first request through the tunnel; Cloudflare's headers: ${Object.keys(req.headers).filter((h) => h.startsWith('cf-')).join(', ')}`);
    }
    const notFound = () => {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not found.');
    };
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return notFound();
    }
    if (req.method !== 'GET') return notFound();
    const tunnel = viaTunnel(req);
    // Which file, its type, and the rules it is served with.
    let full = null;
    let type = null;
    let csp = tunnel ? tunnelCsp : localCsp;
    let cache = 'no-store';
    if (files[path]) {
      full = join(dir, files[path][0]);
      type = files[path][1];
    } else if (path.startsWith('/apps/')) {
      const [, , id, ...rest] = path.split('/');
      const own = tunnel ? tunnelOrigin() : localOrigin;
      if (!own || !appIds().includes(id)) return notFound();
      full = inside(join(appsDir, id), rest.join('/'));
      type = full && typeOf(full);
      csp = appCsp(own, tunnel ? loaderOrigin : 'file:');
    } else if (path.startsWith('/media/')) {
      const found = media(path.slice('/media/'.length));
      if (found) ({ file: full, type } = found);
      cache = 'private, max-age=3600';
    }
    if (!full || !type) return notFound();
    try {
      const body = await readFile(full);
      res.writeHead(200, {
        'Content-Type': type,
        // The fonts never change within a version, nor does the image behind a media address;
        // everything else is read fresh.
        'Cache-Control': type === 'font/woff2' ? 'public, max-age=86400' : cache,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': csp,
        // Fonts load with CORS, and an app's page has an opaque origin. They are public files.
        ...(type === 'font/woff2' ? { 'Access-Control-Allow-Origin': '*' } : {}),
      });
      res.end(body);
    } catch {
      notFound();
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url, 'http://x').pathname;
    const tunnel = viaTunnel(req);
    if (path !== '/ws' || !originOk(req.headers.origin ?? '', tunnel)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, { ua: req.headers['user-agent'] ?? '', origin: req.headers.origin, viaTunnel: tunnel, local: !tunnel }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
