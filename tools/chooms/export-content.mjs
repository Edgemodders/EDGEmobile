// Copies the pictures and places you set in Chooms!'s settings window in the game into the
// dossiers (chooms/dossiers/<id>/), the files Chooms!'s bundled pictures and places are built
// from (tools/chooms/dossiers.mjs). The other way to fill them is to drop files in by hand.
//
//   node tools/chooms/export-content.mjs                    from your Chooms! data on this PC
//   node tools/chooms/export-content.mjs --data <folder>    from another Chooms! data folder
//   node tools/chooms/export-content.mjs --out <folder>     into other dossiers (tests)
//   node tools/chooms/export-content.mjs --dry              says what it would do, writes nothing
//
// Each person's portrait and body image replace the dossier's. Each place becomes
// places/<name>.<ext> with places/<name>.md beside it, <name> made from its line; a place of the
// same name is replaced. Nothing else in a dossier is removed. Then run dossiers.mjs, check the
// changes with git and commit them.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const dry = args.includes('--dry');
const data = opt('--data') ?? join(process.env.APPDATA ?? '', '@rednode', 'overlay', 'packages', 'chooms');
const out = opt('--out') ?? join(repo, 'chooms', 'dossiers');
const IMAGE = /\.(png|jpe?g|webp)$/i;

const settingsFile = join(data, 'settings.json');
if (!existsSync(settingsFile)) {
  console.error(`No Chooms! settings at ${settingsFile}. Set pictures in Chooms!'s window in the game first, or give --data <folder>.`);
  process.exit(1);
}
const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
const roster = JSON.parse(readFileSync(join(repo, 'chooms', 'rednode', 'roster.json'), 'utf8')).accounts.filter((a) => a.kind !== 'corp');

// "The Aldecaldos camp" -> "the-aldecaldos-camp".
const slug = (s) => String(s ?? '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 48) || 'place';

// Copies one image to <dir>/<base><ext>, removing the same name with another extension.
function put(src, dir, base) {
  const ext = extname(src).toLowerCase().replace('.jpeg', '.jpg');
  if (dry) return;
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (IMAGE.test(f) && f.slice(0, -extname(f).length) === base && extname(f).toLowerCase() !== ext) rmSync(join(dir, f));
  copyFileSync(src, join(dir, base + ext));
}

const lines = [];
for (const a of roster) {
  const p = settings.people?.[a.id];
  const has = (r) => typeof r === 'string' && existsSync(join(data, r));
  const dir = join(out, a.id);
  const parts = [];
  if (p && has(p.portrait)) (put(join(data, p.portrait), dir, 'portrait'), parts.push('portrait'));
  if (p && has(p.body)) (put(join(data, p.body), dir, 'body'), parts.push('body'));
  const used = new Set();
  for (const s of (p?.settings ?? []).filter((x) => has(x.file))) {
    let name = slug(s.description);
    for (let i = 2; used.has(name); i++) name = `${slug(s.description)}-${i}`;
    used.add(name);
    put(join(data, s.file), join(dir, 'places'), name);
    const acts = Array.isArray(s.activities) ? s.activities : String(s.activities ?? '').split('\n');
    if (!dry) writeFileSync(join(dir, 'places', `${name}.md`), [`# ${s.description || name}`, ...acts.map((x) => String(x).trim()).filter(Boolean).map((x) => `- ${x}`)].join('\n') + '\n');
    parts.push(`places/${name}`);
  }
  if (parts.length) lines.push(`  ${a.name}: ${parts.join(', ')}`);
}

console.log(`${dry ? 'Would copy' : 'Copied'} into ${relative(repo, out) || out} from ${data}:`);
console.log(lines.length ? lines.join('\n') : '  nothing: no pictures or places are set in the window');
console.log('Next: node tools/chooms/dossiers.mjs, then check the changes with git and commit them.');
