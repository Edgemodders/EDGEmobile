// Chooms!'s settings window. The mod (mod.mjs) keeps the settings and the images; this page
// draws them and sends changes back over the package channel. Images go to the mod in pieces,
// since the page has no file access; previews come back as data addresses.

const { channel } = await import('rednode');
const $ = (id) => document.getElementById(id);
const CHUNK = 192 * 1024;
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

  const img = q('.portrait');
  if (p.portrait) img.src = p.portrait;
  else img.removeAttribute('src');
  q('.removePortrait').hidden = !p.portrait;
  q('.removePortrait').addEventListener('click', () => channel.post({ type: 'portrait-remove', person: p.id }));
  wirePick(q('.choosePortrait'), q('.pickPortrait'), p.id, 'portrait');
  wirePick(q('.choosePlace'), q('.pickPlace'), p.id, 'setting');

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

// A button that opens the file picker, and sends the picked image to the mod in pieces.
function wirePick(button, input, personId, kind) {
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) return message('That image is over 12 MB.', 'error');
    message(`Sending ${file.name}…`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const upload = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const n = Math.max(1, Math.ceil(bytes.length / CHUNK));
    for (let i = 0; i < n; i++) {
      const part = bytes.subarray(i * CHUNK, (i + 1) * CHUNK);
      let bin = '';
      for (let j = 0; j < part.length; j += 0x8000) bin += String.fromCharCode(...part.subarray(j, j + 0x8000));
      channel.post({ type: 'upload', upload, person: personId, kind, i, n, chunk: btoa(bin) });
    }
    message(`${file.name} added.`, 'note');
  });
}

channel.post({ type: 'hello' });
