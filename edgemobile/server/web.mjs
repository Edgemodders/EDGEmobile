// EDGEmobile's web server, on 127.0.0.1 only. The tunnel brings the phone's requests here.
//
// Anyone may load the files below: the phone page's code and styles, with no game data in
// them. Everything else gets the same short "Not found." The WebSocket at /ws is the only
// way to game data, and phones.mjs decides who gets in. It opens only for the page's own
// origins: the tunnel's current address, or 127.0.0.1 for the in-game window.

import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';

const FILES = {
  '/': ['spike/phone.html', 'text/html; charset=utf-8'],
  '/phone.js': ['spike/phone.js', 'text/javascript; charset=utf-8'],
  '/theme/tokens.css': ['shell/theme/tokens.css', 'text/css; charset=utf-8'],
  '/theme/nc.css': ['shell/theme/nc.css', 'text/css; charset=utf-8'],
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Starts the server. `originOk(origin, viaTunnel)` says whether a WebSocket may open;
 * `onSocket(ws, info)` gets each one with { ua, viaTunnel, local }.
 */
export function startWeb({ dir, port, originOk, onSocket, log = console.log }) {
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
    const file = FILES[path];
    if (req.method !== 'GET' || !file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('Not found.');
    }
    try {
      const body = await readFile(join(dir, file[0]));
      res.writeHead(200, {
        'Content-Type': file[1],
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': CSP,
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
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, { ua: req.headers['user-agent'] ?? '', viaTunnel: tunnel, local: !tunnel }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
