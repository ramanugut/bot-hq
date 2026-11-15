// node --test scripts/tools/motion/test/   (no browser needed; the page checks are covered by make-motion.mjs --check)
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AXES, PRESETS, generateDNA, remixDNA, violations, lockConflicts, cleanLocks } from "../src/dna.js";
import { compileDNA, MOTION, TYPE } from "../src/compile.js";
import { contrast, oklch } from "../src/color.js";
import { validateStoryboard, snapStoryboard, fallbackStoryboard, COMPONENTS } from "../src/storyboard.js";
import { buildProject } from "../src/build.js";
import { staticChecks } from "../src/checks.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const example = async (name) => JSON.parse(await readFile(path.join(here, "../examples", name), "utf8"));

test("the style space is the size the spec says", () => {
  const n = Object.values(AXES).reduce((a, v) => a * v.length, 1) * 24;
  assert.equal(n, 127401984);
});

test("same seed, same style; different seeds differ", () => {
  assert.deepEqual(generateDNA("mumatec-promo-1"), generateDNA("mumatec-promo-1"));
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(JSON.stringify({ ...generateDNA("s" + i), seed: 0 }));
  assert.ok(seen.size > 1990);
});

test("no seed ever breaks a compatibility rule, with or without locks or a remix", () => {
  for (let i = 0; i < 5000; i++) {
    const d = generateDNA("seed-" + i);
    assert.equal(violations(d).length, 0);
    assert.equal(violations(remixDNA(d, "r" + i)).length, 0);
    assert.equal(violations(generateDNA("seed-" + i, { motion: "elegant", hue: 210 })).length, 0);
  }
});

test("locks are kept, junk locks are dropped, conflicting locks are reported", () => {
  const d = generateDNA("x", { type: "grotesque", hue: 213, shape: "nonsense", extra: 1 });
  assert.equal(d.type, "grotesque"); assert.equal(d.hue, 210); assert.ok(AXES.shape.includes(d.shape));
  assert.deepEqual(cleanLocks({ hue: null, tone: null }), {});
  assert.equal(lockConflicts({ scheme: "neon-on-black", tone: "light" }).length, 1);
  assert.equal(lockConflicts({ scheme: "neon-on-black" }).length, 0);
});

test("a remix changes one axis and keeps the ones asked for", () => {
  const d = generateDNA("brand");
  const r = remixDNA(d, 1, ["hue", "type"]);
  assert.equal(r.hue, d.hue); assert.equal(r.type, d.type);
  assert.notDeepEqual({ ...r, seed: 0 }, { ...d, seed: 0 });
});

test("every preset is valid and rule-clean", () => {
  for (const [name, p] of Object.entries(PRESETS)) {
    for (const axis in AXES) assert.ok(AXES[axis].includes(p[axis]), `${name}.${axis}`);
    assert.equal(violations(p).length, 0, name);
    assert.equal(lockConflicts(p).length, 0, name);
  }
});

