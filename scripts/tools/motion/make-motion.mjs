#!/usr/bin/env node
/* Botly Motion Engine: a motion graphics video from a storyboard (JSON), rendered from code.

  node scripts/tools/motion/make-motion.mjs --spec storyboard.json --out /path/video.mp4
  node scripts/tools/motion/make-motion.mjs --spec storyboard.json --check          (rules only, no render)
  node scripts/tools/motion/make-motion.mjs --spec storyboard.json --preview DIR     (one PNG per beat)
  node scripts/tools/motion/make-motion.mjs --dna my-seed                            (print the style for a seed)

Storyboard: { format: "9:16"|"16:9"|"1:1", brand?, style?, dna?: {seed, ...locked axes}, beats: [...] }
  style: a preset name (see --styles) or omit; dna.seed picks every axis that is not locked.
  The same seed always gives the same style. See docs/MOTION-ENGINE.md for components and rules.
Options: --quality draft|standard|high   --deep (also run `hyperframes check`)   --keep (keep build folder)
         --no-snap (do not round beat lengths to the 0.5 s grid)   --json (machine-readable result)
Exit codes: 0 ok, 2 the storyboard broke a rule (fix the storyboard), 1 anything else. */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateDNA, PRESETS, AXES, lockConflicts, cleanLocks } from "./src/dna.js";
import { snapStoryboard } from "./src/storyboard.js";
import { buildProject } from "./src/build.js";
import { qualityGate, preview, render } from "./src/checks.js";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const json = flag("json");
const say = (o, text) => console.log(json ? JSON.stringify(o) : text);
function fail(code, message, extra = {}) { if (json) console.log(JSON.stringify({ ok: false, message, ...extra })); else console.error("make-motion: " + message); process.exit(code); }

if (flag("styles")) { say({ presets: PRESETS, axes: AXES }, "Presets: " + Object.keys(PRESETS).join(", ") + "\nAxes:\n" + Object.entries(AXES).map(([k, v]) => `  ${k}: ${v.join(" | ")}`).join("\n") + "\n  hue: 0-345 in steps of 15"); process.exit(0); }
if (opt("dna")) { const d = generateDNA(opt("dna")); say(d, JSON.stringify(d, null, 2)); process.exit(0); }
if (!opt("spec")) fail(1, "give --spec storyboard.json (or --dna SEED, or --styles). See the header of this file.");

let sb;
try { sb = JSON.parse(opt("spec") === "-" ? await readFile(0, "utf8") : await readFile(opt("spec"), "utf8")); } catch (e) { fail(1, "could not read the storyboard: " + e.message); }
const ALIAS = { portrait: "9:16", vertical: "9:16", reel: "9:16", story: "9:16", square: "1:1", feed: "1:1", landscape: "16:9", horizontal: "16:9", youtube: "16:9", wide: "16:9" };
sb.format = ALIAS[String(sb.format ?? "").toLowerCase()] ?? sb.format ?? "9:16"; // same default and aliases as the promo engine
if (!flag("no-snap")) sb = snapStoryboard(sb);
// style: preset name -> locked axes; anything in dna overrides the preset.
if (sb.style && sb.style !== "auto") {
  if (!PRESETS[sb.style]) fail(2, `unknown style "${sb.style}". Presets: ${Object.keys(PRESETS).join(", ")}`);
  sb.dna = { ...PRESETS[sb.style], ...(sb.dna ?? {}) };
}
sb.dna = { seed: String(sb.dna?.seed ?? sb.brand ?? "botly"), ...(sb.dna ?? {}) };
const conflicts = lockConflicts(cleanLocks(sb.dna));
if (conflicts.length) fail(2, "these style choices do not go together: " + conflicts.map((c) => `${c.axis}=${c.value} needs ${c.conflictsWith} to be one of ${c.allowed.join("/")} (got ${c.has})`).join("; "));

const dir = await mkdtemp(path.join(tmpdir(), "motion-"));
const cleanup = async () => { if (!flag("keep")) await rm(dir, { recursive: true, force: true }); };
try {
  let built;
  try { built = await buildProject(sb, dir); }
  catch (e) { await cleanup(); fail(e.validation ? 2 : 1, e.message, e.validation ? { failures: e.validation.errors } : {}); }
  const gate = await qualityGate(dir, sb, built.compiled, { deep: flag("deep") });
  const lines = [...gate.failures.map((f) => `FAIL ${f.code}: ${f.message}`), ...gate.warnings.map((w) => `warn ${w.code}: ${w.message}`)];
  if (!gate.pass) { await cleanup(); fail(2, "the video broke these rules, fix the storyboard and try again:\n" + lines.join("\n"), { failures: gate.failures, warnings: gate.warnings, dna: built.dna }); }
  const result = { ok: true, dna: built.dna, seconds: built.total, format: sb.format, warnings: gate.warnings, ...(flag("keep") ? { build: dir } : {}) };
  if (flag("check")) { say(result, `OK: ${sb.beats.length} beats, ${built.total}s, style ${JSON.stringify(built.dna)}\n${lines.join("\n")}`); }
  else if (opt("preview")) { await preview(dir, sb, path.resolve(opt("preview"))); say({ ...result, preview: path.resolve(opt("preview")) }, `Stills saved in ${path.resolve(opt("preview"))}`); }
  else {
    if (!opt("out")) fail(1, "give --out video.mp4 (or --check / --preview DIR)");
    const out = path.resolve(opt("out"));
    await render(dir, out, { quality: opt("quality") ?? "standard" });
    say({ ...result, out }, `Rendered ${out} (${built.total}s, ${sb.format})\n${lines.join("\n")}`);
  }
  await cleanup();
} catch (e) { await cleanup(); fail(1, e.message); }
