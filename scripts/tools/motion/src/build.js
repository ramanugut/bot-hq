// DNA + storyboard -> a HyperFrames project folder (index.html + assets), ready to check and render.
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateDNA } from "./dna.js";
import { compileDNA } from "./compile.js";
import { validateStoryboard } from "./storyboard.js";
import { renderBeat } from "./components.js";
import { CSS, TEXTURE } from "./styles.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.join(here, "../fonts");
// gsap is already vendored for the promo engine; reuse that copy (override with BOTLY_GSAP).
const GSAP = process.env.BOTLY_GSAP || path.join(here, "../../promo/template/gsap.min.js");
const slug = (family) => family.toLowerCase().replace(/\s+/g, "-");

function fontFile(family, weight) {
  const file = `${slug(family)}-latin-${weight}-normal.woff2`;
  if (!existsSync(path.join(FONTS, file))) throw new Error(`font file missing: ${file}`);
  return { src: path.join(FONTS, file), file };
}

/** Resolve the style for a storyboard: sb.dna may be a full DNA, {seed}, or {seed, ...locks}. */
export function resolveDNA(sb, seedFallback = "botly") {
  const d = sb.dna ?? {};
  const { seed = seedFallback, ...locks } = d;
  return generateDNA(seed, locks);
}

export function composeHTML(sb, compiled) {
  const { dna, w, h, vars, fonts, tokens } = compiled;
  const tr = dna.transition === "cut" ? 0 : 0.5;
  let t = 0;
  const beats = sb.beats.map((b, i) => {
    const start = t; t += b.seconds;
    return { ...b, start, tail: i < sb.beats.length - 1 ? tr : 0 };
  });
  const total = t;
  const portrait = h >= w; // square stacks like portrait
  const faces = fonts.map((f) => `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:normal;font-display:block;src:url("assets/fonts/${fontFile(f.family, f.weight).file}") format("woff2")}`).join("\n");
  const rootVars = Object.entries({ ...vars, "--W": `${w}px`, "--H": `${h}px` }).map(([k, v]) => `${k}:${v}`).join(";");
  const sections = beats.map((b, i) => renderBeat(b, i, sb, { start: b.start, tail: b.tail, dna })).join("\n");
  const data = { seed: dna.seed, tokens, tr, portrait, fonts, beats: beats.map(({ component, start, seconds, tail }) => ({ component, start, seconds, tail })) };
  return {
    total,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${w}, height=${h}" />
<title>${String(sb.title ?? "Botly motion").replace(/[<&]/g, "")}</title>
<script src="assets/vendor/gsap.min.js"></script>
<style>
${faces}
:root{${rootVars}}
${CSS}
${TEXTURE[dna.texture] ?? ""}
</style>
</head>
<body>
<div id="root" class="${portrait ? "portrait" : "landscape"} shape-${dna.shape}" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${w}" data-height="${h}">
${sections}
</div>
<script>window.__BOTLY = ${JSON.stringify(data)};</script>
<script src="assets/engine.js"></script>
</body>
</html>
`,
  };
}

/** Write the project. Returns { dir, dna, compiled, total, validation }. Throws if the storyboard is invalid. */
export async function buildProject(sb, outDir, { seed } = {}) {
  const validation = validateStoryboard(sb);
  if (!validation.ok) { const e = new Error("Invalid storyboard:\n- " + validation.errors.join("\n- ")); e.validation = validation; throw e; }
  const dna = resolveDNA(sb, seed);
  const compiled = compileDNA(dna, sb.format);
  // Local images are copied into the project; nothing is fetched from the network at render time.
  await mkdir(path.join(outDir, "assets/media"), { recursive: true });
  sb = { ...sb, beats: await Promise.all(sb.beats.map(async (b, i) => {
    const out = { ...b };
    for (const key of ["image", "logo"]) {
      if (!b[key]) continue;
      if (/^https?:|^data:/.test(b[key])) throw new Error(`beat ${i + 1}: ${key} must be a local file path, not a URL`);
      if (!/\.(png|jpe?g|webp|svg)$/i.test(b[key]) || !existsSync(b[key])) throw new Error(`beat ${i + 1}: ${key} file not found or not an image: ${b[key]}`);
      const name = `${key}-${i}${path.extname(b[key]).toLowerCase()}`;
      await copyFile(b[key], path.join(outDir, "assets/media", name));
      out[key] = `assets/media/${name}`;
    }
    return out;
  })) };
  const { html, total } = composeHTML(sb, compiled);
  await mkdir(path.join(outDir, "assets/fonts"), { recursive: true });
  await mkdir(path.join(outDir, "assets/vendor"), { recursive: true });
  for (const f of compiled.fonts) { const { src, file } = fontFile(f.family, f.weight); await copyFile(src, path.join(outDir, "assets/fonts", file)); }
  await copyFile(GSAP, path.join(outDir, "assets/vendor/gsap.min.js"));
  await copyFile(path.join(here, "../runtime/engine.js"), path.join(outDir, "assets/engine.js"));
  await writeFile(path.join(outDir, "index.html"), html);
  await writeFile(path.join(outDir, "storyboard.json"), JSON.stringify({ ...sb, dna }, null, 2));
  await writeFile(path.join(outDir, "hyperframes.json"), JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, authoringSkill: "hyperframes" }, null, 2));
  return { dir: outDir, dna, compiled, total, validation };
}
