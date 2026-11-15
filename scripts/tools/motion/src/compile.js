// Style DNA -> palette, fonts, CSS variables and motion tokens.
import { oklch, contrast, ensureContrast } from "./color.js";

export const FORMATS = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] };

// display [family, weight], body [family, regular, bold]. All from @fontsource (open licences).
export const TYPE = {
  grotesque: { scale: 1, display: ["Inter", 900], body: ["Inter", 400, 700], tracking: "-0.035em" },
  "geo-mono": { scale: 0.98, display: ["Space Grotesk", 700], body: ["JetBrains Mono", 400, 700], tracking: "-0.03em" },
  condensed: { scale: 1.18, display: ["Anton", 400], body: ["Inter", 400, 700], tracking: "0em", upper: true },
  "heavy-mono": { scale: 0.92, display: ["Archivo Black", 400], body: ["Space Mono", 400, 700], tracking: "-0.02em", upper: true },
  humanist: { display: ["DM Sans", 800], body: ["DM Sans", 400, 700], tracking: "-0.03em" },
  "serif-sans": { scale: 1.1, display: ["Instrument Serif", 400], body: ["Inter", 400, 700], tracking: "-0.02em" },
  "contrast-serif": { display: ["Playfair Display", 700], body: ["DM Sans", 400, 700], tracking: "-0.015em" },
  wide: { scale: 0.8, display: ["Unbounded", 700], body: ["Inter", 400, 700], tracking: "-0.02em" },
  rounded: { display: ["Fredoka", 600], body: ["Nunito", 400, 700], tracking: "-0.01em" },
  handwritten: { scale: 1.3, display: ["Caveat", 700], body: ["DM Sans", 400, 700], tracking: "0em" },
  "mono-only": { scale: 0.86, display: ["JetBrains Mono", 700], body: ["JetBrains Mono", 400, 700], tracking: "-0.04em" },
  characterful: { display: ["Bricolage Grotesque", 800], body: ["Inter", 400, 700], tracking: "-0.03em" },
};

// GSAP ease names are exact. exitEase is the matching ".in"; exit time is 60% of enter time.
export const MOTION = {
  snappy: { ease: "power4.out", exitEase: "power4.in", dur: 0.45, stagger: 0.04 },
  smooth: { ease: "power3.out", exitEase: "power3.in", dur: 0.7, stagger: 0.08 },
  bouncy: { ease: "back.out(1.7)", exitEase: "back.in(1.7)", dur: 0.6, stagger: 0.06 },
  elegant: { ease: "expo.out", exitEase: "expo.in", dur: 1.0, stagger: 0.12 },
  mechanical: { ease: "power1.inOut", exitEase: "power1.in", dur: 0.4, stagger: 0.05 },
  glitchy: { ease: "steps(4)", exitEase: "steps(4)", dur: 0.25, stagger: 0.03 },
  organic: { ease: "sine.inOut", exitEase: "sine.in", dur: 0.9, stagger: 0.1 },
  heavy: { ease: "power4.inOut", exitEase: "power4.in", dur: 0.8, stagger: 0.07 },
};

const RADIUS = { sharp: "0px", rounded: "calc(var(--u) * 2.2)", blob: "calc(var(--u) * 4.5)", line: "calc(var(--u) * 0.6)", chunky: "0px", isometric: "calc(var(--u) * 0.5)", "hand-drawn": "255px 18px 225px 18px / 18px 225px 18px 255px", pixel: "0px" };

const SCHEME_OFFSET = { monochrome: [0, 0], analogous: [30, -30], complementary: [180, 180], "split-complementary": [150, 210], triadic: [120, 240], duotone: [150, 150], "neutral-accent": [0, 0], "neon-on-black": [90, 180] };

