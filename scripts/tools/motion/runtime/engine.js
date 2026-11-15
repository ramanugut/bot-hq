/* Botly Motion Engine - browser runtime. Builds ONE paused GSAP timeline from window.__BOTLY.
   Everything is a function of timeline time: no unseeded randomness, no clock, no timers. */
(function () {
  var B = window.__BOTLY, T = B.tokens, u = T.u;
  window.__timelines = window.__timelines || {};

  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function $(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
  function fmt(v, d) { return Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }

  // Shrink until everything fits its box. Measured once, before any tween exists.
  // Box geometry, not scrollHeight: scroll sizes include glyph overhang, which reads as a false overflow.
  function overflows(content) {
    var c = content.getBoundingClientRect(), cs = getComputedStyle(content);
    var L = c.left + parseFloat(cs.paddingLeft) - 1, R = c.right - parseFloat(cs.paddingRight) + 1, Tp = c.top + parseFloat(cs.paddingTop) - 1, Bt = c.bottom - parseFloat(cs.paddingBottom) + 1;
    var kids = Array.prototype.slice.call(content.children), i, r;
    for (i = 0; i < kids.length; i++) { r = kids[i].getBoundingClientRect(); if (r.width && (r.left < L || r.right > R || r.top < Tp || r.bottom > Bt)) return true; }
    return $(content, ".fit, .panel, .icell, .step, .item, .barcol").some(function (box) {
      var b = box.getBoundingClientRect();
      return $(box, ".w, [data-check]").some(function (el) { var e = el.getBoundingClientRect(); return e.left < b.left - 1 || e.right > b.right + 1; });
    });
  }
  function fitBeat(beat) {
    var content = beat.querySelector(".content"), fits = $(content, ".fit"), k = 1, i;
    for (i = 0; i < 12 && fits.length && overflows(content); i++) {
      k *= 0.94;
      fits.forEach(function (el) { if (!el.dataset.base) el.dataset.base = parseFloat(getComputedStyle(el).fontSize); el.style.fontSize = el.dataset.base * k + "px"; });
    }
    for (i = 0, k = 1; i < 14 && overflows(content); i++) {
      k *= 0.96;
      content.style.setProperty("--u", u * k + "px");
      fits.forEach(function (el) { el.style.fontSize = ""; delete el.dataset.base; });
      var kk = 1, j;
      for (j = 0; j < 12 && fits.length && overflows(content); j++) { kk *= 0.94; fits.forEach(function (el) { if (!el.dataset.base) el.dataset.base = parseFloat(getComputedStyle(el).fontSize); el.style.fontSize = el.dataset.base * kk + "px"; }); }
    }
  }

  // One entrance per motion personality, shared by every component.
  var FIRST = false; // true while building beat 0: its content is on screen at frame 0 (the thumbnail)
  function enter(tl, els, t, rnd, stagger) {
    if (!els || !els.length) return t;
    if (FIRST) {
      // scale whole blocks, not single words: scaled words would cover the spaces between them
      var blocks = []; els.forEach(function (e) { var b = e.classList.contains("w") ? e.parentElement : e; if (blocks.indexOf(b) < 0) blocks.push(b); });
      els = blocks;
      tl.fromTo(els, { opacity: 1, scale: 1.14 }, { opacity: 1, scale: 1, duration: Math.max(0.6, T.dur), ease: "power3.out" }, 0);
      return Math.max(0.6, T.dur);
    }
    var from, to = { opacity: 1, duration: T.dur, ease: T.ease, stagger: stagger == null ? T.stagger : stagger };
    switch (T.personality) {
      case "snappy": from = { opacity: 0, y: u * 6 }; to.y = 0; break;
      case "smooth": from = { opacity: 0, y: u * 3 }; to.y = 0; break;
      case "bouncy": from = { opacity: 0, scale: 0.5 }; to.scale = 1; break;
      case "elegant": from = { opacity: 0, y: u * 4, filter: "blur(12px)" }; to.y = 0; to.filter = "blur(0px)"; break;
      case "mechanical": from = { opacity: 0, x: -u * 8 }; to.x = 0; break;
      case "glitchy": from = { opacity: 0, x: (rnd() < 0.5 ? -1 : 1) * u * 5, skewX: 24 }; to.x = 0; to.skewX = 0; break;
      case "organic": from = { opacity: 0, y: u * 4, rotation: (rnd() - 0.5) * 10 }; to.y = 0; to.rotation = 0; break;
      default: from = { opacity: 0, scale: 1.5 }; to.scale = 1; // heavy
    }
    tl.fromTo(els, from, to, t);
    return t + T.dur + to.stagger * (els.length - 1);
  }
  function grow(tl, els, t, axis, origin, dur) {
    if (!els.length) return;
    var from = { transformOrigin: origin }, to = { duration: dur || T.dur, ease: T.ease === "steps(4)" ? "steps(6)" : T.ease.indexOf("back") === 0 ? "power3.out" : T.ease, stagger: T.stagger };
    from[axis] = 0; to[axis] = 1;
    tl.fromTo(els, from, to, t);
  }
  function count(tl, el, t, dur) {
    var v = Number(el.dataset.value), d = Number(el.dataset.decimals), pre = el.dataset.prefix || "", suf = el.dataset.suffix || "", o = { v: 0 };
    function paint() { el.textContent = pre + fmt(o.v, d) + suf; }
    tl.fromTo(o, { v: 0 }, { v: v, duration: dur, ease: "power2.out", onUpdate: paint }, t);
    paint(); // start value on screen before the tween runs
  }

  var ANIM = {
    "hero-title": function (tl, el, t, d, rnd) { enter(tl, $(el, ".hero .w"), t, rnd); },
    "kinetic-line": function (tl, el, t, d, rnd) { var w = $(el, ".headline .w"); enter(tl, w, t, rnd, Math.min(0.16, Math.max(T.stagger, (d * 0.45) / Math.max(1, w.length)))); },
    "stat-counter": function (tl, el, t, d, rnd) {
      var n = el.querySelector(".num"); enter(tl, [n], t, rnd);
      count(tl, n, t, Math.min(1.4, d * 0.5)); enter(tl, $(el, ".label"), t + 0.35, rnd);
    },
    "list-reveal": function (tl, el, t, d, rnd) { var e = enter(tl, $(el, ".title"), t, rnd); enter(tl, $(el, ".item"), el.querySelector(".title") ? t + 0.3 : t, rnd, Math.min(0.22, (d * 0.4) / 4)); },
    "split-compare": function (tl, el, t, d, rnd) {
      enter(tl, $(el, ".pl"), t, rnd); grow(tl, $(el, ".vs"), t + 0.25, B.portrait ? "scaleX" : "scaleY", "50% 50%"); enter(tl, $(el, ".pr"), t + 0.45, rnd);
    },
    chart: function (tl, el, t, d, rnd) {
      enter(tl, $(el, ".title"), t, rnd);
      var t1 = t + 0.3, dur = Math.min(1.2, d * 0.4);
      grow(tl, $(el, ".bar"), t1, "scaleY", "50% 100%", dur);
      if (el.querySelector(".bval")) tl.fromTo($(el, ".bval"), { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out", stagger: T.stagger }, t1 + dur * 0.6);
      if (el.querySelector(".xl")) tl.fromTo($(el, ".xl"), { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out", stagger: T.stagger }, t1);
      $(el, ".line-fg").forEach(function (p) { tl.fromTo(p, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: dur, ease: "power2.inOut" }, t1); });
      $(el, ".ring-fg").forEach(function (c) { var len = Number(c.dataset.len); tl.fromTo(c, { strokeDashoffset: len }, { strokeDashoffset: len * (1 - Number(c.dataset.pct) / 100), duration: dur, ease: "power2.inOut" }, t1); });
      $(el, ".ringnum").forEach(function (n) { tl.fromTo(n, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" }, t1); count(tl, n, t1, dur); });
      enter(tl, $(el, ".label"), t1 + 0.3, rnd);
    },
    quote: function (tl, el, t, d, rnd) {
      tl.fromTo($(el, ".qmark"), { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: T.dur, ease: T.ease }, t);
      var w = $(el, ".qtext .w"); enter(tl, w, t + 0.15, rnd, Math.min(T.stagger, 0.9 / Math.max(1, w.length)));
      tl.fromTo($(el, ".qby"), { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" }, t + Math.min(1.4, d * 0.45));
    },
    steps: function (tl, el, t, d, rnd) {
      enter(tl, $(el, ".title"), t, rnd);
      grow(tl, $(el, ".stepline"), t + 0.2, B.portrait ? "scaleY" : "scaleX", "0% 0%", Math.min(1.2, d * 0.4));
      enter(tl, $(el, ".step"), t + 0.3, rnd, Math.min(0.3, (d * 0.4) / 4));
    },
    "icon-grid": function (tl, el, t, d, rnd) { enter(tl, $(el, ".title"), t, rnd); enter(tl, $(el, ".icell"), t + 0.25, rnd, Math.min(0.14, (d * 0.35) / 5)); },
    "ui-pan": function (tl, el, t, d, rnd) {
      enter(tl, $(el, ".uiframe"), t, rnd);
      var shot = el.querySelector(".uishot"), view = el.querySelector(".uiview"), travel = Math.max(0, shot.offsetHeight - view.clientHeight);
      tl.fromTo(shot, { y: 0 }, { y: -Math.min(travel, u * 30), duration: d, ease: "none" }, t); // constant drift: allowed
      enter(tl, $(el, ".caption-line"), t + 0.4, rnd);
    },
    "lower-third": function (tl, el, t, d, rnd) {
      enter(tl, $(el, ".headline .w"), t, rnd);
      grow(tl, $(el, ".strapbar"), t + 0.4, "scaleY", "50% 100%"); enter(tl, $(el, ".sname, .stitle"), t + 0.5, rnd);
    },
    "cta-card": function (tl, el, t, d, rnd) {
      var e = enter(tl, $(el, ".headline .w"), t, rnd), b = $(el, ".btn");
      if (b.length) { var tb = Math.min(e - T.dur * 0.5, t + d * 0.4); enter(tl, b, tb, rnd);
        var tp = tb + T.dur + 0.15; if (tp + 0.8 < t + d) tl.fromTo(b, { scale: 1 }, { scale: 1.06, duration: 0.4, ease: "sine.inOut", yoyo: true, repeat: 1 }, tp); }
    },
    "logo-sting": function (tl, el, t, d, rnd) {
      enter(tl, $(el, ".logo, .brand"), t, rnd); grow(tl, $(el, ".brandline"), t + 0.15, "scaleX", "50% 50%");
      tl.fromTo($(el, ".tagline"), { opacity: FIRST ? 1 : 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" }, t + 0.15);
    },
  };

  // Transition INTO a beat: the previous beat stays on screen underneath for TR seconds.
  function transition(tl, stage, prevStage, t, rnd) {
    var TR = B.tr, e = "power3.inOut";
    switch (T.transition) {
      case "wipe": tl.fromTo(stage, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: TR, ease: e }, t); break;
      case "push": tl.fromTo(stage, { xPercent: 100 }, { xPercent: 0, duration: TR, ease: e }, t); if (prevStage) tl.fromTo(prevStage, { xPercent: 0 }, { xPercent: -100, duration: TR, ease: e }, t); break;
      case "zoom": tl.fromTo(stage, { opacity: 0, scale: 1.35 }, { opacity: 1, scale: 1, duration: TR, ease: "power3.out" }, t); break;
      case "mask": tl.fromTo(stage, { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(75% at 50% 50%)", duration: TR, ease: e }, t); break;
      case "morph": tl.fromTo(stage, { clipPath: "inset(42% 42% 42% 42% round 50%)" }, { clipPath: "inset(0% 0% 0% 0% round 0%)", duration: TR, ease: e }, t); break;
      case "blur": tl.fromTo(stage, { opacity: 0, filter: "blur(30px)" }, { opacity: 1, filter: "blur(0px)", duration: TR, ease: "power2.out" }, t); break;
      case "glitch": tl.fromTo(stage, { opacity: 0, x: (rnd() < 0.5 ? -1 : 1) * u * 6 }, { opacity: 1, x: 0, duration: TR * 0.6, ease: "steps(3)" }, t); break;
      default: break; // cut
    }
  }

  // Check mode (index.html?botly-check): measure every checked text block at the end of its beat and
  // leave the result in the DOM, so plain `chromium --headless --dump-dom` can read it. No extra tools.
  function selfCheck(tl) {
    var out = [];
    B.beats.forEach(function (b, i) {
      tl.seek(b.start + b.seconds - 0.05, false); // false: let onUpdate run (counters)
      var beat = document.getElementById("b" + i);
      $(beat, "[data-check]").forEach(function (el) {
        var op = 1, n, r = el.getBoundingClientRect();
        for (n = el; n && n !== beat; n = n.parentElement) op *= parseFloat(getComputedStyle(n).opacity);
        $(el, ".w").forEach(function (w) { op = Math.min(op, parseFloat(getComputedStyle(w).opacity)); });
        out.push({ beat: i, level: el.dataset.level, final: el.dataset.final, text: el.textContent.trim().replace(/\s+/g, " "), opacity: op, size: parseFloat(getComputedStyle(el).fontSize), rect: [r.left, r.top, r.right, r.bottom] });
      });
    });
    tl.seek(0);
    var pre = document.createElement("pre");
    pre.id = "botly-check";
    pre.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(out))));
    document.body.appendChild(pre);
  }

  function build() {
    var tl = gsap.timeline({ paused: true }), prevStage = null;
    B.beats.forEach(function (b, i) {
      var el = document.getElementById("b" + i), rnd = mulberry32(hash(B.seed + "/beat/" + i));
      fitBeat(el);
      var stage = el.querySelector(".stage"), cut = T.transition === "cut" || i === 0;
      if (i > 0) transition(tl, stage, prevStage, b.start, rnd);
      // ambient: the frame never freezes during a hold (constant drift, so ease "none" is intended)
      tl.fromTo(el.querySelector(".amb"), { scale: 1 }, { scale: 1.03, duration: b.seconds + b.tail, ease: "none" }, b.start);
      $(el, ".decor").forEach(function (dc) {
        tl.fromTo(dc, { x: 0, y: 0, rotation: rnd() * 40 - 20 }, { x: (rnd() - 0.5) * u * 8, y: (rnd() - 0.5) * u * 8, rotation: "+=" + (rnd() * 30 - 15), duration: b.seconds + b.tail, ease: "none" }, b.start);
      });
      FIRST = i === 0;
      ANIM[b.component](tl, el, i === 0 ? 0 : b.start + (cut ? 0.1 : B.tr * 0.6), b.seconds - (i === 0 ? 0 : cut ? 0.1 : B.tr * 0.6), rnd);
      FIRST = false;
      prevStage = stage;
    });
    window.__timelines["main"] = tl;
    tl.seek(0);
    window.__botlyReady = true;
    if (/[?&]botly-check/.test(location.search)) selfCheck(tl);
  }
  // Load every face explicitly: document.fonts.ready alone can resolve before any font has been requested,
  // and text would then be measured in the fallback font.
  var loads = (B.fonts || []).map(function (f) { return document.fonts.load(f.weight + ' 40px "' + f.family + '"').catch(function () {}); });
  Promise.all(loads).then(function () { return document.fonts.ready; }).then(build, build);
})();
