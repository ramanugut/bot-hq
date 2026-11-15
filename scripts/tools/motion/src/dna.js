// Style DNA: a seed (any string) -> one style, always the same one.
export const AXES = {
  scheme: ["monochrome", "analogous", "complementary", "split-complementary", "triadic", "duotone", "neutral-accent", "neon-on-black"],
  tone: ["dark", "light", "colour"],
  type: ["grotesque", "geo-mono", "condensed", "heavy-mono", "humanist", "serif-sans", "contrast-serif", "wide", "rounded", "handwritten", "mono-only", "characterful"],
  shape: ["sharp", "rounded", "blob", "line", "chunky", "isometric", "hand-drawn", "pixel"],
  motion: ["snappy", "smooth", "bouncy", "elegant", "mechanical", "glitchy", "organic", "heavy"],
  texture: ["flat", "grain", "paper", "mesh", "glass", "scanline"],
  layout: ["centred", "editorial", "grid", "split", "full-bleed", "cards"],
  transition: ["cut", "wipe", "push", "zoom", "mask", "morph", "blur", "glitch"],
};

// Compatibility: if axis A has value V, axis B must be one of these.
export const RULES = [
  ["scheme", "neon-on-black", "tone", ["dark"]],
  ["motion", "glitchy", "tone", ["dark"]],
  ["motion", "glitchy", "texture", ["flat", "scanline"]],
  ["motion", "elegant", "transition", ["wipe", "blur", "morph", "push"]],
  ["motion", "elegant", "type", ["serif-sans", "contrast-serif", "grotesque", "humanist"]],
  ["type", "handwritten", "shape", ["hand-drawn", "blob", "rounded"]],
  ["type", "mono-only", "shape", ["sharp", "pixel", "line"]],
  ["texture", "glass", "tone", ["dark", "colour"]],
  ["texture", "glass", "shape", ["rounded", "blob", "line"]],
  ["transition", "glitch", "motion", ["glitchy", "snappy", "mechanical"]],
];

export const PRESETS = {
  "swiss-minimal": { scheme: "neutral-accent", tone: "light", type: "grotesque", shape: "sharp", motion: "smooth", texture: "flat", layout: "grid", transition: "push" },
  "bold-kinetic": { scheme: "duotone", tone: "colour", type: "condensed", shape: "chunky", motion: "snappy", texture: "flat", layout: "full-bleed", transition: "cut" },
  "neo-brutalist": { scheme: "complementary", tone: "light", type: "heavy-mono", shape: "chunky", motion: "mechanical", texture: "flat", layout: "grid", transition: "cut" },
  "dark-tech": { scheme: "neon-on-black", tone: "dark", type: "geo-mono", shape: "line", motion: "snappy", texture: "scanline", layout: "editorial", transition: "glitch" },
  "glass-ui": { scheme: "analogous", tone: "dark", type: "humanist", shape: "rounded", motion: "smooth", texture: "glass", layout: "cards", transition: "blur" },
  "corporate-clean": { scheme: "neutral-accent", tone: "light", type: "humanist", shape: "rounded", motion: "smooth", texture: "flat", layout: "centred", transition: "wipe" },
  editorial: { scheme: "monochrome", tone: "light", type: "serif-sans", shape: "sharp", motion: "elegant", texture: "paper", layout: "editorial", transition: "wipe" },
  luxury: { scheme: "monochrome", tone: "dark", type: "contrast-serif", shape: "line", motion: "elegant", texture: "grain", layout: "centred", transition: "blur" },
  synthwave: { scheme: "triadic", tone: "dark", type: "wide", shape: "pixel", motion: "smooth", texture: "scanline", layout: "centred", transition: "zoom" },
  "memphis-pop": { scheme: "triadic", tone: "light", type: "rounded", shape: "blob", motion: "bouncy", texture: "flat", layout: "centred", transition: "mask" },
  "flat-explainer": { scheme: "analogous", tone: "light", type: "rounded", shape: "rounded", motion: "bouncy", texture: "flat", layout: "split", transition: "push" },
  "isometric-data": { scheme: "split-complementary", tone: "dark", type: "geo-mono", shape: "isometric", motion: "mechanical", texture: "flat", layout: "grid", transition: "push" },
  doodle: { scheme: "neutral-accent", tone: "light", type: "handwritten", shape: "hand-drawn", motion: "organic", texture: "paper", layout: "centred", transition: "mask" },
  aurora: { scheme: "analogous", tone: "dark", type: "geo-mono", shape: "blob", motion: "organic", texture: "mesh", layout: "centred", transition: "morph" },
  "glitch-cyber": { scheme: "complementary", tone: "dark", type: "mono-only", shape: "sharp", motion: "glitchy", texture: "scanline", layout: "editorial", transition: "glitch" },
  terminal: { scheme: "monochrome", tone: "dark", type: "mono-only", shape: "pixel", motion: "mechanical", texture: "flat", layout: "editorial", transition: "cut" },
};

export function hash(str) {
  let h = 2166136261;
  for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Drop unknown axes / values (e.g. from a model reply). Returns only usable locks. */
export function cleanLocks(input = {}) {
  const locks = {};
  for (const axis in AXES) if (AXES[axis].includes(input[axis])) locks[axis] = input[axis];
  const hue = Number(input.hue);
  if (input.hue !== null && input.hue !== undefined && Number.isFinite(hue)) locks.hue = ((Math.round(hue / 15) * 15) % 360 + 360) % 360;
  return locks;
}

/** Two locks that contradict a compatibility rule. Show these to the user instead of overriding. */
export function lockConflicts(locks = {}) {
  return RULES.filter(([a, v, b, allowed]) => locks[a] === v && locks[b] !== undefined && !allowed.includes(locks[b]))
    .map(([a, v, b, allowed]) => ({ axis: a, value: v, conflictsWith: b, has: locks[b], allowed }));
}

function repair(dna, locks, pick) {
  for (let pass = 0, changed = true; changed && pass < 20; pass++) {
    changed = false;
    for (const [a, v, b, allowed] of RULES)
      if (dna[a] === v && !allowed.includes(dna[b])) {
        if (locks[b] === undefined) { dna[b] = pick(allowed); changed = true; }
        else if (locks[a] === undefined) { dna[a] = pick(AXES[a].filter((x) => x !== v)); changed = true; }
      }
  }
  return dna;
}

export function violations(dna) {
  return RULES.filter(([a, v, b, allowed]) => dna[a] === v && !allowed.includes(dna[b]));
}

export function generateDNA(seed, locks = {}) {
  locks = cleanLocks(locks);
  const rnd = mulberry32(hash(seed));
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const dna = { seed: String(seed), hue: locks.hue ?? Math.floor(rnd() * 24) * 15 };
  for (const axis in AXES) dna[axis] = locks[axis] ?? pick(AXES[axis]);
  return repair(dna, locks, pick);
}

/** "Remix": change exactly one axis (not in `keep`), keep the rest unless a rule forces a repair. */
export function remixDNA(dna, remixSeed, keep = []) {
  const seed = dna.seed + "/" + remixSeed;
  const rnd = mulberry32(hash(seed));
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const free = [...Object.keys(AXES), "hue"].filter((a) => !keep.includes(a));
  const axis = pick(free);
  const out = { ...dna, seed };
  if (axis === "hue") out.hue = (dna.hue + 15 * (1 + Math.floor(rnd() * 23))) % 360;
  else out[axis] = pick(AXES[axis].filter((x) => x !== dna[axis]));
  const locks = { [axis]: out[axis] };
  for (const k of keep) locks[k] = dna[k];
  return repair(out, locks, pick);
}
