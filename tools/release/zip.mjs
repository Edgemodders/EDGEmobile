// Builds the release zips for GitHub and Nexus Mods, laid out like the game folder so Vortex, a
// mod manager's download button or a player extracting by hand puts them in the same place.
// Nothing is compiled: the zips hold the packages as they are in the repo, with EDGEmobile's
// libraries installed fresh.
//
//   node tools/release/zip.mjs                  both zips
//   node tools/release/zip.mjs edgemobile       one of them: edgemobile or chooms
//   node tools/release/zip.mjs --draft          without the changelog checks, for a test build
//
// Output, in release/ (not committed):
//   EDGEmobile-<version>.zip    red4ext/plugins/REDnode/apps/edgemobile/   the server, the OS, the Connect window
//                               red4ext/plugins/REDnode/apps/edgephone/    the phone in the game, bundled
//   Chooms-<version>.zip        red4ext/plugins/REDnode/apps/chooms/       Chooms!'s package
//                               red4ext/plugins/REDnode/mobile-apps/chooms/ Chooms!'s mobile app
// Each folder gets the repo's LICENSE as LICENSE.txt.
//
// EDGEphone keeps EDGEmobile's version. Chooms! has its own, in both its manifests. A release
// needs a section "## <version> (<date>)" in the zip's changelog and nothing under Unreleased.
import { spawnSync } from 'node:child_process';
import { cpSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const draft = args.includes('--draft');
const json = (rel) => JSON.parse(readFileSync(join(repo, rel), 'utf8'));

const ZIPS = {
  edgemobile: {
    name: 'EDGEmobile',
    version: json('edgemobile/rednode-app.json').version,
    changelog: 'docs/changelog.md',
    same: ['edgemobile/package.json', 'edgephone/rednode-app.json'],
    parts: [
      { from: 'edgemobile', to: 'apps/edgemobile', manifest: 'rednode-app.json', npm: true },
      { from: 'edgephone', to: 'apps/edgephone', manifest: 'rednode-app.json' },
    ],
  },
  chooms: {
    name: 'Chooms',
    version: json('chooms/rednode/rednode-app.json').version,
    changelog: 'docs/chooms/changelog.md',
    same: ['chooms/mobile/mobile-app.json'],
    parts: [
      { from: 'chooms/rednode', to: 'apps/chooms', manifest: 'rednode-app.json' },
      { from: 'chooms/mobile', to: 'mobile-apps/chooms', manifest: 'mobile-app.json' },
    ],
  },
};

const asked = args.filter((a) => !a.startsWith('--'));
for (const id of asked) if (!ZIPS[id]) throw new Error(`No zip named ${id}: edgemobile or chooms`);
for (const id of asked.length ? asked : Object.keys(ZIPS)) build(id, ZIPS[id]);

function build(id, z) {
  for (const rel of z.same) {
    const v = json(rel).version;
    if (v !== z.version) throw new Error(`${rel} says version ${v}; ${z.name} is ${z.version}. Keep them the same`);
  }
  for (const p of z.parts) {
    const m = json(`${p.from}/${p.manifest}`);
    if (p.manifest === 'rednode-app.json' && !m.requires?.rednode) throw new Error(`${p.from}/${p.manifest}: "requires" must name the REDnode it needs`);
    // Chooms! needs an EDGEmobile that exists.
    const needs = m.requires?.edgemobile?.match(/^>=\s*(\d+\.\d+\.\d+)$/)?.[1];
    if (needs && newer(needs, ZIPS.edgemobile.version)) throw new Error(`${p.from}/${p.manifest} needs EDGEmobile ${needs}, newer than ${ZIPS.edgemobile.version}`);
  }

  if (!draft) {
    const log = readFileSync(join(repo, z.changelog), 'utf8');
    if (!new RegExp(`^## ${z.version.replace(/\./g, '\\.')} \\(`, 'm').test(log)) {
      throw new Error(`${z.changelog} has no "## ${z.version} (<date>)" section. Rename Unreleased first, or pass --draft for a test build`);
    }
    const unreleased = log.match(/^## Unreleased\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m);
    if (unreleased && unreleased[1].replace(/^###.*$/gm, '').trim()) {
      throw new Error(`${z.changelog} has changes under Unreleased. Raise ${z.name}'s version and rename Unreleased to "## <version> (<date>)", or pass --draft for a test build`);
    }
  }

  const out = join(repo, 'release');
  const stage = join(out, `stage-${id}`);
  const zip = join(out, `${z.name}-${z.version}${draft ? '-draft' : ''}.zip`);
  rmSync(stage, { recursive: true, force: true });
  rmSync(zip, { force: true });

  for (const p of z.parts) {
    const to = join(stage, 'red4ext', 'plugins', 'REDnode', ...p.to.split('/'));
    // node_modules comes fresh from npm below; backups and editor leftovers stay out.
    cpSync(join(repo, p.from), to, { recursive: true, filter: (src) => !/^(node_modules|.*\.bak|.*\.tmp)$/.test(basename(src)) });
    cpSync(join(repo, 'LICENSE'), join(to, 'LICENSE.txt'));
    if (p.npm) {
      const npm = spawnSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: to, stdio: 'inherit', shell: true });
      if (npm.status !== 0) throw new Error(`npm ci failed in ${p.from}`);
    }
  }

  // Windows' own tar writes zip files (-a picks the format from the name). Git's tar does not.
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  const packed = spawnSync(tar, ['-a', '-c', '-f', zip, 'red4ext'], { cwd: stage, stdio: 'inherit' });
  if (packed.status !== 0) throw new Error('Zipping failed');

  const count = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(dir, e.name)) : 1), 0);
  console.log(`${zip}: ${(statSync(zip).size / 1024).toFixed(0)} KB, ${count(stage)} files`);
  const needs = z.parts.map((p) => `${p.to}: ${Object.entries(json(`${p.from}/${p.manifest}`).requires ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`${z.name} ${z.version}${draft ? ' (draft)' : ''}. Needs: ${needs.join('; ')}`);
}

function newer(a, b) {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
