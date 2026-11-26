// Prints the release notes for one version from its section of a changelog. The release
// workflow uses it for the GitHub release and the Nexus pages, and stops when the version has
// no section.
//
//   node tools/release/notes.mjs <version>                    EDGEmobile's notes, markdown for GitHub,
//                                                             with the install lines and Chooms!'s zip
//   node tools/release/notes.mjs <version> --changelog docs/chooms/changelog.md
//                                                             another changelog's section alone
//   --nexus                                                   the section's short Nexus summary (below)
//                                                             for Nexus's changelog field; stops when
//                                                             there is none or it breaks a rule
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

// The section for GitHub: without its Nexus summary (below).
const github = [];
for (let i = 0, inBlock = false; i < section.length; i++) {
  if (!inBlock && section[i].trim() === '<!-- nexus') inBlock = true;
  else if (inBlock && section[i].trim() === '-->') inBlock = false;
  else if (!inBlock) github.push(section[i]);
}

if (nexus) {
  // Nexus shows each line of a version's changelog as one entry, as plain text in a small field,
  // and cannot edit a changelog once posted, so its lines are a short summary written by hand
  // under the version's heading, not the section itself (EDGErepo's README, "Nexus changelogs"):
  //
  //   <!-- nexus
  //   New: Chooms!'s people post on their own, about what V has done
  //   Fixed: the settings window's dropdowns open in the game
  //   -->
  //
  // An HTML comment, so GitHub and the docs site show none of it. Each line starts with New:,
  // Changed:, Fixed:, Removed:, Other: or Needs:, has no markdown and at most NEXUS_LINE
  // characters; at most NEXUS_LINES lines, so with the "Full changelog" line added at the end
  // Nexus gets at most 13.
  const NEXUS_LINE = 120;
  const NEXUS_LINES = 12;
  const open = section.findIndex((line) => line.trim() === '<!-- nexus');
  const close = open < 0 ? -1 : section.findIndex((line, i) => i > open && line.trim() === '-->');
  if (open < 0 || close < 0) {
    console.error(`${changelog}: the section for ${version} has no Nexus summary. Add one under its heading:

<!-- nexus
New: one short line per change, at most ${NEXUS_LINE} characters
-->`);
    process.exit(1);
  }
  const summary = section.slice(open + 1, close).map((line) => line.trim()).filter(Boolean);
  const wrong = [];
  if (!summary.length) wrong.push('it is empty');
  if (summary.length > NEXUS_LINES) wrong.push(`${summary.length} lines, at most ${NEXUS_LINES}`);
  for (const line of summary) {
    if (!/^(New|Changed|Fixed|Removed|Other|Needs): \S/.test(line)) wrong.push(`"${line}" does not start with New:, Changed:, Fixed:, Removed:, Other: or Needs:`);
    if (line.length > NEXUS_LINE) wrong.push(`"${line.slice(0, 50)}..." is ${line.length} characters, at most ${NEXUS_LINE}`);
    if (/`|\*\*|\]\(/.test(line)) wrong.push(`"${line.slice(0, 50)}..." has markdown`);
  }
  if (wrong.length) {
    console.error(`${changelog}: the Nexus summary for ${version}:\n- ${wrong.join('\n- ')}`);
    process.exit(1);
  }
  const pages = 'https://edgemodders.github.io/EDGEmobile/';
  const full = own ? `${pages}changelog.html` : changelog === 'docs/chooms/changelog.md' ? `${pages}chooms/changelog.html` : `https://github.com/Edgemodders/EDGEmobile/blob/main/${changelog}`;
  write([...summary, `Full changelog: ${full}`].join('\n'));
} else if (!own) {
  write(github.join('\n').trim());
} else {
  const chooms = JSON.parse(readFileSync(root + 'chooms/rednode/rednode-app.json', 'utf8'));
  const needs = (m) => m.requires.rednode.replace(/^>=\s*/, '');
  const phone = JSON.parse(readFileSync(root + 'edgephone/rednode-app.json', 'utf8'));
  write(`${github.join('\n').trim()}

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

function write(text) {
  if (out) writeFileSync(out, text + '\n', 'utf8');
  else console.log(text);
}
