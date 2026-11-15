// OKLCH -> sRGB hex, and WCAG contrast. No dependencies.
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

function oklchToLinear(L, C, H) {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH (L 0..1, C 0..~0.37, H degrees) -> "#rrggbb". Chroma is reduced until the colour fits sRGB. */
export function oklch(L, C, H) {
  L = Math.min(1, Math.max(0, L));
  let rgb = oklchToLinear(L, C, H);
  for (let i = 0; i < 60 && rgb.some((x) => x < -0.0005 || x > 1.0005); i++) { C *= 0.94; rgb = oklchToLinear(L, C, H); }
  return "#" + rgb.map((x) => Math.round(255 * Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, x)))))).toString(16).padStart(2, "0")).join("");
}

export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Move lightness away from the background until the contrast ratio is met. Returns {hex, L}. */
export function ensureContrast({ L, C, H }, bgHex, min) {
  const dir = luminance(bgHex) > 0.18 ? -1 : 1; // light bg -> go darker
  let hex = oklch(L, C, H);
  for (let i = 0; i < 80 && contrast(hex, bgHex) < min; i++) { L = Math.min(1, Math.max(0, L + dir * 0.012)); hex = oklch(L, C, H); }
  return { hex, L };
}
