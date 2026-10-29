// EDGEmobile's web server, on 127.0.0.1 only. The tunnel brings the phone's requests here.
//
// Anyone may load the files below: the phone page's code and styles, with no game data in
// them. Everything else gets the same short "Not found." The WebSocket at /ws is the only
// way to game data, and phones.mjs decides who gets in. It opens only for the page's own
// origins: the tunnel's current address, or 127.0.0.1 for the in-game window.

import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';

const FILES = {
  '/': ['shell/index.html', 'text/html; charset=utf-8'],
  '/phone.js': ['shell/phone.js', 'text/javascript; charset=utf-8'],
  '/theme/tokens.css': ['shell/theme/tokens.css', 'text/css; charset=utf-8'],
  '/theme/nc.css': ['shell/theme/nc.css', 'text/css; charset=utf-8'],
  '/theme/themes.css': ['shell/theme/themes.css', 'text/css; charset=utf-8'],
};
// The shipped fonts, their faces and their licences, by name.
const FONT_TYPES = { '.woff2': 'font/woff2', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

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

/**
 * Starts the server. `originOk(origin, viaTunnel)` says whether a WebSocket may open;
 * `onSocket(ws, info)` gets each one with { ua, origin, viaTunnel, local }. Through the tunnel
 * the page may be framed only by `loaderOrigin`. From 127.0.0.1, only by a file:// page: the
 * game's phone window (REDnode's app pages are file:// pages), never a website.
 */
export function startWeb({ dir, port, loaderOrigin, originOk, onSocket, log = console.log }) {
  const tunnelCsp = [...BASE_CSP, `frame-ancestors ${loaderOrigin}`].join('; ');
  const localCsp = [...BASE_CSP, 'frame-ancestors file:'].join('; ');
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
    const path = new URL(req.url, 'http://x').pathname;
    const file = files[path];
    if (req.method !== 'GET' || !file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('Not found.');
    }
    try {
      const body = await readFile(join(dir, file[0]));
      res.writeHead(200, {
        'Content-Type': file[1],
        // The fonts never change within a version; everything else is read fresh.
        'Cache-Control': file[1] === 'font/woff2' ? 'public, max-age=86400' : 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': viaTunnel(req) ? tunnelCsp : localCsp,
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found.');
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
