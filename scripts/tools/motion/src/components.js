// Storyboard beat -> HTML. Markup only; all motion lives in runtime/engine.js.
import { mulberry32, hash } from "./dna.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const side = (v) => (typeof v === "string" ? { label: "", text: v } : { label: String(v?.label ?? ""), text: String(v?.text ?? "") });

/** Words as inline-block spans; the emphasis phrase gets class "em". */
function words(text, emphasis) {
  const t = String(text ?? "").trim(), e = String(emphasis ?? "").trim();
  const lo = t.toLowerCase(), at = e ? lo.indexOf(e.toLowerCase()) : -1;
  let pos = 0;
  return t.split(/\s+/).filter(Boolean).map((w) => {
    const start = t.indexOf(w, pos); pos = start + w.length;
    const em = at >= 0 && start >= at && start < at + e.length;
    return `<span class="w${em ? " em" : ""}">${esc(w)}</span>`;
  }).join(" ");
}
/** A checked text block: data-final is what must be on screen when the beat ends. */
const text = (tag, cls, level, value, inner) =>
  value ? `<${tag} class="${cls}" data-check="text" data-level="${level}" data-final="${esc(String(value).trim().replace(/\s+/g, " "))}">${inner ?? esc(value)}</${tag}>` : "";

export function formatNumber(v, decimals) {
  return Number(v).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
const decimalsOf = (v) => Math.min(3, (String(v).split(".")[1] ?? "").length);

const ICONS = {
  check: "M4 12.5l5 5L20 6.5", bolt: "M13 2L4 14h7l-1 8 9-12h-7z", shield: "M12 2l8 3v7c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5z",
  clock: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3.5 2", heart: "M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z",
  star: "M12 3l2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.2 6.4 20.3l1.2-6.3L3 9.6l6.3-.8z", globe: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3", chat: "M4 5h16v11H9l-5 4z", chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  rocket: "M12 2c4 3 5 8 4 12l-4 3-4-3c-1-4 0-9 4-12zM8 17l-2 4M16 17l2 4", cloud: "M7 18a4 4 0 010-8 5.5 5.5 0 0110.5 1.5A3.3 3.3 0 0117 18z",
};
const ICON_ORDER = Object.keys(ICONS);
const icon = (name) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${(ICONS[name] ?? ICONS.check)}"/></svg>`;

function decor(i, seed, shape) {
  const rnd = mulberry32(hash(`${seed}/decor/${i}`));
  const n = 3 + Math.floor(rnd() * 3);
  let out = "";
  for (let k = 0; k < n; k++) {
    // centred ON a frame edge, so shapes peek in from outside and never sit under the text block
    const edge = Math.floor(rnd() * 4), a = rnd() * 100, d = rnd() * 3 - 1.5;
    const [cx, cy] = edge === 0 ? [a, d] : edge === 1 ? [a, 100 + d] : edge === 2 ? [d, a] : [100 + d, a];
    const size = 7 + rnd() * 6, tone = ["var(--accent)", "var(--accent2)", "var(--primary)"][Math.floor(rnd() * 3)];
    out += `<i class="decor d-${shape}" data-layout-ignore style="left:calc(${cx.toFixed(1)}% - var(--u)*${(size / 2).toFixed(1)});top:calc(${cy.toFixed(1)}% - var(--u)*${(size / 2).toFixed(1)});width:calc(var(--u)*${size.toFixed(1)});height:calc(var(--u)*${size.toFixed(1)});--tone:${tone}"></i>`;
  }
  return out;
}

const RENDER = {
  "hero-title": (b) => text("h1", "hero fit", "hero", b.text, words(b.text, b.emphasis)),
  "kinetic-line": (b) => text("p", "headline fit", "headline", b.text, words(b.text, b.emphasis)),
  "stat-counter": (b) => {
    const dec = b.decimals ?? decimalsOf(b.value), final = `${b.prefix ?? ""}${formatNumber(b.value, dec)}${b.suffix ?? ""}`;
    return `<div class="stat"><div class="num fit" data-check="text" data-level="hero" data-final="${esc(final)}" data-value="${Number(b.value)}" data-decimals="${dec}" data-prefix="${esc(b.prefix ?? "")}" data-suffix="${esc(b.suffix ?? "")}">${esc(final)}</div>${text("div", "label", "body", b.label)}</div>`;
  },
  "list-reveal": (b) => `${text("h2", "title", "headline", b.title)}<ul class="list">${b.items.map((it) => `<li class="item"><span class="bullet"></span>${text("span", "itxt", "body", it)}</li>`).join("")}</ul>`,
  "split-compare": (b) => {
    const l = side(b.left), r = side(b.right);
    const panel = (s, cls) => `<div class="panel ${cls}">${text("div", "plabel", "caption", s.label)}${text("div", "ptext", "body", s.text)}</div>`;
    return `<div class="compare">${panel(l, "pl")}<div class="vs"></div>${panel(r, "pr")}</div>`;
  },
  chart: (b) => {
    const type = ["bar", "line", "ring"].includes(b.type) ? b.type : "bar", data = b.data.map((d) => ({ label: String(d.label ?? ""), value: Number(d.value) }));
    const max = Math.max(...data.map((d) => d.value), 1e-9), title = text("h2", "title", "headline", b.title);
    if (type === "ring") {
      const d = data[0], pct = Math.max(0, Math.min(100, d.value)), c = 2 * Math.PI * 42, dec = decimalsOf(d.value);
      return `${title}<div class="ringwrap"><svg class="ring" viewBox="0 0 100 100"><circle class="ring-bg" cx="50" cy="50" r="42"/><circle class="ring-fg" cx="50" cy="50" r="42" stroke-dasharray="${c.toFixed(2)}" data-len="${c.toFixed(2)}" data-pct="${pct}" transform="rotate(-90 50 50)"/></svg><div class="ringnum num" data-check="text" data-level="headline" data-final="${formatNumber(d.value, dec)}%" data-value="${d.value}" data-decimals="${dec}" data-prefix="" data-suffix="%">${formatNumber(d.value, dec)}%</div></div>${text("div", "label", "body", d.label)}`;
    }
    if (type === "line") {
      const pts = data.map((d, i) => `${(data.length === 1 ? 50 : (i / (data.length - 1)) * 100).toFixed(2)},${(100 - (d.value / max) * 92 - 4).toFixed(2)}`);
      return `${title}<div class="linewrap"><svg class="linechart" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline class="line-fg" points="${pts.join(" ")}" pathLength="1" vector-effect="non-scaling-stroke"/></svg></div><div class="xlabels">${data.map((d) => text("span", "xl", "caption", d.label)).join("")}</div>`;
    }
    return `${title}<div class="bars">${data.map((d) => `<div class="barcol"><div class="bval" data-check="text" data-level="caption" data-final="${esc(formatNumber(d.value, decimalsOf(d.value)))}">${esc(formatNumber(d.value, decimalsOf(d.value)))}</div><div class="bartrack"><div class="bar" style="height:${((d.value / max) * 100).toFixed(2)}%"></div></div>${text("div", "xl", "caption", d.label)}</div>`).join("")}</div>`;
  },
  quote: (b) => `<div class="qmark" data-layout-ignore>&ldquo;</div>${text("blockquote", "qtext fit", "headline", b.text, words(b.text, b.emphasis))}${text("div", "qby", "body", b.by)}`,
  steps: (b) => `${text("h2", "title", "headline", b.title)}<div class="steps"><div class="stepline"></div>${b.items.map((it, i) => `<div class="step item"><div class="stepnum">${i + 1}</div>${text("div", "steptxt", "body", it)}</div>`).join("")}</div>`,
  "icon-grid": (b) => `${text("h2", "title", "headline", b.title)}<div class="igrid n${b.items.length}">${b.items.map((it, i) => { const o = typeof it === "string" ? { label: it } : it; return `<div class="icell item">${icon(o.icon ?? ICON_ORDER[i % ICON_ORDER.length])}${text("div", "ilabel", "body", o.label)}</div>`; }).join("")}</div>`,
  "ui-pan": (b) => `<div class="uiframe"><div class="uibar"><i></i><i></i><i></i></div><div class="uiview">${b.image ? `<img class="uishot" src="${esc(b.image)}" alt="">` : `<div class="uishot uimock"><div class="m-h"></div><div class="m-row"><div class="m-card"></div><div class="m-card"></div><div class="m-card"></div></div><div class="m-l"></div><div class="m-l s"></div><div class="m-row"><div class="m-card tall"></div><div class="m-card tall"></div></div><div class="m-l"></div><div class="m-l s"></div></div>`}</div></div>${text("p", "caption-line", "body", b.text)}`,
  "lower-third": (b) => `${text("p", "headline fit", "headline", b.text, words(b.text, b.emphasis))}<div class="strap"><div class="strapbar"></div><div class="straptext">${text("div", "sname", "body", b.name)}${text("div", "stitle", "caption", b.title)}</div></div>`,
  "cta-card": (b) => `${text("h1", "headline fit", "headline", b.text, words(b.text, b.emphasis))}${b.button ? `<div class="btn">${text("span", "btntxt", "body", b.button)}</div>` : ""}`,
  "logo-sting": (b, sb) => `${b.logo ? `<img class="logo" src="${esc(b.logo)}" alt="">` : text("div", "brand fit", "hero", b.brand ?? sb.brand ?? "")}<div class="brandline"></div>${text("div", "tagline", "body", b.tagline)}`,
};

/** One beat -> a timed <section class="clip">. `tail` keeps it on screen under the next beat's transition. */
export function renderBeat(b, i, sb, { start, tail, dna }) {
  const inner = RENDER[b.component](b, sb);
  return `<section id="b${i}" class="clip beat c-${b.component} layout-${dna.layout}" data-start="${start}" data-duration="${+(b.seconds + tail).toFixed(3)}" data-track-index="${i % 2}" data-beat="${i}" style="z-index:${i + 1}">
  <div class="stage"><div class="bg" data-layout-ignore>${decor(i, dna.seed, dna.shape)}</div><div class="tex" data-layout-ignore></div><div class="amb"><div class="content">${inner}</div></div></div>
</section>`;
}
