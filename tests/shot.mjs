// Screenshots a page with headless Chrome over the DevTools protocol, after running some script in it.
//   node tests/shot.mjs <url> <out.png> <width> <height> [script] [waitMs]
// Used by run.mjs's apps mode. The Chrome extension's screenshots time out on the author's PC, so
// this drives Chrome itself. A game window can be shot from its file:// path.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const WebSocket = createRequire(new URL('../edgemobile/package.json', import.meta.url))('ws');

const [url, out, w, h, script = '', waitMs = '2500'] = process.argv.slice(2);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`].find(existsSync);
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'em-shot-'))}`, `--window-size=${w},${h}`, '--hide-scrollbars', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let id = 0;
const call = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  const on = (d) => { const m = JSON.parse(d); if (m.id === n) { ws.off('message', on); resolve(m.result ?? m.error); } };
  ws.on('message', on);
  ws.send(JSON.stringify({ id: n, method, params }));
});
await call('Emulation.setDeviceMetricsOverride', { width: Number(w), height: Number(h), deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url });
await sleep(Number(waitMs));
if (script) {
  const r = await call('Runtime.evaluate', { expression: script, awaitPromise: true, returnByValue: true });
  console.log('script:', JSON.stringify(r?.result?.value ?? r));
  await sleep(1200);
}
const shot = await call('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved', out);
// SHOT_STEPS: [{ "click": [x, y], "wait": ms, "shot": "file.png" }, ...]: real mouse clicks, which
// reach into frames a script cannot, each followed by a screenshot if named.
for (const step of JSON.parse(process.env.SHOT_STEPS || '[]')) {
  if (step.click) {
    const [x, y] = step.click;
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  await sleep(step.wait ?? 1500);
  if (step.shot) {
    const s = await call('Page.captureScreenshot', { format: 'png' });
    const file = join(out, '..', step.shot);
    writeFileSync(file, Buffer.from(s.data, 'base64'));
    console.log('saved', file);
  }
}
ws.close();
proc.kill();
process.exit(0);
