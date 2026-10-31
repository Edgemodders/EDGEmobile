// Chooms!'s settings window. The mod (mod.mjs) keeps the settings and the images; this page
// draws them and sends changes back over the package channel. Images are chosen in a picker
// drawn here, from folders the mod lists, since the system's file picker opens behind the game;
// previews come back as data addresses.

const { channel } = await import('rednode');
const $ = (id) => document.getElementById(id);
const SLIDERS = ['everyMinutes', 'peopleChance', 'corpChance', 'maxPerCheck', 'weightText', 'weightSelfie', 'weightActivity'];

let people = [];
let current = null;
let msgTimer = null;

function message(text, tone = 'fine') {
  $('msg').textContent = text;
  $('msg').className = tone;
  $('msg').hidden = !text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => ($('msg').hidden = true), 6000);
}

channel.on((m) => {
  if (m.type === 'state') drawGeneral(m);
  else if (m.type === 'person' && m.id === current) drawPerson(m);
  else if (m.type === 'browse') drawBrowse(m);
  else if (m.type === 'peek') drawPeek(m);
  else if (m.type === 'error') message(m.text, 'error');
  else if (m.type === 'note') message(m.text, 'note');
});

// --- Posting ---------------------------------------------------------------------------------

let drawing = false;
function drawGeneral(s) {
  drawing = true;
  const g = s.general;
  $('on').toggleAttribute('checked', !!g.on);
  for (const k of SLIDERS) $(k).setAttribute('value', String(g[k]));
  $('postModel').value = g.postModel;
  $('dmModel').value = g.dmModel;
  if (document.activeElement !== $('dailyCapUsd')) $('dailyCapUsd').value = g.dailyCapUsd;
  drawing = false;
  people = s.people;
  drawList();
}

let pendingGeneral = {};
let generalTimer = null;
function setGeneral(key, value) {
  if (drawing) return;
  pendingGeneral[key] = value;
  clearTimeout(generalTimer);
  generalTimer = setTimeout(() => {
    channel.post({ type: 'general', values: pendingGeneral });
    pendingGeneral = {};
  }, 300);
}

$('on').addEventListener('change', (e) => setGeneral('on', !!e.detail?.checked));
for (const k of SLIDERS) {
  for (const ev of ['input', 'change']) $(k).addEventListener(ev, (e) => e.detail?.value !== undefined && setGeneral(k, Number(e.detail.value)));
}
for (const k of ['postModel', 'dmModel']) $(k).addEventListener('change', () => setGeneral(k, $(k).value));
$('dailyCapUsd').addEventListener('change', () => setGeneral('dailyCapUsd', Number($('dailyCapUsd').value)));

// --- People ----------------------------------------------------------------------------------

const KIND = { cast: '', delamain: '', figure: 'story' };
function drawList() {
  const list = $('peopleList');
  list.replaceChildren(
    ...people.map((p) => {
      const item = document.createElement('rn-item');
      item.setAttribute('value', p.id);
      if (p.id === current) item.setAttribute('selected', '');
      item.textContent = p.name;
      const end = document.createElement('span');
      end.slot = 'end';
      end.textContent = [p.portrait ? 'portrait' : '', p.settings ? `${p.settings} place${p.settings === 1 ? '' : 's'}` : '', KIND[p.kind]].filter(Boolean).join(' · ') || (p.on ? '' : 'off');
      item.append(end);
      return item;
    }),
  );
}

$('peopleList').addEventListener('select', (e) => {
  current = e.detail.value;
  $('detail').replaceChildren(Object.assign(document.createElement('p'), { className: 'fine', textContent: 'Loading…' }));
  channel.post({ type: 'person', person: current });
});

function drawPerson(p) {
  const info = people.find((x) => x.id === p.id);
  const frag = $('personTpl').content.cloneNode(true);
  const q = (sel) => frag.querySelector(sel);
  q('.name').textContent = info?.name ?? p.id;
  q('.pOn').toggleAttribute('checked', p.on);
  q('.pImages').toggleAttribute('checked', p.images);
  q('.pOn').addEventListener('change', (e) => channel.post({ type: 'person-set', person: p.id, on: !!e.detail?.checked }));
  q('.pImages').addEventListener('change', (e) => channel.post({ type: 'person-set', person: p.id, images: !!e.detail?.checked }));

  // With no portrait, an empty picture: an img without a source shows a broken image.
  q('.portrait').src = p.portrait || BLANK;
  q('.removePortrait').hidden = !p.portrait;
  q('.removePortrait').addEventListener('click', () => channel.post({ type: 'portrait-remove', person: p.id }));
  q('.choosePortrait').addEventListener('click', () => openPicker(p.id, 'portrait'));
  q('.choosePlace').addEventListener('click', () => openPicker(p.id, 'setting'));

  const places = q('.places');
  p.settings.forEach((s, index) => {
    const row = $('placeTpl').content.cloneNode(true).firstElementChild;
    if (s.image) row.querySelector('img').src = s.image;
    row.querySelector('img').alt = s.description || 'A place';
    const desc = row.querySelector('.desc');
    const acts = row.querySelector('.acts');
    desc.value = s.description;
    acts.value = s.activities;
    const save = () => channel.post({ type: 'setting-edit', person: p.id, index, description: desc.value, activities: acts.value });
    desc.addEventListener('change', save);
    acts.addEventListener('change', save);
    row.querySelector('.remove').addEventListener('click', () => channel.post({ type: 'setting-remove', person: p.id, index }));
    row.querySelector('.try').addEventListener('click', () => {
      save();
      channel.post({ type: 'try-post', person: p.id, index });
    });
    places.append(row);
  });
  if (!p.settings.length) places.append(Object.assign(document.createElement('p'), { className: 'fine', textContent: 'No places yet.' }));
  $('detail').replaceChildren(frag);
}

