/* Botly promo engine: builds the video from window.PROMO (written by make-promo.py) as one paused GSAP
 * timeline that HyperFrames seeks frame by frame. Everything sits at absolute film time (seek-safe).
 * Styles: neon, minimal, editorial, playful, luxury. Formats: portrait, square, landscape. */
(function () {
  const P = window.PROMO;
  const tl = gsap.timeline({ paused: true });
  window.__timelines = window.__timelines || {};
  window.__timelines.main = tl;

  const W = P.W, H = P.H, FS = P.fs;
  const STY = {
    neon:      { reveal: 'mask',  fx: ['zoom', 'whip', 'wipe', 'flash', 'rise'], kb: 0.12, framed: false, leak: true,  tr: 0.7, enter: { y: 60, opacity: 0, duration: 0.7, ease: 'power3.out' } },
    minimal:   { reveal: 'fade',  fx: ['slide', 'rise', 'fade'],                kb: 0.06, framed: true,  leak: false, tr: 0.7, enter: { y: 30, opacity: 0, duration: 0.8, ease: 'power2.out' } },
    editorial: { reveal: 'mask',  fx: ['wipe', 'slide', 'fade'],                kb: 0.05, framed: true,  leak: false, tr: 0.75, enter: { y: 20, opacity: 0, duration: 0.9, ease: 'expo.out' } },
    playful:   { reveal: 'pop',   fx: ['zoom', 'rise', 'whip', 'slide'],        kb: 0.08, framed: true,  leak: false, tr: 0.6, enter: { scale: 0.3, rotation: -8, opacity: 0, duration: 0.7, ease: 'back.out(2.4)' }, shapes: true },
    luxury:    { reveal: 'blur',  fx: ['fade', 'zoom'],                         kb: 0.07, framed: false, leak: true,  tr: 1.0, enter: { y: 16, opacity: 0, filter: 'blur(8px)', duration: 1.2, ease: 'power2.out' }, hair: true },
  };
  const S = STY[P.style] || STY.neon;
  const TR = S.tr;

  const css = document.getElementById('root').style;
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
  const enter = (node, at, extra) => tl.from(node, { ...S.enter, ...(extra || {}) }, at);

  // Text is measured to fit, so the real fonts must be loaded before anything is built.
  const FONTS = ['600 60px Montserrat', '800 60px Montserrat', '900 60px Montserrat', '500 40px Inter', '700 40px Inter',
    '700 60px Playfair', '900 60px Playfair', 'italic 700 60px Playfair', 'italic 900 60px Playfair',
    '500 60px Fredoka', '700 60px Fredoka', '500 60px Cormorant', '600 60px Cormorant', 'italic 500 60px Cormorant'];
  window.__promoReady = Promise.all(FONTS.map((f) => document.fonts.load(f))).catch(() => {}).then(main);

  /** "Fast *South African* hosting" -> word spans; *starred* words take the accent colour. */
  function titleNode(text, cls) {
    const t = make('div', `title ${cls || ''}`);
    let hl = false;
    String(text || '').split(/\s+/).filter(Boolean).forEach((raw) => {
      let word = raw;
      if (word.startsWith('*')) { hl = true; word = word.slice(1); }
      const m = word.match(/^(.*?)\*([^*]*)$/); // "*word*" or "*word*?"
      if (m) word = m[1] + m[2];
      const w = make('span', `w${hl ? ' hl' : ''}`);
      if (S.reveal !== 'mask') w.style.overflow = 'visible';
      w.appendChild(make('span', null, word));
      t.appendChild(w);
      t.appendChild(document.createTextNode(' '));
      if (m) hl = false;
    });
    return t;
  }

  /** Shrink text until it fits: never wider than its box (no cut-off words), at most `lines` lines. */
  function fit(node, max, min, lines) {
    let size = Math.round(max * FS);
    const lo = Math.round(min * FS);
    const tooBig = () => {
      const lh = parseFloat(getComputedStyle(node).lineHeight) || size * 1.1;
      if (node.scrollHeight > lh * lines + 6) return true;
      if (node.scrollWidth > node.clientWidth + 2) return true;
      return [...node.querySelectorAll('.w')].some((w) => w.offsetWidth > node.clientWidth + 2);
    };
    node.style.fontSize = `${size}px`;
    while (size > lo && tooBig()) { size -= 3; node.style.fontSize = `${size}px`; }
  }

  function revealTitle(t, at) {
    const words = t.querySelectorAll('.w > span');
    if (S.reveal === 'mask') tl.from(words, { yPercent: 115, rotation: 6, duration: 0.85, ease: 'power4.out', stagger: 0.07 }, at);
    else if (S.reveal === 'fade') tl.from(words, { y: 40 * FS, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.05 }, at);
    else if (S.reveal === 'pop') tl.from(words, { scale: 0, rotation: (k) => (k % 2 ? 10 : -10), duration: 0.6, ease: 'back.out(2.6)', stagger: 0.07 }, at);
    else tl.from(words, { opacity: 0, filter: 'blur(14px)', y: 10, duration: 1.3, ease: 'power2.out', stagger: 0.12 }, at);
  }

  /** A counting number: "R49", "99.9%", "2,500+" count up from zero; anything else just appears. */
  function counter(node, value, at, dur) {
    const m = String(value || '').match(/^(\D*)([\d][\d.,]*)(.*)$/);
    if (!m) { node.textContent = value || ''; return; }
    const target = parseFloat(m[2].replace(/,/g, ''));
    const dec = (m[2].split('.')[1] || '').length;
    const comma = m[2].includes(',');
    const show = (v) => { let s = v.toFixed(dec); if (comma) s = Number(s).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); node.textContent = `${m[1]}${s}${m[3]}`; };
    const o = { v: 0 };
    show(0);
    tl.to(o, { v: target, duration: dur || 1, ease: 'power2.out', onUpdate: () => show(o.v) }, at);
    tl.set(node, { textContent: `${m[1]}${m[2]}${m[3]}` }, at + (dur || 1) + 0.02);
  }

  function decor(scene, s) {
    if (S.shapes) {
      const cols = ['var(--accent)', 'var(--accent2)'];
      // Corners only, clear of titles and captions.
      const spots = W > H ? [[0.03, 0.08, 140], [0.97, 0.93, 180]] : W === H ? [[0.95, 0.04, 130], [0.04, 0.97, 150]] : [[0.9, 0.03, 140], [0.05, 0.96, 180]];
      spots.forEach(([x, y, r], k) => {
        const sh = make('div', 'shape');
        Object.assign(sh.style, { left: `${x * W - (r * FS) / 2}px`, top: `${y * H - (r * FS) / 2}px`, width: `${r * FS}px`, height: `${r * FS}px`, background: cols[k % 2] });
        scene.appendChild(sh);
        tl.from(sh, { scale: 0, duration: 0.6, ease: 'back.out(3)' }, s.start + 0.2 + k * 0.12);
        tl.to(sh, { y: (k % 2 ? 26 : -26), rotation: k % 2 ? 20 : -20, duration: 1.1, ease: 'sine.inOut', yoyo: true, repeat: Math.max(1, Math.floor(s.dur / 1.1)) }, s.start + 0.8);
      });
    }
    if (S.hair) {
      const m = 50 * FS;
      [['top', 'left'], ['bottom', 'right']].forEach(([v, h], k) => {
        const a = make('div', 'hair'); Object.assign(a.style, { [v]: `${m}px`, [h]: `${m}px`, width: `${180 * FS}px`, height: '1.5px', transformOrigin: h });
        const c = make('div', 'hair'); Object.assign(c.style, { [v]: `${m}px`, [h]: `${m}px`, width: '1.5px', height: `${180 * FS}px`, transformOrigin: v });
        scene.append(a, c);
        tl.from(a, { scaleX: 0, duration: 1.2, ease: 'power2.inOut' }, s.start + 0.3 + k * 0.2);
        tl.from(c, { scaleY: 0, duration: 1.2, ease: 'power2.inOut' }, s.start + 0.3 + k * 0.2);
      });
    }
  }

  function media(container, s, i) {
    const bg = make('div', 'bg');
    const vid = document.getElementById(`v${i}`);
    if (vid) bg.appendChild(vid);
    else bg.style.backgroundImage = `url("${s.image}")`;
    container.appendChild(bg);
    const dir = i % 2 ? 1 : -1;
    const k = S.kb;
    tl.fromTo(bg, { scale: 1 + k * 0.4, x: -18 * dir * FS, y: 8 * dir * FS }, { scale: 1 + k * 1.4, x: 18 * dir * FS, y: -8 * dir * FS, duration: s.dur + TR, ease: 'none' }, s.start);
    return bg;
  }

  function background(scene, s, i) {
    const hasMedia = !!(s.image || s.video) && s.type !== 'phone';
    const heroLike = s.type === 'hero' || s.type === 'image';
    if (hasMedia && S.framed && heroLike) {
      scene.appendChild(make('div', 'solid'));
      const ph = make('div', 'photo');
      scene.appendChild(ph);
      media(ph, s, i);
      tl.from(ph, P.style === 'playful' ? { scale: 0.6, rotation: -8, opacity: 0, duration: 0.8, ease: 'back.out(1.8)' } : { clipPath: 'inset(0 0 100% 0)', duration: 1.0, ease: 'power4.inOut' }, s.start + 0.1);
      if (P.style === 'playful') tl.to(ph, { rotation: -2.5, duration: 0.3 }, s.start + 0.9);
      decor(scene, s);
      return true;
    }
    if (hasMedia) {
      media(scene, s, i);
      scene.appendChild(make('div', `shade${heroLike ? '' : ' heavy'}`));
    } else {
      scene.appendChild(make('div', 'solid'));
      if (P.style === 'neon' || P.style === 'luxury') {
        const g1 = make('div', 'glow'); g1.style.background = 'var(--accent)'; g1.style.left = '-20%'; g1.style.top = '-15%';
        const g2 = make('div', 'glow'); g2.style.background = 'var(--accent2)'; g2.style.right = '-25%'; g2.style.bottom = '-15%';
        if (P.style === 'luxury') { g1.style.opacity = '.18'; g2.style.opacity = '.12'; }
        scene.append(g1, g2);
        tl.fromTo(g1, { x: 0, y: 0 }, { x: 0.24 * W, y: 0.12 * H, duration: s.dur + TR, ease: 'sine.inOut' }, s.start);
        tl.fromTo(g2, { x: 0, y: 0 }, { x: -0.22 * W, y: -0.14 * H, duration: s.dur + TR, ease: 'sine.inOut' }, s.start);
      }
    }
    decor(scene, s);
    return false;
  }

  function build(s, i) {
    const scene = make('div', 'scene');
    scene.style.zIndex = String(i + 1);
    $('#scenes').appendChild(scene);
    const framed = background(scene, s, i);
    const wide = !['hero', 'image', 'phone'].includes(s.type);
    const content = make('div', `content${framed ? ' framed' : ''}${wide ? ' wide' : ''}`);
    scene.appendChild(content);
    const at = s.start + (i === 0 ? 0.25 : TR * 0.6);
    const lines = framed ? 3 : 4;

    if (s.type === 'hero' || s.type === 'image') {
      if (s.kicker) { const k = make('div', 'kicker', s.kicker); content.appendChild(k); enter(k, at, { scale: 0.6 }); }
      const t = titleNode(s.title); content.appendChild(t); fit(t, framed ? 110 : 132, 56, lines); revealTitle(t, at + 0.1);
      const bar = make('div', 'bar'); content.appendChild(bar);
      tl.from(bar, { scaleX: 0, duration: 0.8, ease: 'power3.out' }, at + 0.45);
      if (s.sub) { const sub = make('div', 'sub', s.sub); content.appendChild(sub); enter(sub, at + 0.6); }
    } else if (s.type === 'points') {
      const t = titleNode(s.title); content.appendChild(t); fit(t, 100, 52, 3); revealTitle(t, at);
      const list = make('div', 'points'); content.appendChild(list);
      const pts = (s.points || []).slice(0, 5);
      pts.forEach((p, j) => {
        const row = make('div', 'point card'); const c = make('div', 'check', '✓'); const txt = make('div', null, p);
        row.append(c, txt); list.appendChild(row);
        const when = at + 0.5 + j * Math.min(0.45, Math.max(0.25, (s.dur - 1.5) / Math.max(1, pts.length)));
        enter(row, when, { x: -90 * FS, y: 0 });
        tl.from(c, { scale: 0, rotation: -120, duration: 0.55, ease: 'back.out(2.5)' }, when + 0.1);
      });
    } else if (s.type === 'prices') {
      const t = titleNode(s.title || 'Pick your plan'); content.appendChild(t); fit(t, 96, 52, 2); revealTitle(t, at);
      const list = (s.plans || []).slice(0, 3);
      const plans = make('div', `plans${list.length > 2 ? ' many' : ''}`); content.appendChild(plans);
      list.forEach((p, j) => {
        const card = make('div', `plan card${p.popular ? ' pop' : ''}`);
        if (p.popular) card.appendChild(make('div', 'badge', typeof p.popular === 'string' ? p.popular : 'Most popular'));
        card.appendChild(make('div', 'name', p.name));
        const price = make('div', 'price'); const num = make('span'); price.appendChild(num);
        if (p.per) price.appendChild(make('small', null, ` ${p.per}`));
        card.appendChild(price);
        card.appendChild(make('div', 'feat', (p.features || []).slice(0, 3).join(' · ')));
        plans.appendChild(card);
        const when = at + 0.45 + j * 0.3;
        enter(card, when, { y: 140 * FS });
        counter(num, p.price, when + 0.15, 0.9);
        if (p.popular) tl.to(card, { scale: 1.035, duration: 0.6, ease: 'sine.inOut', yoyo: true, repeat: Math.max(1, Math.floor((s.dur - 2) / 0.6)) }, when + 0.9);
      });
    } else if (s.type === 'quote') {
      const qm = make('div', 'quote-mark', '“'); content.appendChild(qm); enter(qm, at, { scale: 0.5 });
      const q = make('div', 'quote'); q.textContent = s.quote || s.title || ''; content.appendChild(q);
      let size = Math.round(78 * FS); q.style.fontSize = `${size}px`;
      while (size > 36 * FS && q.scrollHeight > (W > H ? 0.42 : 0.36) * H) { size -= 3; q.style.fontSize = `${size}px`; }
      enter(q, at + 0.25);
      if (s.stars) {
        const st = make('div', 'stars'); content.appendChild(st);
        for (let k = 0; k < Math.min(5, Number(s.stars) || 5); k++) { const star = make('span', null, '★'); st.appendChild(star); tl.from(star, { scale: 0, rotation: -90, duration: 0.45, ease: 'back.out(3)' }, at + 0.8 + k * 0.1); }
      }
      const who = make('div', 'who'); content.appendChild(who);
      if (s.avatar) { const av = make('div', 'avatar'); av.style.backgroundImage = `url("${s.avatar}")`; who.appendChild(av); }
      const names = make('div'); names.appendChild(make('div', 'who-name', s.author || '')); if (s.role) names.appendChild(make('div', 'who-role', s.role));
      who.appendChild(names); enter(who, at + 1.1);
    } else if (s.type === 'compare') {
      if (s.title) { const t = titleNode(s.title); content.appendChild(t); fit(t, 92, 50, 2); revealTitle(t, at); }
      const box = make('div', 'compare'); content.appendChild(box);
      ['before', 'after'].forEach((key, j) => {
        const d = s[key] || {};
        const side = make('div', `side ${key} card${d.image ? ' has-img' : ''}`);
        if (d.image) { const im = make('div', 'simg'); im.style.backgroundImage = `url("${d.image}")`; side.appendChild(im); }
        side.appendChild(make('div', 'lbl', d.label || (j ? 'After' : 'Before')));
        if (d.text) side.appendChild(make('div', 'stxt', d.text));
        box.appendChild(side);
        if (j === 0) enter(side, at + 0.4);
        else tl.from(side, { clipPath: W >= H ? 'inset(0 100% 0 0)' : 'inset(0 0 100% 0)', duration: 1.0, ease: 'power4.inOut' }, at + 1.2);
      });
    } else if (s.type === 'steps') {
      const t = titleNode(s.title || 'How it works'); content.appendChild(t); fit(t, 96, 52, 2); revealTitle(t, at);
      const list = make('div', 'steps'); content.appendChild(list);
      const rail = make('div', 'rail'); list.appendChild(rail);
      const st = (s.steps || []).slice(0, 4);
      const gap = Math.min(0.7, Math.max(0.35, (s.dur - 1.6) / Math.max(1, st.length)));
      st.forEach((txt, j) => {
        const row = make('div', 'step'); row.append(make('div', 'num', String(j + 1)), make('div', null, txt)); list.appendChild(row);
        enter(row, at + 0.5 + j * gap, { x: 60 * FS, y: 0 });
      });
      tl.from(rail, { scaleY: 0, duration: gap * st.length, ease: 'none' }, at + 0.55);
    } else if (s.type === 'stats') {
      if (s.title) { const t = titleNode(s.title); content.appendChild(t); fit(t, 90, 50, 2); revealTitle(t, at); }
      const list = (s.stats || []).slice(0, 3);
      const box = make('div', `stats${list.length > 1 ? ' many' : ''}`); content.appendChild(box);
      list.forEach((x, j) => {
        const st = make('div', 'stat'); const v = make('div', 'val'); const l = make('div', 'lab', x.label || '');
        st.append(v, l); box.appendChild(st);
        if (list.length > 1 && H > W) v.style.fontSize = `${Math.round(150 * FS)}px`;
        if (W >= H && list.length > 1) v.style.fontSize = `${Math.round((list.length > 2 ? 120 : 150) * FS)}px`;
        enter(st, at + 0.4 + j * 0.35);
        counter(v, x.value, at + 0.5 + j * 0.35, 1.2);
      });
    } else if (s.type === 'phone') {
      content.classList.add('phone-c');
      const t = titleNode(s.title || ''); content.appendChild(t); fit(t, W > H ? 100 : 104, 52, W > H ? 4 : 2); revealTitle(t, at);
      if (s.sub) { const sub = make('div', 'sub', s.sub); content.appendChild(sub); enter(sub, at + 0.5); }
      const wrap = make('div', 'phone-wrap'); const ph = make('div', 'phone'); const sc = make('div', 'screen'); const n = make('div', 'notch');
      sc.style.backgroundImage = `url("${s.screenshot}")`;
      ph.append(sc, n); wrap.appendChild(ph); scene.appendChild(wrap);
      tl.from(wrap, { y: 0.45 * H, rotation: 7, duration: 1.1, ease: 'power3.out' }, at + 0.2);
      tl.fromTo(sc, { backgroundPosition: '50% 0%' }, { backgroundPosition: '50% 100%', duration: Math.max(1, s.dur - 2.2), ease: 'power1.inOut' }, at + 1.4);
    } else if (s.type === 'cta') {
      content.classList.add('center', 'cta');
      content.style.left = 'var(--cl)'; content.style.right = 'var(--cl)';
      if (P.brand.logo) { const l = make('img', 'logo'); l.src = P.brand.logo; content.appendChild(l); enter(l, at, { scale: 0.5 }); }
      else if (P.brand.name) { const nm = make('div', 'brandname', P.brand.name); content.appendChild(nm); enter(nm, at); }
      const t = titleNode(s.title || 'Get started today'); content.appendChild(t); fit(t, 112, 56, 3); revealTitle(t, at + 0.2);
      const btn = make('div', 'button', s.button || 'Order now'); const shine = make('div', 'shine'); btn.appendChild(shine); content.appendChild(btn);
      enter(btn, at + 0.7, { scale: 0.6 });
      if (P.style !== 'luxury' && P.style !== 'editorial') {
        const pulses = Math.max(1, Math.floor((s.dur - 1.6) / 0.7));
        tl.to(btn, { scale: 1.06, duration: 0.35, ease: 'sine.inOut', yoyo: true, repeat: pulses * 2 - 1 }, at + 1.4);
      }
      for (let k = 0; k * 1.4 < s.dur - 1.4; k++) tl.fromTo(shine, { x: 0 }, { x: 1100 * FS, duration: 0.8, ease: 'power2.inOut' }, at + 1.2 + k * 1.4);
      const url = s.url || P.brand.url;
      if (url) { const u = make('div', 'url', url); content.appendChild(u); enter(u, at + 1.0); }
    }
    return scene;
  }

  function main() {
    // ---------- scenes and transitions ----------
    const scenes = P.scenes.map((s, i) => {
      const node = build(s, i);
      tl.set(node, { visibility: 'visible' }, s.start);
      if (i < P.scenes.length - 1) tl.set(node, { visibility: 'hidden' }, s.start + s.dur + TR);
      return node;
    });
    for (let i = 1; i < scenes.length; i++) {
      const A = scenes[i - 1], B = scenes[i];
      const t0 = P.scenes[i].start;
      const fx = P.scenes[i].transition || S.fx[(i - 1) % S.fx.length];
      if (fx === 'zoom') {
        tl.to(A, { scale: 1.4, opacity: 0, filter: 'blur(22px)', duration: TR, ease: 'power3.in' }, t0);
        tl.fromTo(B, { scale: 1.35, opacity: 0, filter: 'blur(22px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: TR, ease: 'power3.out' }, t0 + TR * 0.35);
      } else if (fx === 'whip') {
        tl.to(A, { x: -0.7 * W, filter: 'blur(36px)', duration: TR * 0.8, ease: 'power3.in' }, t0);
        tl.fromTo(B, { x: 0.7 * W, filter: 'blur(36px)' }, { x: 0, filter: 'blur(0px)', duration: TR * 0.8, ease: 'power3.out' }, t0 + TR * 0.3);
      } else if (fx === 'wipe') {
        tl.to(A, { x: -0.15 * W, opacity: 0.6, duration: TR, ease: 'power3.inOut' }, t0);
        tl.fromTo(B, { clipPath: 'polygon(100% 0%, 100% 0%, 100% 100%, 120% 100%)' }, { clipPath: 'polygon(-20% 0%, 100% 0%, 100% 100%, 0% 100%)', duration: TR, ease: 'power4.inOut' }, t0);
      } else if (fx === 'flash') {
        tl.fromTo('#flash', { opacity: 0 }, { opacity: 0.95, duration: TR * 0.45, ease: 'power2.in' }, t0);
        tl.to('#flash', { opacity: 0, duration: TR * 0.8, ease: 'power2.out' }, t0 + TR * 0.45);
        tl.fromTo(B, { opacity: 0 }, { opacity: 1, duration: 0.01 }, t0 + TR * 0.45);
      } else if (fx === 'slide') {
        tl.to(A, { x: -0.35 * W, opacity: 0.4, duration: TR, ease: 'power4.inOut' }, t0);
        tl.fromTo(B, { x: W }, { x: 0, duration: TR, ease: 'power4.inOut' }, t0);
      } else if (fx === 'fade') {
        tl.fromTo('#black', { opacity: 0 }, { opacity: 1, duration: TR * 0.5, ease: 'power2.in' }, t0);
        tl.to('#black', { opacity: 0, duration: TR * 0.6, ease: 'power2.out' }, t0 + TR * 0.5);
        tl.fromTo(B, { opacity: 0 }, { opacity: 1, duration: 0.01 }, t0 + TR * 0.5);
      } else {
        tl.to(A, { y: -0.2 * H, opacity: 0.2, duration: TR, ease: 'power4.inOut' }, t0);
        tl.fromTo(B, { y: H }, { y: 0, duration: TR, ease: P.style === 'playful' ? 'back.out(1.4)' : 'power4.inOut' }, t0);
      }
      if (S.leak) {
        tl.fromTo('#leak', { x: 0, opacity: 0 }, { x: 1.8 * W, opacity: P.style === 'luxury' ? 0.6 : 0.85, duration: TR * 1.6, ease: 'power1.inOut' }, t0 - TR * 0.2);
        tl.to('#leak', { opacity: 0, duration: TR * 0.5 }, t0 + TR * 1.1);
      }
    }
    tl.fromTo('#grain', { x: 0, y: 0 }, { x: -60, y: 40, duration: P.duration, ease: `steps(${Math.round(P.duration * 12)})` }, 0);

    // ---------- story-style progress bar ----------
    if (P.progress !== false) {
      P.scenes.forEach((s, i) => {
        const seg = make('div', 'seg'); const f = make('div', 'fill'); seg.appendChild(f); $('#progress').appendChild(seg);
        tl.to(f, { scaleX: 1, duration: s.dur + (i === P.scenes.length - 1 ? 0 : TR), ease: 'none' }, s.start);
      });
    }

    // ---------- word-by-word captions, timed to the voice-over ----------
    const words = P.captions || [];
    const maxChars = W > H ? 26 : W === H ? 14 : 16;
    const chunks = [];
    let cur = [];
    words.forEach((w, j) => {
      const prev = words[j - 1];
      const text = cur.map((x) => x.text).join(' ');
      if (cur.length && (cur.length >= (W > H ? 4 : 3) || text.length + w.text.length > maxChars || (prev && w.s - prev.e > 0.45) || /[.,!?;:]$/.test(prev.text))) { chunks.push(cur); cur = []; }
      cur.push(w);
    });
    if (cur.length) chunks.push(cur);
    const pop = { neon: [{ autoAlpha: 0, scale: 0.8, yPercent: -30 }, 'back.out(3)', 0.16], minimal: [{ autoAlpha: 0, yPercent: -20 }, 'power2.out', 0.2],
      editorial: [{ autoAlpha: 0, yPercent: -40 }, 'power2.out', 0.25], playful: [{ autoAlpha: 0, scale: 0.4, rotation: -6, yPercent: -50 }, 'back.out(3.5)', 0.22],
      luxury: [{ autoAlpha: 0, yPercent: -40, filter: 'blur(6px)' }, 'power2.out', 0.35] }[P.style] || [{ autoAlpha: 0, yPercent: -50 }, 'power2.out', 0.2];
    chunks.forEach((c, j) => {
      const node = make('div', 'chunk');
      const spans = c.map((w) => { const sp = make('span', 'cw', w.text.replace(/[.,!?;:]+$/, '')); node.appendChild(sp); node.appendChild(document.createTextNode(' ')); return sp; });
      $('#captions').appendChild(node);
      gsap.set(node, { yPercent: -50 });
      const from = c[0].s;
      const next = chunks[j + 1];
      const to = next ? Math.min(next[0].s, c[c.length - 1].e + 0.6) : c[c.length - 1].e + 0.5;
      tl.fromTo(node, pop[0], { autoAlpha: 1, scale: 1, rotation: 0, yPercent: -50, filter: 'blur(0px)', duration: pop[2], ease: pop[1] }, from);
      tl.set(node, { autoAlpha: 0 }, Math.max(from + 0.2, to));
      c.forEach((w, k) => {
        tl.set(spans[k], { attr: { class: 'cw on' } }, w.s);
        tl.set(spans[k], { attr: { class: 'cw' } }, c[k + 1] ? c[k + 1].s : Math.max(w.e, to - 0.01));
        if (P.style === 'playful') tl.fromTo(spans[k], { scale: 1 }, { scale: 1.18, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.out' }, w.s);
      });
    });

    tl.seek(0);
  }
})();