test("every style keeps readable contrast, in every format", () => {
  for (let i = 0; i < 3000; i++) {
    const c = compileDNA(generateDNA("c" + i), ["16:9", "9:16", "1:1"][i % 3]), p = c.palette;
    assert.ok(contrast(p.text, p.bg) >= 4.5, `text ${JSON.stringify(c.dna)}`);
    assert.ok(contrast(p.accent, p.bg) >= 3, `accent ${JSON.stringify(c.dna)}`);
    assert.ok(contrast(p.onAccent, p.accent) >= 4.5, `onAccent ${JSON.stringify(c.dna)}`);
    assert.ok(contrast(p.onSurface, p.surface) >= 4.5, `onSurface ${JSON.stringify(c.dna)}`);
    for (const k of ["bg", "surface", "text", "primary", "accent", "accent2", "onAccent", "muted"]) assert.match(p[k], /^#[0-9a-f]{6}$/);
  }
});

test("no motion personality uses a linear ease; exits are 60% of entrances", () => {
  for (const m of Object.values(MOTION)) { assert.doesNotMatch(m.ease, /^(none|linear)/); assert.doesNotMatch(m.exitEase, /^(none|linear)/); }
  const t = compileDNA(generateDNA("x", { motion: "elegant" })).tokens;
  assert.equal(t.exitDur, 0.6);
  assert.equal(Object.keys(TYPE).length, AXES.type.length);
});

test("oklch stays in sRGB", () => {
  assert.equal(oklch(1, 0, 0), "#ffffff"); assert.equal(oklch(0, 0, 0), "#000000");
  assert.match(oklch(0.7, 0.4, 150), /^#[0-9a-f]{6}$/);
});

test("the examples are valid storyboards", async () => {
  for (const f of ["demo-15s.json", "all-components.json"]) { const v = validateStoryboard(await example(f)); assert.deepEqual(v.errors, [], f); }
  assert.deepEqual([...new Set((await example("all-components.json")).beats.map((b) => b.component))].sort(), [...COMPONENTS].sort());
});

test("the validator catches the rule breaks a model is likely to make", () => {
  const base = { format: "9:16", duration: 5.5, beats: [{ component: "hero-title", seconds: 3, text: "Short and bold" }, { component: "logo-sting", seconds: 2.5 }] };
  assert.equal(validateStoryboard(base).ok, true);
  const bad = (change, re) => { const sb = structuredClone(base); change(sb); const v = validateStoryboard(sb); assert.equal(v.ok, false); assert.match(v.errors.join("\n"), re); };
  bad((s) => (s.beats[0].component = "explosion"), /unknown component/);
  bad((s) => (s.beats[0].text = "one two three four five six seven eight"), /hero has 8 words/);
  bad((s) => (s.beats[0].seconds = 2.3), /multiple of 0.5/);
  bad((s) => (s.beats[0].seconds = 9), /outside/);
  bad((s) => (s.beats[1].seconds = 2), /outside 2.5/);
  bad((s) => (s.duration = 99), /add up to/);
  bad((s) => (s.format = "4:3"), /format/);
  bad((s) => s.beats.splice(1, 0, { component: "hero-title", seconds: 2, text: "Again" }), /same component/);
  bad((s) => (s.beats[0] = { component: "stat-counter", seconds: 3, value: "lots" }), /numeric value/);
  bad((s) => (s.beats[0] = { component: "list-reveal", seconds: 3, items: ["only one"] }), /2 to 5 items/);
});

test("snapping puts beats on the half-second grid and fixes the duration", () => {
  const s = snapStoryboard({ format: "1:1", beats: [{ component: "hero-title", seconds: 2.7, text: "Hi" }, { component: "logo-sting", seconds: 1 }] });
  assert.deepEqual(s.beats.map((b) => b.seconds), [2.5, 2.5]); assert.equal(s.duration, 5);
  assert.equal(validateStoryboard(s).ok, true);
});

test("the fallback storyboard is always valid", () => {
  for (const brief of ["", "One line only", "Fast hosting. Free SSL. Daily backups. Local support. Order today.", "A very long single sentence that goes on and on with far too many words for any hero title to hold"]) {
    const v = validateStoryboard(fallbackStoryboard(brief, { brand: "Botly" }));
    assert.deepEqual(v.errors, [], brief);
  }
});

test("a project builds: one timed clip per beat, fonts and scripts local, nothing from the network", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "motion-test-"));
  try {
    const sb = await example("all-components.json");
    const r = await buildProject(sb, dir);
    const html = await readFile(path.join(dir, "index.html"), "utf8");
    assert.equal((html.match(/class="clip beat /g) ?? []).length, sb.beats.length);
    assert.match(html, new RegExp(`data-duration="${r.total}"`));
    assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/, "no network URLs in the composition");
    const engine = await readFile(path.join(dir, "assets/engine.js"), "utf8");
    assert.doesNotMatch(engine, /Math\.random|Date\.now|setTimeout|setInterval|requestAnimationFrame|repeat:\s*-1/);
    for (const f of r.compiled.fonts) await readFile(path.join(dir, "assets/fonts", `${f.family.toLowerCase().replace(/\s+/g, "-")}-latin-${f.weight}-normal.woff2`));
    await readFile(path.join(dir, "assets/vendor/gsap.min.js"));
    assert.deepEqual(staticChecks(sb, r.compiled).failures, []);
    await assert.rejects(buildProject({ format: "1:1", beats: [{ component: "ui-pan", seconds: 3, image: "https://example.com/a.png" }] }, dir), /local file/);
    await assert.rejects(buildProject({ format: "1:1", beats: [{ component: "ui-pan", seconds: 3, image: "/etc/passwd" }] }, dir), /not an image/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
