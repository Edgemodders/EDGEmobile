// Chooms!, the mobile app (docs/design.md, "Chooms!" and "C1 plan"). Everything it shows comes
// from its REDnode package on the PC, through /mobile.js: this page only draws it. All text is
// set as text, never as markup.

const $ = (id) => document.getElementById(id);
const START_MS = 10000; // the package must answer within this, or the loading screen says why
const MIN_LOADING_MS = 700; // so the loading screen does not flash

// --- Small helpers ---------------------------------------------------------------------------

/** An element: h('div', { class: 'x', onclick }, child, 'text', ...). */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';
function icon(d, { fill = 'none', size } = {}) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  if (size) s.setAttribute('width', size), s.setAttribute('height', size);
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', fill);
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'square');
  s.append(p);
  return s;
}
const HEART = 'M12 20L3 11V6l3-3h4l2 2 2-2h4l3 3v5z';
const BUBBLE = 'M4 5h16v11H9l-5 4z';

let toastTimer = null;
function toast(text) {
  $('toastText').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 3500);
}

async function call(name, ...args) {
  try {
    return await mobile.call(name, ...args);
  } catch (err) {
    toast(err.message);
    throw err;
  }
}

function avatar(a, size = 40, open = true) {
  const inner = a.avatar?.url ? h('img', { src: a.avatar.url, alt: '' }) : a.initials;
  const attrs = { class: `avatar s${size}`, style: `background: ${a.avatar?.url ? 'var(--bg-000)' : a.color}`, 'aria-label': `${a.name}'s profile` };
  if (!open || a.id === 'v') return h('span', { ...attrs, 'aria-label': null, 'aria-hidden': 'true' }, inner);
  return h('button', { ...attrs, type: 'button', onclick: () => go('profile', a.id) }, inner);
}

function nameButton(a) {
  return h('button', { type: 'button', class: 'name', onclick: () => go('profile', a.id) }, a.name);
}

// --- Navigation ------------------------------------------------------------------------------
// One stack per tab press: a tab starts a new stack, Back goes one step up it.

const TITLES = { feed: ['Night City', 'Chooms!'], search: ['Find', 'Search'], compose: ['New', 'Post'], dms: ['Messages', 'DMs'], me: ['You', 'V'] };
let stack = [{ view: 'feed' }];
let tab = 'feed';

function go(view, arg) {
  stack.push({ view, arg });
  render();
}
function back() {
  if (stack.length > 1) stack.pop();
  render();
}
function setTab(t) {
  tab = t;
  stack = [{ view: t }];
  render();
}

$('back').addEventListener('click', back);
$('home').addEventListener('click', () => mobile.home());
for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));

function chrome(eyebrow, title) {
  $('eyebrow').textContent = eyebrow;
  $('title').textContent = title;
  $('back').style.visibility = stack.length > 1 ? 'visible' : 'hidden';
  for (const b of document.querySelectorAll('[data-tab]')) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
}

let composerSubmit = null;
function composer(placeholder, label, onSubmit) {
  composerSubmit = onSubmit;
  $('composer').hidden = !onSubmit;
  if (!onSubmit) return;
  $('draft').placeholder = placeholder;
  $('sendBtn').textContent = label;
}
$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('draft').value.trim();
  if (!text || !composerSubmit) return;
  $('sendBtn').disabled = true;
  try {
    await composerSubmit(text);
    $('draft').value = '';
  } catch {
    // the toast said why
  } finally {
    $('sendBtn').disabled = false;
  }
});

