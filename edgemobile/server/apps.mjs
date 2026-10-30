// The mobile apps installed beside EDGEmobile (docs/design.md, "Mobile apps" and "C1 plan"): each
// folder in red4ext/plugins/REDnode/mobile-apps/ with a mobile-app.json. Read at start and again
// when the folder changes, so an app unpacked while the game runs shows without a restart.

import { existsSync, readFileSync, readdirSync, statSync, watch } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const FILE = /^[A-Za-z0-9_-][A-Za-z0-9_./-]{0,200}$/;

/** A file inside `root`, or null for anything that would leave it. */
export function inside(root, rel) {
  if (typeof rel !== 'string' || !FILE.test(rel) || rel.split('/').includes('..')) return null;
  const full = resolve(root, rel);
  return full.startsWith(resolve(root) + sep) ? full : null;
}

/** Reads one app's mobile-app.json; null with a reason in `problems` when it does not fit. */
function readApp(dir, id, problems) {
  let m;
  try {
    m = JSON.parse(readFileSync(join(dir, id, 'mobile-app.json'), 'utf8'));
  } catch (err) {
    problems.push(`${id}: mobile-app.json could not be read (${err.message})`);
    return null;
  }
  if (m.id !== id) return problems.push(`${id}: its id must be its folder's name`), null;
  if (typeof m.name !== 'string' || !m.name.trim()) return problems.push(`${id}: no name`), null;
  const entry = m.entry ?? 'index.html';
  if (!inside(join(dir, id), entry) || !existsSync(join(dir, id, entry))) return problems.push(`${id}: its entry ${entry} is missing`), null;
  const icon = m.icon && inside(join(dir, id), m.icon) && existsSync(join(dir, id, m.icon)) ? m.icon : null;
  if (m.package != null && (typeof m.package !== 'string' || !ID.test(m.package))) return problems.push(`${id}: its package is not a package id`), null;
  return {
    id,
    name: m.name.trim().slice(0, 40),
    version: String(m.version ?? ''),
    author: String(m.author ?? ''),
    description: String(m.description ?? ''),
    entry,
    icon,
    package: m.package ?? null,
  };
}

/**
 * The installed apps, kept current. `onChange(apps)` runs after each change of the folder.
 * `log` gets each app that could not be read, once.
 */
export class Apps {
  constructor({ dir, onChange = () => {}, log = console.log }) {
    this.dir = dir;
    this.list = [];
    this.onChange = onChange;
    this.log = log;
    this.told = new Set();
    this.scan();
    this.#watch();
  }

  get(id) {
    return this.list.find((a) => a.id === id) ?? null;
  }

  scan() {
    const problems = [];
    let names = [];
    try {
      names = readdirSync(this.dir).filter((n) => ID.test(n) && statSync(join(this.dir, n)).isDirectory());
    } catch {
      // no mobile-apps folder yet: no apps
    }
    const list = names.map((n) => readApp(this.dir, n, problems)).filter(Boolean);
    for (const p of problems) {
      if (!this.told.has(p)) this.log(`Mobile apps: ${p}`);
      this.told.add(p);
    }
    const changed = JSON.stringify(list) !== JSON.stringify(this.list);
    this.list = list;
    return changed;
  }

  #watch() {
    let timer = null;
    const again = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (this.scan()) this.onChange(this.list);
      }, 300);
    };
    try {
      this.watcher = watch(this.dir, { recursive: true }, again);
      this.watcher.on('error', () => {});
    } catch {
      // the folder does not exist yet: look again now and then
      this.timer = setInterval(again, 5000);
      this.timer.unref?.();
    }
  }

  close() {
    this.watcher?.close();
    clearInterval(this.timer);
  }
}
