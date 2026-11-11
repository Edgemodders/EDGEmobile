// Runs every check outside the game, mode by mode, and adds up the results.
//   node tests/all.mjs              boot, apps, then full, relink and auto against real quick tunnels
//   node tests/all.mjs --offline    boot and apps only: no tunnel, no cloudflared, no internet
//   node tests/all.mjs apps boot    the modes named, in that order
// full leaves the tunnel's keeper running for relink, so those two run in this one command.
// Exits with 1 when a check fails or a mode stops early.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = join(dirname(fileURLToPath(import.meta.url)), 'run.mjs');
const args = process.argv.slice(2);
const named = args.filter((a) => !a.startsWith('--'));
const modes = named.length ? named : args.includes('--offline') ? ['boot', 'apps'] : ['boot', 'apps', 'full', 'relink', 'auto'];

const rows = [];
for (const mode of modes) {
  console.log(`\n=== ${mode} ===`);
  const t0 = Date.now();
  const { code, out } = await new Promise((resolve) => {
    let out = '';
    const p = spawn(process.execPath, [run, mode], { stdio: ['ignore', 'pipe', 'inherit'] });
    p.stdout.on('data', (d) => {
      out += d;
      process.stdout.write(d);
    });
    p.on('close', (code) => resolve({ code, out }));
  });
  const m = out.match(/(\d+)\/(\d+) passed\./g)?.pop()?.match(/(\d+)\/(\d+)/);
  rows.push({ mode, passed: m ? Number(m[1]) : 0, of: m ? Number(m[2]) : 0, code, s: Math.round((Date.now() - t0) / 1000) });
  // relink needs what full left; without it, there is nothing to relink to.
  if (mode === 'full' && code !== 0 && modes.includes('relink')) console.log('full did not pass: relink and auto may fail with it.');
}

console.log('\n| Mode | Passed | Time |\n|---|---|---|');
for (const r of rows) console.log(`| ${r.mode} | ${r.of ? `${r.passed}/${r.of}` : 'stopped early'}${r.code !== 0 && r.of && r.passed === r.of ? ' (exit ' + r.code + ')' : ''} | ${r.s} s |`);
const passed = rows.reduce((n, r) => n + r.passed, 0);
const of = rows.reduce((n, r) => n + r.of, 0);
const ok = rows.every((r) => r.code === 0 && r.of > 0);
console.log(`\n${passed}/${of} checks passed${ok ? '.' : ', with failures.'}`);
process.exit(ok ? 0 : 1);
