// Storyboard: validation, beat-grid snapping and a no-model fallback.
export const COMPONENTS = ["hero-title", "kinetic-line", "stat-counter", "list-reveal", "split-compare", "chart", "quote", "steps", "icon-grid", "ui-pan", "lower-third", "cta-card", "logo-sting"];
export const LIMITS = { wordsPerBeat: 12, wordsPerHero: 7, minSeconds: 2, maxSeconds: 4, minLastSeconds: 2.5 };

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const wordCount = (s) => str(s).trim().split(/\s+/).filter(Boolean).length;
const side = (v) => (typeof v === "string" ? { label: "", text: v } : { label: str(v?.label), text: str(v?.text) });

/** Every piece of on-screen text in a beat, for word counts and checks. */
export function beatTexts(b) {
  switch (b.component) {
    case "stat-counter": return [str(b.label)];
    case "list-reveal": case "steps": return [str(b.title), ...(b.items ?? []).map(str)];
    case "icon-grid": return [str(b.title), ...(b.items ?? []).map((i) => str(i?.label ?? i))];
    case "split-compare": return [side(b.left).label, side(b.left).text, side(b.right).label, side(b.right).text];
    case "chart": return [str(b.title), ...(b.data ?? []).map((d) => str(d.label))];
    case "quote": return [str(b.text), str(b.by)];
    case "lower-third": return [str(b.text), str(b.name), str(b.title)];
    case "cta-card": return [str(b.text), str(b.button)];
    case "logo-sting": return [str(b.brand), str(b.tagline)];
    case "ui-pan": return [str(b.text)];
    default: return [str(b.text)];
  }
}
export const beatWords = (b) => beatTexts(b).reduce((n, t) => n + wordCount(t), 0);

const REQUIRED = {
  "hero-title": (b) => (str(b.text).trim() ? true : "needs text"),
  "kinetic-line": (b) => (str(b.text).trim() ? true : "needs text"),
  "stat-counter": (b) => (Number.isFinite(Number(b.value)) ? true : "needs a numeric value"),
  "list-reveal": (b) => (Array.isArray(b.items) && b.items.length >= 2 && b.items.length <= 5 ? true : "needs 2 to 5 items"),
  "split-compare": (b) => (b.left && b.right ? true : "needs left and right"),
  chart: (b) => (Array.isArray(b.data) && b.data.length >= 1 && b.data.length <= 6 && b.data.every((d) => Number.isFinite(Number(d.value))) ? true : "needs data: 1 to 6 {label, value}"),
  quote: (b) => (str(b.text).trim() ? true : "needs text"),
  steps: (b) => (Array.isArray(b.items) && b.items.length >= 2 && b.items.length <= 5 ? true : "needs 2 to 5 items"),
  "icon-grid": (b) => (Array.isArray(b.items) && b.items.length >= 2 && b.items.length <= 6 ? true : "needs 2 to 6 items"),
  "ui-pan": () => true,
  "lower-third": (b) => (str(b.name).trim() ? true : "needs name"),
  "cta-card": (b) => (str(b.text).trim() ? true : "needs text"),
  "logo-sting": () => true,
};

/** Returns { ok, errors[], warnings[] }. Errors block a render; warnings are reported. */
export function validateStoryboard(sb) {
  const errors = [], warnings = [];
  if (!sb || typeof sb !== "object") return { ok: false, errors: ["storyboard is not an object"], warnings };
  if (!["16:9", "9:16", "1:1"].includes(sb.format)) errors.push(`format must be 16:9, 9:16 or 1:1 (got ${sb.format})`);
  if (!Array.isArray(sb.beats) || sb.beats.length < 1) return { ok: false, errors: [...errors, "beats must be a non-empty list"], warnings };
  let total = 0;
  sb.beats.forEach((b, i) => {
    const at = `beat ${i + 1}`;
    if (!COMPONENTS.includes(b.component)) { errors.push(`${at}: unknown component "${b.component}"`); return; }
    const need = REQUIRED[b.component](b);
    if (need !== true) errors.push(`${at} (${b.component}): ${need}`);
    const s = Number(b.seconds), min = i === sb.beats.length - 1 ? LIMITS.minLastSeconds : LIMITS.minSeconds; // the closing line needs time to be read
    if (!Number.isFinite(s)) errors.push(`${at}: seconds missing`);
    else {
      if (s < min || s > LIMITS.maxSeconds) errors.push(`${at}: ${s}s is outside ${min}-${LIMITS.maxSeconds}s`);
      if (Math.abs(s * 2 - Math.round(s * 2)) > 1e-6) errors.push(`${at}: ${s}s is not a multiple of 0.5`);
      total += s;
    }
    if (i > 0 && sb.beats[i - 1].component === b.component) errors.push(`${at}: same component as the beat before (${b.component})`);
    const words = beatWords(b);
    if (b.component === "hero-title" && words > LIMITS.wordsPerHero) errors.push(`${at}: hero has ${words} words (max ${LIMITS.wordsPerHero})`);
    else if (words > LIMITS.wordsPerBeat + (["list-reveal", "steps", "icon-grid", "split-compare", "chart"].includes(b.component) ? 6 : 0)) errors.push(`${at}: ${words} words on screen is too many`);
    if (Number.isFinite(s) && s < 0.5 + 0.3 * words) warnings.push(`${at}: ${words} words in ${s}s is a short read (needs about ${(0.5 + 0.3 * words).toFixed(1)}s)`);
    if (b.emphasis && !str(b.text).toLowerCase().includes(str(b.emphasis).toLowerCase())) warnings.push(`${at}: emphasis "${b.emphasis}" is not in the text`);
  });
  if (Number.isFinite(Number(sb.duration)) && Math.abs(total - Number(sb.duration)) > 1e-6) errors.push(`beats add up to ${total}s but duration is ${sb.duration}s`);
  return { ok: errors.length === 0, errors, warnings };
}

/** Snap every beat to the BPM half-beat grid and clamp to the limits; duration becomes the sum. */
export function snapStoryboard(sb) {
  const grid = 0.5;
  const beats = (sb.beats ?? []).map((b, i, all) => {
    const min = i === all.length - 1 ? LIMITS.minLastSeconds : LIMITS.minSeconds;
    const s = Math.min(LIMITS.maxSeconds, Math.max(min, Math.round((Number(b.seconds) || 3) / grid) * grid));
    return { ...b, seconds: s };
  });
  return { ...sb, bpm: sb.bpm ?? 120, beats, duration: beats.reduce((n, b) => n + b.seconds, 0) };
}

/** No-model fallback: build a valid storyboard from the brief's own words. */
export function fallbackStoryboard(brief, { format = "16:9", brand = "" } = {}) {
  const clip = (s, n) => str(s).trim().split(/\s+/).slice(0, n).join(" ").replace(/[,;:\-–]+$/, "");
  const parts = str(brief).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim().replace(/[.!]+$/, "")).filter(Boolean);
  const hook = clip(parts[0] ?? brand ?? "Hello", 7);
  const beats = [{ component: "hero-title", seconds: 3, text: hook }];
  const rest = parts.slice(1);
  if (rest.length >= 3) beats.push({ component: "list-reveal", seconds: 4, items: rest.slice(0, 4).map((s) => clip(s, 4)) });
  else if (rest.length) rest.forEach((s, i) => beats.push({ component: i % 2 ? "quote" : "kinetic-line", seconds: 3, text: clip(s, 12) }));
  beats.push({ component: "logo-sting", seconds: 2.5, brand: brand || clip(parts[0] ?? "", 3) });
  return snapStoryboard({ format, brand, beats });
}
