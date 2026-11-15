// Quality gate. Three layers:
//   1. staticChecks  - storyboard rules + palette contrast (pure, instant)
//   2. pageChecks    - the real page measured in headless Chrome: final text, minimum sizes, safe margins
//   3. deepCheck     - HyperFrames' own check (overlaps, contrast per frame, read time). Slow; optional.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { contrast } from "./color.js";
import { validateStoryboard } from "./storyboard.js";

export const MIN_SIZE = { hero: 7, headline: 5, body: 3.5, caption: 2.5 }; // % of the frame's short side
export const SAFE = { side: 0.06, top916: 0.12, bottom916: 0.2 };

export function staticChecks(sb, compiled) {
  const v = validateStoryboard(sb), failures = v.errors.map((message) => ({ code: "storyboard", message }));
  const warnings = v.warnings.map((message) => ({ code: "read_time", message }));
  const p = compiled.palette;
  const need = [["text", p.text, p.bg, 4.5], ["accent", p.accent, p.bg, 3], ["primary", p.primary, p.bg, 3], ["text on accent", p.onAccent, p.accent, 4.5], ["text on surface", p.onSurface, p.surface, 4.5]];
  for (const [name, fg, bg, min] of need) { const c = contrast(fg, bg); if (c < min) failures.push({ code: "contrast", message: `${name} contrast ${c.toFixed(2)}:1 is under ${min}:1` }); }
  for (const key of ["ease", "exitEase"]) if (/^(none|linear)/.test(compiled.tokens[key])) failures.push({ code: "linear_ease", message: `${key} is ${compiled.tokens[key]}` });
  return { failures, warnings };
}

export function run(cmd, args, { cwd, timeoutMs = 600000, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err = (err + d).slice(-20000)));
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String(e) }); });
  });
}

const onPath = (name) => (process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, name)).find((p) => existsSync(p));

