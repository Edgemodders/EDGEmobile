// Chooms!'s knowledge cards (cards/README.md): what each person knows and feels at each story
// point. Read once when the package starts; a post's prompt (C3) carries a person's cards for the
// story points the loaded save has passed (journal.mjs).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads `dir`'s cards. Returns Map(person id -> Map(point id or 'start' -> text)). Throws on a
 * file that is no one in the roster, or a heading that is neither `start` nor a story point, so
 * a typo cannot silently drop a card.
 */
export function loadCards(dir, { story, roster }) {
  const people = new Set(roster.map((a) => a.id));
  const points = new Set(story.points.map((p) => p.id));
  const cards = new Map();
  for (const file of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md') : []) {
    const id = file.slice(0, -3);
    if (!people.has(id)) throw new Error(`cards/${file}: no one in the roster has the id ${id}`);
    const own = new Map();
    const parts = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n').split(/^## +/m).slice(1);
    for (const part of parts) {
      const nl = part.indexOf('\n');
      const key = (nl < 0 ? part : part.slice(0, nl)).trim();
      const text = (nl < 0 ? '' : part.slice(nl + 1)).trim();
      if (key !== 'start' && !points.has(key)) throw new Error(`cards/${file}: "## ${key}" is not start or a story point in story.json`);
      if (own.has(key)) throw new Error(`cards/${file}: "## ${key}" twice`);
      if (!text) throw new Error(`cards/${file}: "## ${key}" is empty`);
      own.set(key, text);
    }
    cards.set(id, own);
  }
  return cards;
}

/**
 * A person's cards for a save: their `start` card, then the card of each story point the save
 * has passed (`passed`: point id -> game time), in the story's order. Each as { point, text }.
 */
export function cardsFor(cards, id, passed, story) {
  const own = cards.get(id);
  if (!own) return [];
  const out = own.has('start') ? [{ point: 'start', text: own.get('start') }] : [];
  for (const p of story.points) if (p.id in (passed ?? {}) && own.has(p.id)) out.push({ point: p.id, text: own.get(p.id) });
  return out;
}
