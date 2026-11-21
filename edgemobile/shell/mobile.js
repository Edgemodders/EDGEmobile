// The `mobile` library, for EDGEmobile's mobile apps (docs/design.md, "C1 plan"). An app's page
// loads it with <script src="/mobile.js"></script>. The page runs in a sandboxed frame inside
// the shell, with an origin of its own and no network: everything goes through the shell, which
// passes calls to the app's own REDnode package on the PC.
//
//   await mobile.ready;                       // the screen and the theme are known
//   const feed = await mobile.call('feed');   // the package's answer
//   mobile.on('changed', (data) => ...);      // the package's events
//   mobile.screen;                            // 'game' (the phone in the game) or 'phone'
//   mobile.home();                            // back to the home screen
//   mobile.canShare;                          // true on a real phone that can share images
//   await mobile.share({ title, text, files }); // the phone's share sheet; call it on a tap.
//                                             // false if the player closed it
//
// The theme follows the shell: the page's <html data-theme> is kept current, and the 'theme'
// event fires when it changes. Images from the package arrive as { url }.

(() => {
  const pending = new Map();
  const handlers = new Map();
  let nextId = 1;
  let ready;
  const readyPromise = new Promise((resolve) => (ready = resolve));
  const post = (msg) => window.parent.postMessage({ mobile: 1, ...msg }, '*');
  const fire = (event, data) => {
    for (const h of handlers.get(event) ?? []) {
      try {
        h(data);
      } catch (err) {
        console.error(err);
      }
    }
  };
  const setTheme = (theme) => {
    if (typeof theme !== 'string') return;
    mobile.theme = theme;
    document.documentElement.dataset.theme = theme;
  };

  const mobile = {
    /** 'game' or 'phone', once ready. */
    screen: null,
    /** The shell's theme: 'nightcity' or 'edgemodders'. */
    theme: null,
    /** Resolves once the shell has said which screen and theme. */
    ready: readyPromise,
    /** Calls the app's package. Resolves with its answer, rejects with its error. */
    call(name, ...args) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        post({ op: 'call', id, call: name, args });
      });
    },
    /** Calls `handler(data)` for each event of this name. Returns a function that stops it. */
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event).delete(handler);
    },
    /** Back to the home screen. */
    home() {
      post({ op: 'home' });
    },
    /** Whether share() can work: a real phone whose browser shares images. Not in the game. */
    canShare: false,
    /**
     * Opens the phone's share sheet (TikTok, Instagram, messages...) with a title, text and up
     * to one image File. Call it from a tap: the phone allows a share only right after one.
     * Resolves true once shared, false if the player closed the sheet.
     */
    share({ title = '', text = '', files = [] } = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        post({ op: 'share', id, title: String(title), text: String(text), files: [...files] });
      });
    },
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const m = e.data;
    if (!m || m.mobile !== 1) return;
    if (m.op === 'init') {
      mobile.screen = m.screen;
      mobile.canShare = m.share === true;
      setTheme(m.theme);
      ready(mobile);
    } else if (m.op === 'theme') {
      setTheme(m.theme);
      fire('theme', m.theme);
    } else if (m.op === 'result') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(new Error(m.error || 'The call failed.'));
    } else if (m.op === 'event') {
      fire(m.event, m.data);
    }
  });

  window.mobile = mobile;
  post({ op: 'hello' });
})();
