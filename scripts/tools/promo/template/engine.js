/* Botly promo engine: builds a vertical promo from window.PROMO (written by make-promo.py) and one
 * paused GSAP timeline that HyperFrames seeks frame by frame. Everything is positioned in absolute
 * film time, so any frame renders the same on its own (seek-safe). */
(function () {
  const P = window.PROMO;
  const tl = gsap.timeline({ paused: true });
  window.__timelines = window.__timelines || {};
  window.__timelines.main = tl;

  const css = document.documentElement.style;
  const b = P.brand || {};
  if (b.accent) css.setProperty('--accent', b.accent);
  if (b.accent2) css.setProperty('--accent2', b.accent2);
  if (b.deep) css.setProperty('--deep', b.deep);
  if (b.background) css.setProperty('--bg', b.background);

  const $ = (sel) => document.querySelector(sel);
  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const TR = 0.7; // transition length (seconds); scenes overlap by this much
  // Text is measured to fit, so the real fonts must be loaded before anything is built.
  const FONTS = ['900 100px Display', '800 100px Display', '600 100px Display', '500 40px Body', '700 40px Body'];
  window.__promoReady = Promise.all(FONTS.map((f) => document.fonts.load(f))).catch(() => {}).then(main);
  function main() {

  /** "Fast *South African* hosting" -> word spans; *starred* words take the accent colour. */
  function titleNode(text, cls) {
    const t = make('div', `title ${cls || ''}`);
    let hl = false;
    String(text || '').split(/\s+/).filter(Boolean).forEach((raw) => {
      let word = raw;
      if (word.startsWith('*')) { hl = true; word = word.slice(1); }
      // "*word*" or "*word*?" - a closing star may be followed by punctuation.
      const m = word.match(/^(.*?)\*([^*]*)$/);
      const close = !!m;
      if (m) word = m[1] + m[2];
      const w = make('span', `w${hl ? ' hl' : ''}`);
      w.appendChild(make('span', null, word));
      t.appendChild(w);
      t.appendChild(document.createTextNode(' '));
      if (close) hl = false;
    });
    return t;
  }

  /** Shrink text until it fits: never wider than its box (no cut-off words), at most `lines` lines. */
  function fit(node, max, min, lines) {
    let size = max;
    const tooBig = () => {
      const lh = parseFloat(getComputedStyle(node).lineHeight) || size * 1.1;
      if (node.scrollHeight > lh * lines + 6) return true;
      if (node.scrollWidth > node.clientWidth + 2) return true;
      return [...node.querySelectorAll('.w')].some((w) => w.offsetWidth > node.clientWidth + 2);
    };
    node.style.fontSize = `${size}px`;
    while (size > min && tooBig()) { size -= 4; node.style.fontSize = `${size}px`; }
  }

  function background(scene, s, i) {
    if (s.image) {
      const bg = make('div', 'bg');
      bg.style.backgroundImage = `url("${s.image}")`;
      scene.appendChild(bg);
      scene.appendChild(make('div', `shade${s.type === 'prices' || s.type === 'points' ? ' heavy' : ''}`));
      // Slow cinematic push-in, drifting a different way each scene.
      const dir = i % 2 ? 1 : -1;
      tl.fromTo(bg, { scale: 1.08, x: -24 * dir, y: 10 * dir }, { scale: 1.2, x: 24 * dir, y: -10 * dir, duration: s.dur + TR, ease: 'none' }, s.start);
    } else {
      scene.appendChild(make('div', 'solid'));
      const g1 = make('div', 'glow'); g1.style.background = 'var(--accent)'; g1.style.left = '-300px'; g1.style.top = '-200px';
      const g2 = make('div', 'glow'); g2.style.background = 'var(--accent2)'; g2.style.right = '-350px'; g2.style.bottom = '-250px';
      scene.append(g1, g2);
      tl.fromTo(g1, { x: 0, y: 0 }, { x: 260, y: 220, duration: s.dur + TR, ease: 'sine.inOut' }, s.start);
      tl.fromTo(g2, { x: 0, y: 0 }, { x: -240, y: -260, duration: s.dur + TR, ease: 'sine.inOut' }, s.start);
    }
  }

  function revealTitle(t, at) {
    tl.from(t.querySelectorAll('.w > span'), { yPercent: 115, rotation: 6, duration: 0.85, ease: 'power4.out', stagger: 0.07 }, at);
  }

  function build(s, i) {
    const scene = make('div', 'scene');
    scene.style.zIndex = String(i + 1);
    $('#scenes').appendChild(scene);
    background(scene, s, i);
    const content = make('div', 'content');
    if (P.captions && P.captions.length) content.style.height = '1100px';
    scene.appendChild(content);
    const at = s.start + (i === 0 ? 0.25 : TR * 0.6);

    if (s.type === 'hero' || s.type === 'image') {
      if (s.kicker) {
        const k = make('div', 'kicker', s.kicker); content.appendChild(k);
        tl.from(k, { scale: 0.5, opacity: 0, duration: 0.55, ease: 'back.out(2.2)' }, at);
      }
      const t = titleNode(s.title); content.appendChild(t); fit(t, 132, 64, 4); revealTitle(t, at + 0.1);
      const bar = make('div', 'bar'); content.appendChild(bar);
      tl.from(bar, { scaleX: 0, duration: 0.7, ease: 'power3.out' }, at + 0.45);
      if (s.sub) { const sub = make('div', 'sub', s.sub); content.appendChild(sub); tl.from(sub, { y: 40, opacity: 0, duration: 0.7, ease: 'power3.out' }, at + 0.6); }
    } else if (s.type === 'points') {
      const t = titleNode(s.title); content.appendChild(t); fit(t, 100, 56, 3); revealTitle(t, at);
      const list = make('div', 'points'); content.appendChild(list);
      (s.points || []).slice(0, 5).forEach((p, j) => {
        const row = make('div', 'point'); const c = make('div', 'check', '✓'); const txt = make('div', null, p);
        row.append(c, txt); list.appendChild(row);
        const when = at + 0.5 + j * Math.min(0.45, Math.max(0.25, (s.dur - 1.5) / Math.max(1, (s.points || []).length)));
        tl.from(row, { x: -90, opacity: 0, duration: 0.6, ease: 'power3.out' }, when);
        tl.from(c, { scale: 0, rotation: -120, duration: 0.55, ease: 'back.out(2.5)' }, when + 0.1);
      });
    } else if (s.type === 'prices') {
      const t = titleNode(s.title || 'Pick your plan'); content.appendChild(t); fit(t, 96, 56, 2); revealTitle(t, at);
      const plans = make('div', 'plans'); content.appendChild(plans);
      (s.plans || []).slice(0, 3).forEach((p, j) => {
        const card = make('div', `plan${p.popular ? ' pop' : ''}`);
        if (p.popular) card.appendChild(make('div', 'badge', typeof p.popular === 'string' ? p.popular : 'Most popular'));
        card.appendChild(make('div', 'name', p.name));
        const price = make('div', 'price');
        const m = String(p.price || '').match(/^(\D*)([\d.,]+)(.*)$/);
        const num = make('span'); price.appendChild(num);
        if (p.per) price.appendChild(make('small', null, ` ${p.per}`));
        card.appendChild(price);
        card.appendChild(make('div', 'feat', (p.features || []).slice(0, 3).join(' · ')));
        plans.appendChild(card);
        const when = at + 0.45 + j * 0.3;
        tl.from(card, { y: 140, opacity: 0, duration: 0.75, ease: 'power3.out' }, when);
        if (m) {
          const target = parseFloat(m[2].replace(/,/g, ''));
          const dec = (m[2].split('.')[1] || '').length;
          const o = { v: 0 };
          num.textContent = `${m[1]}${(0).toFixed(dec)}${m[3]}`;
          tl.to(o, { v: target, duration: 0.9, ease: 'power2.out', onUpdate: () => { num.textContent = `${m[1]}${o.v.toFixed(dec)}${m[3]}`; } }, when + 0.15);
          tl.set(num, { textContent: `${m[1]}${m[2]}${m[3]}` }, when + 1.06);
        } else num.textContent = p.price || '';
        if (p.popular) tl.fromTo(card, { scale: 1 }, { scale: 1.035, duration: 0.6, ease: 'sine.inOut', yoyo: true, repeat: Math.max(1, Math.floor((s.dur - 2) / 0.6)) }, when + 0.8);
      });
    } else if (s.type === 'cta') {
      content.classList.add('cta');
      if (P.brand.logo) { const l = make('img', 'logo'); l.src = P.brand.logo; content.appendChild(l); tl.from(l, { scale: 0.5, opacity: 0, duration: 0.7, ease: 'back.out(1.8)' }, at); }
      else if (P.brand.name) { const n = make('div', 'brandname', P.brand.name); content.appendChild(n); tl.from(n, { y: -40, opacity: 0, duration: 0.6, ease: 'power3.out' }, at); }
      const t = titleNode(s.title || 'Get started today'); content.appendChild(t); fit(t, 112, 60, 3); revealTitle(t, at + 0.2);
      const btn = make('div', 'button', s.button || 'Order now'); const shine = make('div', 'shine'); btn.appendChild(shine); content.appendChild(btn);
      tl.from(btn, { scale: 0.6, opacity: 0, duration: 0.6, ease: 'back.out(2.4)' }, at + 0.7);
      const pulses = Math.max(1, Math.floor((s.dur - 1.6) / 0.7));
      tl.to(btn, { scale: 1.06, duration: 0.35, ease: 'sine.inOut', yoyo: true, repeat: pulses * 2 - 1 }, at + 1.3);
      for (let k = 0; k * 1.4 < s.dur - 1.4; k++) tl.fromTo(shine, { x: 0 }, { x: 1100, duration: 0.8, ease: 'power2.inOut' }, at + 1.2 + k * 1.4);
      const url = s.url || P.brand.url;
      if (url) { const u = make('div', 'url', url); content.appendChild(u); tl.from(u, { y: 30, opacity: 0, duration: 0.6, ease: 'power3.out' }, at + 1.0); }
    }
    return scene;
  }

  // ---------- scenes and transitions ----------
  const FX = ['zoom', 'whip', 'wipe', 'flash', 'rise'];
  const scenes = P.scenes.map((s, i) => {
    const node = build(s, i);
    const end = s.start + s.dur + (i < P.scenes.length - 1 ? TR : 0);
    tl.set(node, { visibility: 'visible' }, s.start);
    if (i < P.scenes.length - 1) tl.set(node, { visibility: 'hidden' }, end);
    return node;
  });
  for (let i = 1; i < scenes.length; i++) {
    const A = scenes[i - 1], B = scenes[i];
    const t0 = P.scenes[i].start;
    const fx = P.scenes[i].transition || FX[(i - 1) % FX.length];
    if (fx === 'zoom') {
      tl.to(A, { scale: 1.4, opacity: 0, filter: 'blur(22px)', duration: TR, ease: 'power3.in' }, t0);
      tl.fromTo(B, { scale: 1.35, opacity: 0, filter: 'blur(22px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: TR, ease: 'power3.out' }, t0 + TR * 0.35);
    } else if (fx === 'whip') {
      tl.to(A, { x: -760, filter: 'blur(36px)', duration: TR * 0.8, ease: 'power3.in' }, t0);
      tl.fromTo(B, { x: 760, filter: 'blur(36px)' }, { x: 0, filter: 'blur(0px)', duration: TR * 0.8, ease: 'power3.out' }, t0 + TR * 0.3);
    } else if (fx === 'wipe') {
      tl.to(A, { x: -160, opacity: 0.6, duration: TR, ease: 'power3.inOut' }, t0);
      tl.fromTo(B, { clipPath: 'polygon(100% 0%, 100% 0%, 100% 100%, 120% 100%)' }, { clipPath: 'polygon(-20% 0%, 100% 0%, 100% 100%, 0% 100%)', duration: TR, ease: 'power4.inOut' }, t0);
    } else if (fx === 'flash') {
      tl.fromTo('#flash', { opacity: 0 }, { opacity: 0.95, duration: TR * 0.45, ease: 'power2.in' }, t0);
      tl.to('#flash', { opacity: 0, duration: TR * 0.8, ease: 'power2.out' }, t0 + TR * 0.45);
      tl.fromTo(B, { opacity: 0 }, { opacity: 1, duration: 0.01 }, t0 + TR * 0.45);
    } else {
      tl.to(A, { y: -380, opacity: 0.2, duration: TR, ease: 'power4.inOut' }, t0);
      tl.fromTo(B, { y: 1920 }, { y: 0, duration: TR, ease: 'power4.inOut' }, t0);
    }
    // A warm light leak sweeping across every cut.
    tl.fromTo('#leak', { x: 0, opacity: 0 }, { x: 1900, opacity: 0.85, duration: TR * 1.6, ease: 'power1.inOut' }, t0 - TR * 0.2);
    tl.to('#leak', { opacity: 0, duration: TR * 0.5 }, t0 + TR * 1.1);
  }
  tl.fromTo('#grain', { x: 0, y: 0 }, { x: -60, y: 40, duration: P.duration, ease: 'steps(' + Math.round(P.duration * 12) + ')' }, 0);

  // ---------- story-style progress bar ----------
  if (P.progress !== false) {
    P.scenes.forEach((s) => {
      const seg = make('div', 'seg'); const f = make('div', 'fill'); seg.appendChild(f); $('#progress').appendChild(seg);
      tl.to(f, { scaleX: 1, duration: s.dur + (s === P.scenes[P.scenes.length - 1] ? 0 : TR), ease: 'none' }, s.start);
    });
  }

  // ---------- word-by-word captions, timed to the voice-over ----------
  const words = P.captions || [];
  const chunks = [];
  let cur = [];
  words.forEach((w, j) => {
    const prev = words[j - 1];
    const text = cur.map((x) => x.text).join(' ');
    if (cur.length && (cur.length >= 3 || text.length + w.text.length > 16 || (prev && w.s - prev.e > 0.45) || /[.,!?;:]$/.test(prev.text))) { chunks.push(cur); cur = []; }
    cur.push(w);
  });
  if (cur.length) chunks.push(cur);
  chunks.forEach((c, j) => {
    const node = make('div', 'chunk');
    const spans = c.map((w) => { const sp = make('span', 'cw', w.text.replace(/[.,!?;:]+$/, '')); node.appendChild(sp); node.appendChild(document.createTextNode(' ')); return sp; });
    $('#captions').appendChild(node);
    const from = c[0].s;
    const next = chunks[j + 1];
    const to = next ? Math.min(next[0].s, c[c.length - 1].e + 0.6) : c[c.length - 1].e + 0.5;
    tl.fromTo(node, { autoAlpha: 0, scale: 0.8, y: 24 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.16, ease: 'back.out(3)' }, from);
    tl.set(node, { autoAlpha: 0 }, Math.max(from + 0.2, to));
    c.forEach((w, k) => {
      tl.set(spans[k], { attr: { class: 'cw on' } }, w.s);
      tl.set(spans[k], { attr: { class: 'cw' } }, c[k + 1] ? c[k + 1].s : Math.max(w.e, to - 0.01));
    });
  });

  tl.seek(0);
  }
})();
