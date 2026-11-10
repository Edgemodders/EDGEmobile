// Makes Chooms!'s bundled pictures and places (chooms/rednode/content/) from your own: the
// portraits, body images and places you set in Chooms!'s settings window in the game.
//
//   node tools/chooms/export-content.mjs                    from your Chooms! data on this PC
//   node tools/chooms/export-content.mjs --data <folder>    from another Chooms! data folder
//   node tools/chooms/export-content.mjs --dry              says what it would do, writes nothing
//
// content/content.json lists each person's portrait, body image and places (each place's image,
// its line and its activities). The images sit beside it in content/people/<id>/, named by a
// hash of the image, so the same image keeps the same name. Images no longer listed are removed.
// Then check the changes with git and commit them: the release zip carries content/ as it is.
// Chooms! copies the pictures and places into a player's own folder the first time it starts
// (chooms/rednode/mod.mjs, "Bundled pictures and places").
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const dataAt = args.indexOf('--data');
const data = dataAt >= 0 ? args[dataAt + 1] : join(process.env.APPDATA ?? '', '@rednode', 'overlay', 'packages', 'chooms');
// --out: another folder than the package's content/, for tests.
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args[outAt + 1] : join(repo, 'chooms', 'rednode', 'content');
// Pictures picked since images are made smaller in the window are well under this.
const LARGE = 1.5 * 1024 * 1024;

const settingsFile = join(data, 'settings.json');
if (!existsSync(settingsFile)) {
  console.error(`No Chooms! settings at ${settingsFile}. Set pictures in Chooms!'s window in the game first, or give --data <folder>.`);
  process.exit(1);
}
const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
const roster = JSON.parse(readFileSync(join(repo, 'chooms', 'rednode', 'roster.json'), 'utf8')).accounts.filter((a) => a.kind !== 'corp');

const kept = new Set();
const warnings = [];
let bytes = 0;

// Copies one image into content/people/<id>/, named by its hash. Returns its path there.
function put(id, rel, what) {
  const src = join(data, rel);
  const buf = readFileSync(src);
  const ext = extname(rel).toLowerCase().replace('.jpeg', '.jpg');
  const name = `people/${id}/${createHash('sha256').update(buf).digest('hex').slice(0, 16)}${ext}`;
  kept.add(name);
  bytes += buf.length;
  if (buf.length > LARGE) warnings.push(`${what} is ${(buf.length / 1048576).toFixed(1)} MB, picked before the window made images smaller: choose it again there`);
  if (!dry && !existsSync(join(out, name))) {
    mkdirSync(dirname(join(out, name)), { recursive: true });
    copyFileSync(src, join(out, name));
  }
  return name;
}

const people = {};
const lines = [];
for (const a of roster) {
  const p = settings.people?.[a.id];
  const has = (rel) => typeof rel === 'string' && existsSync(join(data, rel));
  const entry = {};
  if (p && has(p.portrait)) entry.portrait = put(a.id, p.portrait, `${a.name}'s portrait`);
  if (p && has(p.body)) entry.body = put(a.id, p.body, `${a.name}'s body image`);
  const places = (p?.settings ?? []).filter((s) => has(s.file));
  if (places.length) {
    entry.places = places.map((s, i) => ({
      file: put(a.id, s.file, `${a.name}'s place ${i + 1}`),
      description: s.description ?? '',
      activities: s.activities ?? [],
    }));
    places.forEach((s, i) => !s.description && warnings.push(`${a.name}'s place ${i + 1} has no line describing it`));
  }
  const parts = [entry.portrait && 'portrait', entry.body && 'body', entry.places && `${entry.places.length} place${entry.places.length === 1 ? '' : 's'}`].filter(Boolean);
  lines.push(`  ${a.name}: ${parts.join(', ') || 'nothing yet'}`);
  if (parts.length) people[a.id] = entry;
}

// Images no longer listed go.
const removed = [];
const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])) : []);
for (const file of walk(join(out, 'people'))) {
  const rel = relative(out, file).split('\\').join('/');
  if (kept.has(rel)) continue;
  removed.push(rel);
  if (!dry) rmSync(file);
}
if (!dry) {
  for (const dir of existsSync(join(out, 'people')) ? readdirSync(join(out, 'people')) : []) {
    const at = join(out, 'people', dir);
    if (statSync(at).isDirectory() && !readdirSync(at).length) rmdirSync(at);
  }
  mkdirSync(out, { recursive: true });
  const json = {
    _about: "Chooms!'s bundled pictures and places, made by tools/chooms/export-content.mjs from the author's own. Chooms! copies them into a player's folder the first time it starts; the player can then change them.",
    people,
  };
  writeFileSync(join(out, 'content.json'), JSON.stringify(json, null, 2) + '\n');
}

console.log(`${dry ? 'Would write' : 'Wrote'} ${relative(repo, out)} from ${data}:`);
console.log(lines.join('\n'));
console.log(`${kept.size} images, ${(bytes / 1048576).toFixed(1)} MB${removed.length ? `; ${removed.length} no longer listed ${dry ? 'would be' : 'were'} removed` : ''}.`);
for (const w of warnings) console.log(`Note: ${w}.`);
