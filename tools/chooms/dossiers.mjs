// Chooms!'s dossiers: the pictures and places Chooms! ships for each person, kept in the repo as
// plain files (chooms/dossiers/README.md says how to fill them).
//
//   node tools/chooms/dossiers.mjs            checks the dossiers, shrinks big images in place,
//                                             and brings each README's checklist up to date
//   node tools/chooms/dossiers.mjs --build    also writes chooms/rednode/content/ (content.json
//                                             and the images), which Chooms! reads; git ignores it
//   --dossiers <folder>   other dossiers than chooms/dossiers (tests)
//   --out <folder>        with --build: another folder than chooms/rednode/content (the release zip)
//   --dry                 says what it would do, writes nothing
//
// A dossier is chooms/dossiers/<id>/, <id> an account in chooms/rednode/roster.json:
//   portrait.<png|jpg|jpeg|webp>   their face (their picture in the app); for a corporation or a
//                                  gang, its profile picture, the only image it has
//   body.<...>                     head to toe, for photos of them doing something
//   places/<name>.<...>            a place, with places/<name>.md beside it:
//                                    # The place, in one line
//                                    - something they might do there
//                                    - one per line
// An image is kept at most 1440 pixels on its longest side, as WebP, as Chooms!'s settings
// window keeps a picked one: a bigger image, or one that is not WebP, is made so (in place,
// or only in content/ with --build). A place's .md with no image yet is a place still to take.
// content/ names each image by a hash of it, so the same image keeps the same name, and a place
// a player already has is not added twice (chooms/rednode/mod.mjs, "Bundled pictures and places").
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const repo = join(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const dry = args.includes('--dry');
const build = args.includes('--build');
const root = opt('--dossiers') ?? join(repo, 'chooms', 'dossiers');
const out = opt('--out') ?? join(repo, 'chooms', 'rednode', 'content');

const MAX_SIDE = 1440;
const QUALITY = 90; // the settings window's toDataURL('image/webp', 0.9)
const IMAGE = /\.(png|jpe?g|webp)$/i;

// sharp is the tools' own library (tools/chooms/package.json), installed on first use.
async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    console.log('Installing the tools\' image library (sharp) in tools/chooms ...');
    const npm = spawnSync('npm ci --no-audit --no-fund', { cwd: HERE, stdio: 'inherit', shell: true });
    if (npm.status !== 0) throw new Error('npm ci failed in tools/chooms');
    return (await import('sharp')).default;
  }
}
const sharp = await loadSharp();

const roster = JSON.parse(readFileSync(join(repo, 'chooms', 'rednode', 'roster.json'), 'utf8')).accounts;
const isOrg = (a) => a.kind === 'corp' || a.kind === 'gang';
const errors = [];
const notes = [];
const rel = (p) => relative(root, p).split('\\').join('/');
const images = (dir, base) => (existsSync(dir) ? readdirSync(dir).filter((f) => IMAGE.test(f) && (!base || f.slice(0, -extname(f).length) === base)) : []);

// What an image needs: nothing, or to be made a WebP at most MAX_SIDE across.
async function needsWork(file) {
  const m = await sharp(file).metadata();
  return m.format !== 'webp' || Math.max(m.width, m.height) > MAX_SIDE;
}
async function toWebp(file) {
  return sharp(file).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).webp({ quality: QUALITY }).toBuffer();
}