export function buildPalette(dna) {
  const H = dna.hue, [o1, o2] = SCHEME_OFFSET[dna.scheme];
  const neon = dna.scheme === "neon-on-black", neutral = dna.scheme === "neutral-accent";
  const bgC = neutral ? 0.004 : null;
  let bg;
  if (dna.tone === "dark") bg = { L: neon ? 0.12 : 0.17, C: bgC ?? (neon ? 0.02 : 0.028), H };
  else if (dna.tone === "light") bg = { L: 0.965, C: bgC ?? 0.014, H };
  else bg = { L: 0.62, C: neutral ? 0.02 : 0.15, H };
  const bgHex = oklch(bg.L, bg.C, bg.H);
  const lightText = oklch(0.975, 0.008, H), darkText = oklch(0.17, 0.02, H);
  const text = contrast(lightText, bgHex) >= contrast(darkText, bgHex) ? lightText : darkText;
  const onDark = text === lightText;
  const surfL = dna.tone === "dark" ? bg.L + 0.06 : dna.tone === "light" ? bg.L - 0.05 : bg.L + (onDark ? -0.09 : 0.09);
  const surface = oklch(surfL, bg.C * (dna.tone === "colour" ? 0.9 : 1.2), H);
  const baseL = onDark ? 0.78 : 0.52, C = neon ? 0.27 : 0.2;
  let primary, accent;
  if (dna.tone === "colour") primary = { L: onDark ? 0.93 : 0.22, C: 0.06, H };
  else if (neutral) primary = { L: onDark ? 0.82 : 0.3, C: 0.012, H };
  else primary = { L: baseL, C, H };
  if (dna.scheme === "monochrome") accent = { L: onDark ? 0.86 : 0.42, C: dna.tone === "colour" ? 0.1 : 0.17, H };
  else accent = { L: baseL, C: C + 0.02, H: (H + o1) % 360 };
  const accent2 = { L: baseL, C, H: (H + o2 + 360) % 360 };
  const fix = (c) => ensureContrast(c, bgHex, 3).hex;
  const p = { bg: bgHex, surface, text, primary: fix(primary), accent: fix(accent), accent2: fix(accent2) };
  // text that sits ON an accent block (buttons, straps)
  p.onAccent = contrast(lightText, p.accent) >= contrast(darkText, p.accent) ? lightText : darkText;
  p.onSurface = contrast(lightText, p.surface) >= contrast(darkText, p.surface) ? lightText : darkText;
  p.muted = ensureContrast({ L: onDark ? 0.74 : 0.42, C: 0.02, H }, bgHex, 4.5).hex;
  return p;
}

export function compileDNA(dna, format = "16:9") {
  const [w, h] = FORMATS[format] ?? FORMATS["16:9"];
  const palette = buildPalette(dna);
  const type = TYPE[dna.type];
  const u = Math.min(w, h) / 100;
  const vars = {
    "--u": `${u}px`, "--bg": palette.bg, "--surface": palette.surface, "--text": palette.text, "--primary": palette.primary,
    "--accent": palette.accent, "--accent2": palette.accent2, "--on-accent": palette.onAccent, "--on-surface": palette.onSurface, "--muted": palette.muted,
    "--font-display": `"${type.display[0]}"`, "--font-body": `"${type.body[0]}"`, "--w-display": type.display[1],
    "--w-body": type.body[1], "--w-bold": type.body[2], "--tracking": type.tracking, "--upper": type.upper ? "uppercase" : "none",
    "--radius": RADIUS[dna.shape], "--ts": type.scale ?? 1,
    // safe area: 7.5% each side (stays over 6% under the 3% ambient scale); 9:16 keeps app buttons clear
    "--mx": `${(w * 0.075).toFixed(1)}px`, "--mt": `${(h * (h > w ? 0.13 : 0.075)).toFixed(1)}px`, "--mb": `${(h * (h > w ? 0.21 : 0.075)).toFixed(1)}px`,
  };
  const fonts = [];
  const add = (family, weight) => { if (!fonts.some((f) => f.family === family && f.weight === weight)) fonts.push({ family, weight }); };
  add(type.display[0], type.display[1]); add(type.body[0], type.body[1]); add(type.body[0], type.body[2]);
  const m = MOTION[dna.motion];
  const tokens = { ...m, exitDur: +(m.dur * 0.6).toFixed(3), personality: dna.motion, transition: dna.transition, u, w, h };
  return { dna, format, w, h, palette, vars, fonts, tokens };
}
