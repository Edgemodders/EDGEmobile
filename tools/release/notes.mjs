// Prints the release notes for one version from its section of a changelog. The release
// workflow uses it for the GitHub release and the Nexus pages, and stops when the version has
// no section.
//
//   node tools/release/notes.mjs <version>                    EDGEmobile's notes, markdown for GitHub,
//                                                             with the install lines and Chooms!'s zip
//   node tools/release/notes.mjs <version> --changelog docs/chooms/changelog.md
//                                                             another changelog's section alone
//   --nexus                                                   plain lines for Nexus's changelog field
//   --out <file>                                              writes the notes to a file (UTF-8)
//
// Adapted from REDnode's tools/release/notes.mjs: this repo's changelogs group changes under
// "### New" headings, where REDnode's use "**New**" lines.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const nexus = args.includes('--nexus');
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
const logAt = args.indexOf('--changelog');
const changelog = logAt >= 0 ? args.splice(logAt, 2)[1].replace(/\\/g, '/') : 'docs/changelog.md';
const own = changelog === 'docs/changelog.md';
const version = args.find((a) => !a.startsWith('--'));
if (!version) {
  console.error('Give the version: node tools/release/notes.mjs <version>');
  process.exit(1);
}

const section = sectionOf(changelog, version);

if (nexus) {
  // Nexus's changelog takes one plain line per change: no markdown, links as "text (url)".
  const result = [];
  let group = '';
  for (const line of section) {
    const heading = line.match(/^###\s+(.+)$/) ?? line.match(/^\*\*(.+)\*\*$/);
    if (heading) group = heading[1].trim();
    else if (line.startsWith('- ')) result.push((group ? `${group}: ` : '') + plain(line.slice(2)));
    else if (line.trim()) result.push(plain(line.trim()));
  }
  write(result.join('\n'));
} else if (!own) {
  write(section.join('\n').trim());
} else {
  const chooms = JSON.parse(readFileSync(root + 'chooms/rednode/rednode-app.json', 'utf8'));
  const needs = (m) => m.requires.rednode.replace(/^>=\s*/, '');
  const phone = JSON.parse(readFileSync(root + 'edgephone/rednode-app.json', 'utf8'));
  write(`${section.join('\n').trim()}

**Install:** extract \`EDGEmobile-${version}.zip\` into the game folder, or add it to Vortex or EDGEdeck. It has EDGEmobile and EDGEphone, the phone in the game. Needs REDnode ${needs(phone)} or later (https://github.com/Edgemodders/REDnode/releases). Your phone reaches your PC through a private web address from Cloudflare, and only a phone that scans the QR code in the game and that you allow at the PC can connect. Docs: https://edgemodders.github.io/EDGEmobile/ (changelog: https://edgemodders.github.io/EDGEmobile/changelog.html)

**Also attached: Chooms! ${chooms.version}** (\`Chooms-${chooms.version}.zip\`), Night City's social feed for the phone. Extract it into the game folder after EDGEmobile; it needs REDnode ${needs(chooms)} or later. (changelog: https://edgemodders.github.io/EDGEmobile/chooms/changelog.html)`);
}

function sectionOf(file, v) {
  const lines = readFileSync(root + file, 'utf8').split(/\r?\n/);
  // "## 0.1.0" or "## 0.1.0 (2026-11-10)"
  const heading = new RegExp(`^## ${v.replace(/\./g, '\\.')}(\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) {
    console.error(`${file} has no section for ${v}: rename Unreleased to "## ${v} (date)" first`);
    process.exit(1);
  }
  let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  if (end < 0) end = lines.length;
  const s = lines.slice(start + 1, end);
  if (!s.some((line) => line.trim() && !line.startsWith('#'))) {
    console.error(`${file}: the section for ${v} is empty`);
    process.exit(1);
  }
  return s;
}

function plain(text) {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function write(text) {
  if (out) writeFileSync(out, text + '\n', 'utf8');
  else console.log(text);
}