// Reads a place's .md: the first line (# ...) is the place, each line after it an activity.
function readPlace(md) {
  const lines = readFileSync(md, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const head = lines.shift() ?? '';
  if (!head.startsWith('#')) errors.push(`${rel(md)}: the first line must be the place, as "# The place"`);
  return {
    description: head.replace(/^#+\s*/, ''),
    activities: lines.filter((l) => !l.startsWith('<!--')).map((l) => l.replace(/^[-*]\s*/, '')).filter(Boolean),
  };
}

// --- Each dossier -------------------------------------------------------------------------------
const ids = new Set(roster.map((a) => a.id));
for (const d of existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []) {
  if (d.isDirectory() && !ids.has(d.name)) errors.push(`${d.name}/: no one in the roster has this id (chooms/rednode/roster.json)`);
}

const people = {};
const writes = new Map(); // content/'s images, written at the end when nothing is wrong
const rows = [];
const orgRows = [];
let shrunk = 0;
for (const a of roster) {
  const dir = join(root, a.id);
  if (!existsSync(dir) && !dry) mkdirSync(isOrg(a) ? dir : join(dir, 'places'), { recursive: true });
  const status = { portrait: null, body: null, places: [], toTake: [] };

  // Shrinks an image in place (not with --build, which leaves the dossiers as they are).
  const prepare = async (file) => {
    if (build || dry || !(await needsWork(file))) return file;
    const m = await sharp(file).metadata();
    const webp = await toWebp(file);
    const to = file.slice(0, -extname(file).length) + '.webp';
    const was = statSync(file).size;
    writeFileSync(to, webp);
    if (to !== file) rmSync(file);
    shrunk++;
    const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
    notes.push(`${rel(file)}: made a WebP${Math.max(m.width, m.height) > MAX_SIDE ? ` ${MAX_SIDE} pixels across` : ''} (${mb(was)} to ${mb(webp.length)})`);
    return to;
  };

  for (const kind of ['portrait', 'body']) {
    const found = images(dir, kind);
    if (found.length > 1) errors.push(`${a.id}/: ${found.length} ${kind} images (${found.join(', ')}); keep one`);
    else if (found.length) status[kind] = await prepare(join(dir, found[0]));
  }
  const placesDir = join(dir, 'places');
  const files = existsSync(placesDir) ? readdirSync(placesDir).sort() : [];
  const names = [...new Set(files.filter((f) => IMAGE.test(f) || f.endsWith('.md')).map((f) => f.slice(0, -extname(f).length)))];
  for (const name of names) {
    const imgs = images(placesDir, name);
    const md = join(placesDir, `${name}.md`);
    if (imgs.length > 1) errors.push(`${a.id}/places/: ${imgs.length} images named ${name} (${imgs.join(', ')}); keep one`);
    else if (imgs.length && !existsSync(md)) errors.push(`${a.id}/places/${imgs[0]}: no ${name}.md beside it (the place, then what they might do there)`);
    else if (!imgs.length) status.toTake.push({ name, ...readPlace(md) });
    else status.places.push({ name, file: await prepare(join(placesDir, imgs[0])), ...readPlace(md) });
  }
  for (const p of status.places) if (!p.description) errors.push(`${a.id}/places/${p.name}.md: no line describing the place`);
  if (isOrg(a) && (status.body || names.length)) errors.push(`${a.id}/: a ${a.kind === 'gang' ? 'gang' : 'corporation'} has only a profile picture (portrait.png); no body image or places`);

  // content/: the images by their hash, and the lines.
  if (build) {
    const entry = {};
    const put = async (file) => {
      const work = await needsWork(file);
      const buf = work ? await toWebp(file) : readFileSync(file);
      const ext = work ? '.webp' : extname(file).toLowerCase().replace('.jpeg', '.jpg');
      const name = `people/${a.id}/${createHash('sha256').update(buf).digest('hex').slice(0, 16)}${ext}`;
      writes.set(name, buf);
      return name;
    };
    if (status.portrait) entry.portrait = await put(status.portrait);
    if (status.body) entry.body = await put(status.body);
    if (status.places.length) entry.places = await Promise.all(status.places.map(async (p) => ({ file: await put(p.file), description: p.description, activities: p.activities })));
    if (Object.keys(entry).length) people[a.id] = entry;
  }

  // The dossier's README: written once, then only its checklist is brought up to date.
  const readme = join(dir, 'README.md');
  const check = isOrg(a) ? [
    '<!-- checklist: written by tools/chooms/dossiers.mjs -->',
    '## Checklist',
    '',
    `- [${status.portrait ? 'x' : ' '}] Profile picture${status.portrait ? `: \`${rel(status.portrait).split('/').pop()}\`` : ' (`portrait.png`)'}`,
    '<!-- /checklist -->',
  ].join('\n') : [
    '<!-- checklist: written by tools/chooms/dossiers.mjs -->',
    '## Checklist',
    '',
    `- [${status.portrait ? 'x' : ' '}] Portrait${status.portrait ? `: \`${rel(status.portrait).split('/').pop()}\`` : ' (`portrait.png`)'}`,
    `- [${status.body ? 'x' : ' '}] Body${status.body ? `: \`${rel(status.body).split('/').pop()}\`` : ' (`body.png`)'}`,
    ...status.places.map((p) => `- [x] Place: ${p.description} (\`places/${p.file.split(/[\\/]/).pop()}\`)`),
    ...status.toTake.map((p) => `- [ ] Place: ${p.description || p.name} (\`places/${p.name}.png\`)`),
    '<!-- /checklist -->',
  ].join('\n');
  const text = existsSync(readme)
    ? readFileSync(readme, 'utf8')
    : isOrg(a)
    ? `# ${a.name}\n\n${a.tag ?? ''}${a.districts?.length ? ` in ${a.districts.join(', ')}` : ''}. ${a.bio ?? ''}\n\n- **Profile picture:** ${a.name}'s picture in the app, beside each of its posts and on its profile, shown in a circle. ${a.kind === 'gang' ? 'Their tag or graffiti on a wall, or one of their own in their colours' : 'Its logo on a building, a sign or a screen'}, from photo mode, filling a square. Save it here as \`portrait.png\`.\n\nA ${a.kind === 'gang' ? 'gang' : 'corporation'} has no body image or places: its posts are text.\n\n<!-- checklist --><!-- /checklist -->\n`
    : `# ${a.name}\n\n${a.tag ? `${a.tag}, ` : ''}${a.home ?? ''}. ${a.bio ?? ''}\n\n- **Portrait:** ${a.name}'s face, shoulders up, in good light. It is their picture in the app.\n- **Body:** ${a.name} head to toe, standing, on a plain background if you can. Used for photos of them doing something.\n- **Places:** where photos of them are taken. Each is an image in \`places/\` with a \`.md\` of the same name beside it.\n\n<!-- checklist --><!-- /checklist -->\n`;
  const next = text.replace(/<!-- checklist[^>]*-->[\s\S]*?<!-- \/checklist -->/, check);
  if (!dry && next !== text) writeFileSync(readme, next);
  if (isOrg(a)) orgRows.push(`| [${a.name}](${a.id}/README.md) | ${a.kind === 'gang' ? 'Gang' : 'Corporation'} | ${status.portrait ? 'yes' : '—'} |`);
  else rows.push(`| [${a.name}](${a.id}/README.md) | ${status.portrait ? 'yes' : '—'} | ${status.body ? 'yes' : '—'} | ${status.places.length} | ${status.toTake.length} |`);
}

// The index's table.
const index = join(root, 'README.md');
if (existsSync(index) && !dry) {
  const table = ['<!-- table: written by tools/chooms/dossiers.mjs -->', '| Person | Portrait | Body | Places | To take |', '|---|---|---|---|---|', ...rows, '<!-- /table -->'].join('\n');
  const text = readFileSync(index, 'utf8');
  const orgTable = ['<!-- orgs: written by tools/chooms/dossiers.mjs -->', '| Account | Kind | Profile picture |', '|---|---|---|', ...orgRows, '<!-- /orgs -->'].join('\n');
  const next = text.replace(/<!-- table[^>]*-->[\s\S]*?<!-- \/table -->/, table).replace(/<!-- orgs[^>]*-->[\s\S]*?<!-- \/orgs -->/, orgTable);
  if (next !== text) writeFileSync(index, next);
}

// content/, made afresh: content.json and the images it lists, nothing else.
if (build && !errors.length && !dry) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const [name, buf] of writes) {
    mkdirSync(dirname(join(out, name)), { recursive: true });
    writeFileSync(join(out, name), buf);
  }
  const json = {
    _about: "Chooms!'s bundled pictures and places, built by tools/chooms/dossiers.mjs from chooms/dossiers/. Chooms! copies them into a player's folder the first time it starts; the player can then change them.",
    people,
  };
  writeFileSync(join(out, 'content.json'), JSON.stringify(json, null, 2) + '\n');
}

// --- Report -------------------------------------------------------------------------------------
for (const n of notes) console.log(n);
if (errors.length) {
  for (const e of errors) console.error(`Error: ${e}`);
  console.error(`${errors.length} problem${errors.length === 1 ? '' : 's'} in ${root}; nothing was built.`);
  process.exit(1);
}
const count = Object.values(people).reduce((n, e) => n + !!e.portrait + !!e.body + (e.places?.length ?? 0), 0);
console.log(`${roster.length} dossiers checked (${orgRows.length} corporations and gangs)${shrunk ? `, ${shrunk} image${shrunk === 1 ? '' : 's'} shrunk` : ''}.${build ? ` ${count} image${count === 1 ? '' : 's'} for ${Object.keys(people).length} account${Object.keys(people).length === 1 ? '' : 's'}.` : ''}`);
