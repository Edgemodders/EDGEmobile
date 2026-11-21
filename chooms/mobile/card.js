// Chooms!'s share card: a post drawn as a picture in the app's look, for the phone's share sheet
// (app.js, the Share button; EDGEmobile's mobile.share). Instagram and TikTok take pictures, not
// text, so a post is shared as this image with its words beside it.
//
//   const file = await choomsCard(post);   // a PNG File, 1080 pixels wide
//
// The colours and fonts are the theme's, read from the page. Pictures come from media addresses,
// which EDGEmobile serves with CORS so they can be drawn. A picture that cannot be loaded is left
// out (the avatar falls back to its initials).

(() => {
  const W = 1080;
  const PAD = 64;
  const IN = 48; // inside the panel
  const CREDIT = 'edgemodders.github.io/EDGEmobile';

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // A colour that may be a var(--x), as roster colours are.
  const colour = (c, fallback) => {
    const m = /^var\((--[\w-]+)\)$/.exec(String(c ?? '').trim());
    return (m ? css(m[1]) : c) || fallback;
  };
  const family = (name) => css(name) || 'sans-serif';

  const image = (url) =>
    new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });

  // Breaks text into lines that fit `width`, keeping the post's own line breaks.
  function wrap(ctx, text, width) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width <= width || !line) line = next;
        else (out.push(line), (line = word));
      }
      out.push(line);
    }
    return out;
  }

  // Draws `img` to cover the box, cropped from the middle.
  function cover(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const sw = w / s;
    const sh = h / s;
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  }

  // A panel with its top-right corner cut, as the app's panels.
  function panel(ctx, x, y, w, h, cut) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w - cut, y);
    ctx.lineTo(x + w, y + cut);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  }

  async function choomsCard(p) {
    const t = {
      bg: css('--bg-000') || '#05070b',
      panel: css('--bg-200') || '#10131c',
      line: css('--line') || '#262c3d',
      grid: css('--grid-line') || 'rgba(25, 243, 255, 0.06)',
      ink: css('--ink') || '#e3e6ee',
      dim: css('--ink-dim') || '#8a93a8',
      red: css('--red') || '#ff2a52',
      cyan: css('--cyan') || '#19f3ff',
      onAccent: css('--on-accent') || '#05070b',
    };
    const display = family('--font-display');
    const body = family('--font-body');
    const mono = family('--font-mono');
    const fonts = [`700 120px ${display}`, `700 48px ${display}`, `500 44px ${body}`, `500 28px ${mono}`];
    await Promise.all(fonts.map((f) => document.fonts.load(f).catch(() => null)));
    const [avatar, photo] = await Promise.all([image(p.by.avatar?.url), image(p.image?.url)]);

    // Measure first: the text's lines and the photo's height set the card's height.
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `500 44px ${body}`;
    const innerW = W - PAD * 2 - IN * 2;
    const all = wrap(measure, p.text, innerW);
    const lines = all.slice(0, 18);
    if (all.length > lines.length) {
      let last = lines[17];
      while (last && measure.measureText(`${last}…`).width > innerW) last = last.slice(0, -1);
      lines[17] = `${last.trimEnd()}…`;
    }
    const headTop = PAD;
    const panelTop = headTop + 190;
    const textTop = panelTop + IN + 120 + 40;
    const textH = lines.length * 58;
    // The photo is cropped to a square from its middle (the user's choice, 2026-11-21), shorter
    // only if a long post leaves less of 1920 pixels (TikTok's 9:16); too little, none.
    const room = 1920 - (textTop + textH + 24 + 80 + IN + 190);
    let photoH = photo ? Math.min(innerW, room) : 0;
    if (photoH < 240) photoH = 0;
    const photoTop = textTop + textH + (photoH ? 24 : 0);
    const statsTop = photoTop + photoH + 40;
    const panelH = statsTop + 40 - panelTop + IN;
    const H = Math.max(1080, Math.min(1920, panelTop + panelH + 190));

    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');

    // The ground and its grid.
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 2;
    for (let x = 0; x <= W; x += 64) (ctx.beginPath(), ctx.moveTo(x, 0), ctx.lineTo(x, H), ctx.stroke());
    for (let y = 0; y <= H; y += 64) (ctx.beginPath(), ctx.moveTo(0, y), ctx.lineTo(W, y), ctx.stroke());

    // The app's name, as its title bar.
    ctx.textBaseline = 'top';
    ctx.fillStyle = t.cyan;
    ctx.font = `500 28px ${mono}`;
    ctx.fillText('// NIGHT CITY', PAD, headTop);
    ctx.fillStyle = t.red;
    ctx.font = `700 120px ${display}`;
    ctx.fillText('CHOOMS!', PAD - 4, headTop + 34);

    // The post's panel.
    panel(ctx, PAD, panelTop, W - PAD * 2, panelH, 40);
    ctx.fillStyle = t.panel;
    ctx.fill();
    ctx.strokeStyle = t.line;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Who: the avatar, the name and tag, the handle and when.
    const ax = PAD + IN;
    const ay = panelTop + IN;
    if (avatar) {
      ctx.fillStyle = t.bg;
      ctx.fillRect(ax, ay, 120, 120);
      cover(ctx, avatar, ax, ay, 120, 120);
    } else {
      ctx.fillStyle = colour(p.by.color, t.red);
      ctx.fillRect(ax, ay, 120, 120);
      ctx.fillStyle = t.onAccent;
      ctx.font = `700 48px ${display}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p.by.initials ?? '').slice(0, 3), ax + 60, ay + 62);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
    const nx = ax + 120 + 32;
    ctx.fillStyle = t.ink;
    ctx.font = `700 48px ${display}`;
    const name = String(p.by.id === 'v' ? 'V' : p.by.name).toUpperCase();
    ctx.fillText(name, nx, ay + 8);
    if (p.by.tag) {
      const tagX = nx + ctx.measureText(name).width + 24;
      ctx.font = `500 24px ${mono}`;
      const tw = ctx.measureText(p.by.tag.toUpperCase()).width + 28;
      if (tagX + tw < W - PAD - IN) {
        ctx.strokeStyle = colour(p.by.color, t.cyan);
        ctx.lineWidth = 3;
        ctx.strokeRect(tagX, ay + 12, tw, 42);
        ctx.fillStyle = colour(p.by.color, t.cyan);
        ctx.fillText(p.by.tag.toUpperCase(), tagX + 14, ay + 21);
      }
    }
    ctx.fillStyle = t.dim;
    ctx.font = `500 28px ${mono}`;
    ctx.fillText(`@${p.by.handle} · ${p.ago}`, nx, ay + 74);

    // The words, then the photo.
    ctx.fillStyle = t.ink;
    ctx.font = `500 44px ${body}`;
    lines.forEach((l, i) => ctx.fillText(l, ax, textTop + i * 58));
    if (photoH) cover(ctx, photo, ax, photoTop, innerW, photoH);

    // Likes and comments.
    ctx.fillStyle = t.dim;
    ctx.font = `500 28px ${mono}`;
    ctx.fillText(`♥ ${Number(p.likes ?? 0).toLocaleString('en-US')}    ${Number(p.comments ?? 0)} comments`, ax, statsTop);

    // The credit.
    const fy = Math.min(H - 136, panelTop + panelH + 48);
    ctx.fillStyle = t.red;
    ctx.fillRect(PAD, fy, 72, 6);
    ctx.fillStyle = t.dim;
    ctx.font = `500 28px ${mono}`;
    ctx.fillText('Chooms! for Cyberpunk 2077', PAD, fy + 22);
    ctx.fillText(CREDIT, PAD, fy + 60);

    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The card could not be drawn.');
    return new File([blob], 'chooms-post.png', { type: 'image/png' });
  }

  window.choomsCard = choomsCard;
  window.choomsCredit = `https://${CREDIT}/`;
})();