let renderSeq = 0;
async function render() {
  const { view, arg } = stack.at(-1);
  const seq = ++renderSeq;
  const keepScroll = render.lastKey === `${view}:${arg}` ? $('view').scrollTop : 0;
  render.lastKey = `${view}:${arg}`;
  composer(null);
  let nodes;
  try {
    nodes = await VIEWS[view](arg);
  } catch (err) {
    nodes = [h('p', { class: 'empty' }, err.message)];
  }
  if (seq !== renderSeq) return; // a newer render started meanwhile
  $('view').replaceChildren(...[nodes].flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
  $('view').scrollTop = keepScroll;
}

// --- Views -----------------------------------------------------------------------------------

function postCard(p, { full = false } = {}) {
  const like = h('button', { type: 'button', class: 'act', 'aria-pressed': String(p.liked), 'aria-label': p.liked ? 'Unlike' : 'Like', onclick: async () => {
    await call('like', p.id, !p.liked);
    render();
  } }, icon(HEART, { fill: p.liked ? 'currentColor' : 'none' }), h('span', {}, p.likes.toLocaleString('en-US')));
  const comments = h('button', { type: 'button', class: 'act', 'aria-label': `${p.comments} comments`, onclick: () => !full && go('post', p.id) }, icon(BUBBLE), h('span', {}, String(p.comments)));
  return h('article', { class: 'nc-panel post' },
    h('div', { class: 'post-head' },
      avatar(p.by, 40),
      h('div', { class: 'who' },
        h('div', { class: 'who-line' }, p.by.id === 'v' ? h('span', { class: 'name' }, 'V') : nameButton(p.by), p.by.tag ? h('span', { class: 'nc-tag', style: `color: ${p.by.color}` }, p.by.tag) : null),
        h('span', { class: 'meta' }, `@${p.by.handle} · ${p.ago}`))),
    h('p', { class: 'post-text' }, p.text),
    p.image?.url ? h('img', { class: 'post-image', src: p.image.url, alt: p.image.alt || 'A photo', loading: 'lazy' }) : null,
    h('div', { class: 'actions' }, like, comments));
}

function peopleStrip(title, people, extra) {
  if (!people.length) return null;
  return h('section', { class: 'nc-panel', 'aria-label': title },
    h('div', { class: 'nc-panel__head' }, h('h2', { class: 'nc-panel__title' }, title), extra ? h('span', { class: 'nc-panel__meta' }, extra) : null),
    h('div', { class: 'strip' }, people.map((a) => h('button', { type: 'button', class: 'person', onclick: () => go('profile', a.id) }, avatar(a, 56, false), h('span', {}, a.name.split(' ')[0])))));
}

const VIEWS = {
  async feed() {
    chrome(...TITLES.feed);
    const f = await call('feed');
    return [
      peopleStrip('Chooms', f.chooms, String(f.chooms.length)),
      peopleStrip('You might already know', f.suggestions),
      ...(f.posts.length ? f.posts.map((p) => postCard(p)) : [h('p', { class: 'empty' }, 'Nothing here yet. Follow people you know to see their posts.')]),
    ];
  },

  async post(id) {
    const p = await call('post', id);
    chrome('Post', p.by.name);
    composer('Say something, choom', 'Send', async (text) => {
      await call('comment', id, text);
      render();
    });
    return [
      postCard(p, { full: true }),
      h('section', { 'aria-label': 'Comments' },
        h('div', { class: 'nc-panel__head' }, h('h2', { class: 'nc-panel__title' }, 'Comments'), h('span', { class: 'nc-panel__meta' }, String(p.comments))),
        p.commentList.length ? p.commentList.map((c) => h('div', { class: 'comment' },
          avatar(c.by, 32),
          h('div', { class: 'body' },
            h('div', { class: 'who-line' }, c.by.id === 'v' ? h('span', { class: 'name' }, 'V') : nameButton(c.by), h('span', { class: 'meta' }, c.ago)),
            h('p', {}, c.text)),
          h('button', { type: 'button', class: 'clike', 'aria-pressed': String(c.liked), 'aria-label': c.liked ? 'Unlike comment' : 'Like comment', onclick: async () => {
            await call('likeComment', id, c.id, !c.liked);
            render();
          } }, icon(HEART, { fill: c.liked ? 'currentColor' : 'none' }), h('span', {}, String(c.likes))))) : h('p', { class: 'note' }, 'No comments yet.')),
    ];
  },

  async profile(id) {
    if (id === 'v') return VIEWS.me();
    const p = await call('profile', id);
    const a = p.account;
    const r = p.relation;
    chrome('Profile', `@${a.handle}`);
    const buttons = [];
    if (r.request === 'pending') {
      buttons.push(h('button', { type: 'button', class: 'nc-btn nc-btn--primary', onclick: async () => {
        await call('accept', id);
        toast(`You and ${a.name} are chooms now.`);
        render();
      } }, 'Accept choom'));
    }
    buttons.push(h('button', { type: 'button', class: `nc-btn ${r.follows ? 'nc-btn--secondary' : r.request === 'pending' ? 'nc-btn--secondary' : 'nc-btn--primary'}`, 'aria-pressed': String(r.follows), onclick: async () => {
      await call('follow', id, !r.follows);
      render();
    } }, r.follows ? 'Following' : 'Follow'));
    if (r.canMessage) buttons.push(h('button', { type: 'button', class: 'nc-btn nc-btn--secondary', onclick: () => go('thread', id) }, 'Message'));
    const tags = [
      a.tag ? h('span', { class: 'nc-tag', style: `color: ${a.color}` }, a.tag) : null,
      r.choom ? h('span', { class: 'nc-tag nc-tag--solid', style: 'background: var(--green)' }, 'Choom') : null,
      r.request === 'pending' ? h('span', { class: 'nc-tag nc-tag--solid', style: 'background: var(--yellow)' }, 'Wants to be your choom') : null,
      r.followsV && !r.choom ? h('span', { class: 'nc-tag' }, 'Follows you') : null,
    ];
    return [
      h('section', { class: 'nc-panel nc-panel--hero nc-scan hero', 'aria-label': `About ${a.name}` },
        h('div', { class: 'row' }, avatar(a, 80, false),
          h('div', { class: 'who', style: 'gap: 6px' }, h('h2', {}, a.name), h('span', { class: 'meta' }, [`@${a.handle}`, a.home].filter(Boolean).join(' · ')), h('div', { class: 'tags' }, tags))),
        a.bio ? h('p', {}, a.bio) : null,
        h('dl', { class: 'stats' },
          h('div', {}, h('dt', {}, 'Posts'), h('dd', {}, String(p.postCount))),
          h('div', {}, h('dt', {}, 'You'), h('dd', {}, r.choom ? 'Choom' : r.follows ? 'Follow' : '—')),
          h('div', {}, h('dt', {}, 'Them'), h('dd', {}, r.followsV ? 'Follow' : '—'))),
        h('div', { class: 'buttons' }, buttons)),
      h('div', { class: 'section-head' }, h('h2', {}, 'Posts'), h('span', { class: 'meta' }, p.posts.length ? `Latest ${p.posts.length}` : '')),
      ...(p.posts.length ? p.posts.map((x) => postCard(x)) : [h('p', { class: 'note' }, 'No posts yet.')]),
    ];
  },

  async me() {
    const m = await call('me');
    chrome(...TITLES.me);
    return [
      h('section', { class: 'nc-panel nc-panel--hero hero', 'aria-label': 'You' },
        h('div', { class: 'row' }, avatar(m.account, 80, false), h('div', { class: 'who' }, h('h2', {}, 'V'), h('span', { class: 'meta' }, '@v'))),
        h('dl', { class: 'stats' },
          h('div', {}, h('dt', {}, 'Posts'), h('dd', {}, String(m.postCount))),
          h('div', {}, h('dt', {}, 'Chooms'), h('dd', {}, String(m.chooms.length))),
          h('div', {}, h('dt', {}, 'Following'), h('dd', {}, String(m.following.length))))),
      peopleStrip('Chooms', m.chooms),
      peopleStrip('Following', m.following),
      h('div', { class: 'section-head' }, h('h2', {}, 'Your posts')),
      ...(m.posts.length ? m.posts.map((p) => postCard(p)) : [h('p', { class: 'note' }, 'You have not posted yet.')]),
    ];
  },

  async search(q = '') {
    chrome(...TITLES.search);
    const field = h('input', { class: 'field-text', type: 'search', placeholder: 'Name or @handle', 'aria-label': 'Search', value: q, autocomplete: 'off' });
    const results = h('div', {});
    let timer = null;
    const run = async () => {
      const r = await call('search', field.value);
      stack.at(-1).arg = field.value;
      results.replaceChildren(
        ...(field.value.trim() ? (r.results.length ? r.results.map((a) => h('button', { type: 'button', class: 'list-item', onclick: () => go('profile', a.id) }, avatar(a, 40, false), h('div', { class: 'who' }, h('span', { class: 'name' }, a.name), h('span', { class: 'meta' }, `@${a.handle}${a.tag ? ` · ${a.tag}` : ''}`)))) : [h('p', { class: 'note' }, 'No one by that name that you know of.')]) : []),
        peopleStrip('You might already know', r.suggestions) ?? '',
      );
    };
    field.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 250);
    });
    await run();
    return [field, results];
  },

  async compose() {
    chrome(...TITLES.compose);
    const text = h('textarea', { class: 'field-text', maxlength: '500', placeholder: "What's happening in Night City?", 'aria-label': 'Your post' });
    const post = h('button', { type: 'button', class: 'nc-btn nc-btn--primary nc-btn--block', onclick: async () => {
      if (!text.value.trim()) return;
      await call('newPost', text.value);
      toast('Posted.');
      setTab('feed');
    } }, 'Post');
    return [h('p', { class: 'note' }, 'Your chooms will see it in their feed.'), text, post];
  },

  async dms() {
    chrome(...TITLES.dms);
    const d = await call('threads');
    return [
      d.requests.length ? h('section', { class: 'nc-panel', 'aria-label': 'Choom requests' },
        h('div', { class: 'nc-panel__head' }, h('h2', { class: 'nc-panel__title' }, 'Choom requests'), h('span', { class: 'nc-panel__meta' }, String(d.requests.length))),
        d.requests.map((a) => h('div', { class: 'list-item', style: 'cursor: default' }, avatar(a, 40), h('div', { class: 'who' }, nameButton(a), h('span', { class: 'meta' }, 'wants to be your choom')),
          h('button', { type: 'button', class: 'nc-btn nc-btn--primary', onclick: async () => {
            await call('accept', a.id);
            toast(`You and ${a.name} are chooms now.`);
            render();
          } }, 'Accept')))) : null,
      d.threads.length
        ? d.threads.map((t) => h('button', { type: 'button', class: 'list-item', onclick: () => go('thread', t.with.id) }, avatar(t.with, 40, false),
            h('div', { class: 'who' }, h('div', { class: 'who-line' }, h('span', { class: 'name' }, t.with.name), h('span', { class: 'meta' }, t.ago)), h('span', { class: 'last' }, t.last || 'Say hi.')),
            t.unread ? h('span', { class: 'unread', 'aria-label': `${t.unread} new` }, String(t.unread)) : null))
        : h('p', { class: 'empty' }, 'No messages. Once someone is your choom, you can message them.'),
    ];
  },

  async thread(id) {
    const t = await call('thread', id);
    chrome('Messages', t.with.name);
    if (t.relation.canMessage) {
      composer(`Message ${t.with.name.split(' ')[0]}`, 'Send', async (text) => {
        await call('send', id, text);
        render();
      });
    }
    const list = h('div', { class: 'thread' }, t.messages.map((m) => h('div', { class: `bubble${m.mine ? ' mine' : ''}` }, m.text, h('span', { class: 'meta' }, m.ago))));
    queueMicrotask(() => ($('view').scrollTop = $('view').scrollHeight));
    return [
      h('div', { class: 'row' }, avatar(t.with, 40), h('div', { class: 'who' }, nameButton(t.with), h('span', { class: 'meta' }, `@${t.with.handle}`))),
      t.messages.length ? list : h('p', { class: 'empty' }, 'No messages yet.'),
      t.relation.canMessage ? h('p', { class: 'note' }, 'Replies come in a later version of Chooms!.') : h('p', { class: 'note' }, 'You can message chooms only.'),
    ];
  },
};

