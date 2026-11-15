#!/usr/bin/env node
// Wide check: every component, many random styles, all three formats, through the real page checks.
//   node scripts/tools/motion/test/sweep.mjs [count=30]      (needs Chromium; about 2 s per style)
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject } from "../src/build.js";
import { qualityGate } from "../src/checks.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(await readFile(path.join(here, "../examples/all-components.json"), "utf8"));
const count = Number(process.argv[2] ?? 30), formats = ["16:9", "9:16", "1:1"];
let bad = 0;
for (let i = 0; i < count; i++) {
  const sb = { ...base, format: formats[i % 3], dna: { seed: "sweep-" + i } };
  const dir = await mkdtemp(path.join(tmpdir(), "motion-sweep-"));
  try {
    const r = await buildProject(sb, dir), g = await qualityGate(dir, sb, r.compiled);
    if (!g.pass) { bad++; console.log(`FAIL ${sb.format} ${JSON.stringify(r.dna)}\n  ` + g.failures.map((f) => `${f.code}: ${f.message}`).join("\n  ")); }
  } finally { await rm(dir, { recursive: true, force: true }); }
}
console.log(`${count - bad}/${count} styles passed`);
process.exit(bad ? 1 : 0);