// --- Choosing an image ------------------------------------------------------------------------
// The system's file picker opens on the desktop, behind the game, and holds the cursor until it
// is found and closed. This picker is drawn in the window instead: the mod lists a folder's
// subfolders and images, sends a preview of the one selected and copies the one picked.

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
let picking = null; // { person, kind, path, parent, name }

const fine = (text, cls = 'fine') => Object.assign(document.createElement('p'), { className: cls, textContent: text });
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function openPicker(personId, kind) {
  const name = people.find((x) => x.id === personId)?.name ?? personId;
  picking = { person: personId, kind, path: null, parent: null, name: null };
  $('pickTitle').textContent = kind === 'portrait' ? `A portrait of ${name}` : `A place for ${name}`;
  $('pickList').replaceChildren(fine('Loading…'));
  select(null);
  $('tabs').hidden = true;
  $('picker').hidden = false;
  channel.post({ type: 'browse' });
}

function closePicker() {
  picking = null;
  $('picker').hidden = true;
  $('tabs').hidden = false;
}

function browse(path, into) {
  $('pickList').replaceChildren(fine('Loading…'));
  select(null);
  channel.post({ type: 'browse', path, into });
}

function select(name) {
  if (picking) picking.name = name;
  $('pickPreview').src = BLANK;
  $('pickUse').hidden = !name;
  $('pickName').textContent = name ? `${name}: loading…` : 'Select an image to see it here. PNG, JPEG or WebP, up to 12 MB.';
  for (const el of $('pickList').querySelectorAll('.entry.file')) el.classList.toggle('on', el.dataset.name === name);
  if (name) channel.post({ type: 'peek', path: picking.path, name });
}

function entry(cls, name, meta, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `entry ${cls}`;
  b.dataset.name = name;
  const n = Object.assign(document.createElement('span'), { className: 'name', textContent: name });
  const m = Object.assign(document.createElement('span'), { className: 'meta', textContent: meta });
  b.append(n, m);
  b.addEventListener('click', onClick);
  return b;
}

function drawBrowse(m) {
  if (!picking) return;
  picking.path = m.path;
  picking.parent = m.parent;
  $('pickPath').textContent = m.path;
  $('pickPath').title = m.path;
  $('pickUp').hidden = !m.parent;
  $('pickPlaces').replaceChildren(
    ...m.places.map((pl) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: `chip${pl.path === m.path ? ' on' : ''}`, textContent: pl.name, title: pl.path });
      b.addEventListener('click', () => browse(pl.path));
      return b;
    }),
  );
  const rows = [];
  if (m.error) rows.push(fine(m.error, 'fine error'));
  for (const d of m.dirs) rows.push(entry('dir', d, '', () => browse(m.path, d)));
  for (const f of m.files) {
    const row = entry('file', f.name, `${day(f.at)} · ${size(f.size)}`, () => select(f.name));
    row.addEventListener('dblclick', use);
    rows.push(row);
  }
  if (!m.error && !m.dirs.length && !m.files.length) rows.push(fine('No folders or images here.'));
  if (m.more) rows.push(fine('Only the first 1000 are shown.'));
  $('pickList').replaceChildren(...rows);
  $('pickList').scrollTop = 0;
}

function drawPeek(m) {
  if (!picking || m.path !== picking.path || m.name !== picking.name) return;
  if (m.error) {
    $('pickName').textContent = `${m.name}: ${m.error}`;
    $('pickUse').hidden = true;
    return;
  }
  $('pickPreview').src = m.data;
  $('pickName').textContent = m.name;
}

function use() {
  if (!picking?.name) return;
  channel.post({ type: 'pick', person: picking.person, kind: picking.kind, path: picking.path, name: picking.name });
  message(`Adding ${picking.name}…`);
  closePicker();
}

$('pickCancel').addEventListener('click', closePicker);
$('pickUp').addEventListener('click', () => picking?.parent && browse(picking.parent));
$('pickUse').addEventListener('click', use);

channel.post({ type: 'hello' });