// --- Badges, updates, and the start ----------------------------------------------------------

function setBadge(n) {
  $('dmBadge').hidden = !n;
  $('dmBadge').textContent = n > 99 ? '99+' : String(n);
}
mobile.on('badge', (d) => setBadge(d?.count ?? 0));

let started = false;
mobile.on('changed', () => {
  if (started) render();
  else start();
});

function loadingSays(text, stuck = false) {
  $('loadingStatus').textContent = text;
  $('loading').classList.toggle('stuck', stuck);
}

let starting = false;
async function start() {
  if (started || starting) return;
  starting = true;
  const t0 = Date.now();
  try {
    await mobile.ready;
    const state = await Promise.race([
      mobile.call('state'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('no answer')), START_MS)),
    ]);
    if (!state.ready) {
      loadingSays(state.reason === 'loading' ? 'Loading feed' : 'Load a save: your feed belongs to the playthrough you play', state.reason !== 'loading');
      setTimeout(start, 5000); // the package also says 'changed' once a playthrough is open
      return;
    }
    setBadge(state.badge ?? 0);
    await new Promise((r) => setTimeout(r, Math.max(0, MIN_LOADING_MS - (Date.now() - t0))));
    started = true;
    await render();
    $('app').hidden = false;
    $('loading').hidden = true;
  } catch {
    loadingSays('Chooms! needs its REDnode package: switch Chooms! on in the Mod Manager', true);
    setTimeout(start, 5000);
  } finally {
    starting = false;
  }
}

start();