/** Same lookup order as the promo engine: PATH, the server's Node folder, then npx. */
export function hyperframesCmd() {
  const bin = [process.env.BOTLY_HYPERFRAMES, onPath("hyperframes"), "/opt/hq/node/bin/hyperframes"].find((p) => p && existsSync(p));
  return bin ? [bin] : ["npx", "-y", "hyperframes@0.9.53"];
}
export function findChrome() {
  return [process.env.BOTLY_CHROME, process.env.HYPERFRAMES_BROWSER_PATH, "/usr/local/bin/chromium", onPath("chromium"), onPath("chromium-browser"), onPath("google-chrome")].find((p) => p && existsSync(p));
}
export function toolEnv() {
  const chrome = findChrome();
  return { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1", HYPERFRAMES_SKIP_SKILLS: "1", ...(chrome && !process.env.HYPERFRAMES_BROWSER_PATH ? { HYPERFRAMES_BROWSER_PATH: chrome } : {}) };
}

/** Load index.html?botly-check in headless Chrome and read the measurements the page leaves in the DOM. */
export async function pageChecks(dir, sb, compiled) {
  const chrome = findChrome();
  if (!chrome) return { failures: [], warnings: [{ code: "no_chrome", message: "Chrome/Chromium not found; page checks skipped (set BOTLY_CHROME)" }] };
  const { w, h } = compiled, u = Math.min(w, h) / 100, portrait = h > w;
  const url = pathToFileURL(path.join(dir, "index.html")).href + "?botly-check";
  const r = await run(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", `--window-size=${w},${h}`, "--virtual-time-budget=15000", "--dump-dom", url], { timeoutMs: 90000 });
  const m = /<pre id="botly-check">([A-Za-z0-9+/=]+)<\/pre>/.exec(r.out);
  if (!m) return { failures: [{ code: "page_check_failed", message: "the page did not finish building its timeline: " + (r.err || "no output").slice(-300) }], warnings: [] };
  const found = JSON.parse(Buffer.from(m[1], "base64").toString("utf8")), failures = [];
  for (const f of found) {
    const at = `beat ${f.beat + 1}`;
    if (f.text !== f.final) failures.push({ code: "final_text", message: `${at}: shows "${f.text}" but the storyboard says "${f.final}"` });
    if (f.opacity < 0.98) failures.push({ code: "not_revealed", message: `${at}: "${f.final}" is not fully visible when the beat ends` });
    if (f.size < MIN_SIZE[f.level] * u - 0.5) failures.push({ code: "text_too_small", message: `${at}: "${f.final}" is ${(f.size / u).toFixed(1)}% of the short side (minimum ${MIN_SIZE[f.level]}%). Use fewer words or fewer items.` });
    const [l, t, rt, bt] = f.rect, mt = portrait ? SAFE.top916 : SAFE.side, mb = portrait ? SAFE.bottom916 : SAFE.side;
    if (l < w * SAFE.side - 1 || rt > w * (1 - SAFE.side) + 1 || t < h * mt - 1 || bt > h * (1 - mb) + 1) failures.push({ code: "outside_safe_area", message: `${at}: "${f.final}" crosses the safe margin. Use fewer words.` });
  }
  return { failures, warnings: [], measured: found.length };
}

/** HyperFrames' own gate. Errors fail; warnings are reported. Takes minutes on a small server. */
export async function deepCheck(dir, { timeoutMs = 900000 } = {}) {
  const [cmd, ...pre] = hyperframesCmd();
  const r = await run(cmd, [...pre, "check", dir, "--json"], { timeoutMs, env: toolEnv() });
  let report;
  try { report = JSON.parse(r.out); } catch { return { failures: [{ code: "hyperframes_check_failed", message: (r.err || r.out).slice(-400) }], warnings: [] }; }
  const failures = [], warnings = [];
  for (const section of ["lint", "runtime", "layout", "motion", "contrast", "craft", "audio"])
    for (const f of report[section]?.findings ?? []) {
      if (f.code === "nested_structure_needs_subcomposition") continue; // by design: one generated file per video
      const item = { code: f.code, message: f.message, time: f.time };
      if (f.severity === "error") failures.push(item); else if (f.severity === "warning") warnings.push(item);
    }
  return { failures, warnings };
}

/** { pass, failures, warnings }. deep=true adds the HyperFrames check. */
export async function qualityGate(dir, sb, compiled, { deep = false } = {}) {
  const parts = [staticChecks(sb, compiled), await pageChecks(dir, sb, compiled)];
  if (deep) parts.push(await deepCheck(dir));
  const failures = parts.flatMap((p) => p.failures), warnings = parts.flatMap((p) => p.warnings);
  return { pass: failures.length === 0, failures, warnings };
}

/** One PNG per beat (at 80% of the beat), like make-promo.py --preview. Returns the folder. */
export async function preview(dir, sb, outDir) {
  let t = 0; const at = sb.beats.map((b) => { const x = t + b.seconds * 0.8; t += b.seconds; return x.toFixed(2); }).join(",");
  const [cmd, ...pre] = hyperframesCmd();
  const r = await run(cmd, [...pre, "snapshot", dir, "--at", at, "--no-end", "-o", outDir], { timeoutMs: 600000, env: toolEnv() });
  if (r.code !== 0) throw new Error("preview failed: " + (r.err || r.out).slice(-500));
  return outDir;
}

/** Render to MP4 with the same flags the promo engine uses on the server. */
export async function render(dir, outFile, { quality = "standard", timeoutMs = 1200000 } = {}) {
  const [cmd, ...pre] = hyperframesCmd();
  const args = [...pre, "render", dir, "-o", outFile, "--quality", quality === "draft" ? "draft" : quality === "high" ? "high" : "standard", "--fps", "30", "--low-memory-mode", "--quiet"];
  const r = await run(cmd, args, { timeoutMs, env: toolEnv() });
  if (r.code !== 0 || !existsSync(outFile)) throw new Error("render failed: " + (r.err || r.out).slice(-800));
  return outFile;
}
