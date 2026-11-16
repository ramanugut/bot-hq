import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** One problem `hyperframes check` found, trimmed to what a bot needs to fix it. */
export interface CheckIssue { severity: 'error' | 'warning'; area: string; code: string; message: string; time?: number; where?: string }

export interface PreviewResult {
  /** Contact sheets from `snapshot --review`: scenes first, then each cut, then the phone-width sheet. */
  sheets: string[];
  errors: number;
  warnings: number;
  issues: CheckIssue[];
  /** Set when a step failed outright (not when it found problems). */
  failure?: string;
}

const AREAS = ['lint', 'runtime', 'layout', 'motion', 'contrast', 'craft', 'audio'] as const;

/** Flatten `hyperframes check --json` into counts and the most useful findings, errors first. */
export function summarizeCheck(check: any, max = 15): { errors: number; warnings: number; issues: CheckIssue[] } {
  let errors = 0;
  let warnings = 0;
  const all: CheckIssue[] = [];
  for (const area of AREAS) {
    const part = check?.[area];
    if (!part || typeof part !== 'object') continue;
    errors += Number(part.errorCount) || 0;
    warnings += Number(part.warningCount) || 0;
    for (const f of Array.isArray(part.findings) ? part.findings : []) {
      if (f?.severity !== 'error' && f?.severity !== 'warning') continue;
      all.push({
        severity: f.severity,
        area,
        code: String(f.code ?? area),
        message: String(f.message ?? '').slice(0, 300),
        ...(typeof f.time === 'number' ? { time: Math.round(f.time * 100) / 100 } : {}),
        ...(f.selector ? { where: String(f.selector).slice(0, 120) } : {}),
      });
    }
  }
  all.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return { errors, warnings, issues: all.slice(0, max) };
}

/** The text a bot gets back: counts, findings and where the sheets are. */
export function describePreview(r: PreviewResult, folder: string): string {
  const lines: string[] = [];
  if (r.failure) lines.push(`Preview problem: ${r.failure}`);
  lines.push(`Check: ${r.errors} error${r.errors === 1 ? '' : 's'}, ${r.warnings} warning${r.warnings === 1 ? '' : 's'}.`);
  for (const i of r.issues) {
    lines.push(`- [${i.severity}] ${i.area}/${i.code}${i.time !== undefined ? ` at ${i.time}s` : ''}${i.where ? ` (${i.where})` : ''}: ${i.message}`);
  }
  if (r.sheets.length) {
    lines.push('', 'Review sheets (open and look at every one before you answer):', ...r.sheets.map((s) => `- ${s}`));
  }
  lines.push('', r.errors
    ? 'Fix every error, then run preview_video_project again. Do not render yet.'
    : `When the sheets look right, show the person the preview and ask before rendering ${folder} with render_video_project (unless they asked for no stops).`);
  return lines.join('\n');
}

/** Run a HyperFrames command, kill its whole process group after `timeoutMs`, and keep the last 2 MB of output. */
function run(bin: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const kill = (sig: NodeJS.Signals) => { try { if (p.pid) process.kill(-p.pid, sig); } catch { /* gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 5000).unref(); }, timeoutMs);
    p.stdout.on('data', (d) => { stdout = (stdout + d).slice(-2_000_000); });
    p.stderr.on('data', (d) => { stderr = (stderr + d).slice(-20_000); });
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: 1, stdout, stderr: stderr + String(e), timedOut }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

/** The JSON object a command printed, even if a warning line came before it. */
function parseJson(text: string): any | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  try { return JSON.parse(text.slice(start)); } catch { return null; }
}

/**
 * Check a HyperFrames project and capture its review sheets (each scene, each cut, phone width) into `outDir`.
 * Both steps run even if the check finds problems, so the bot sees the pictures and the findings together.
 */
export async function previewProject(bin: string, folder: string, outDir: string, env: NodeJS.ProcessEnv, timeoutMs = 5 * 60_000): Promise<PreviewResult> {
  const started = Date.now();
  const left = () => Math.max(30_000, timeoutMs - (Date.now() - started));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const result: PreviewResult = { sheets: [], errors: 0, warnings: 0, issues: [] };
  const check = await run(bin, ['check', folder, '--json', '--budget', '150s'], env, Math.min(left(), 3 * 60_000));
  const checkJson = parseJson(check.stdout);
  if (checkJson) Object.assign(result, summarizeCheck(checkJson));
  else result.failure = check.timedOut ? 'the check took too long' : `the check did not run: ${(check.stderr || check.stdout).trim().split('\n').slice(-3).join(' ').slice(0, 300)}`;

  const snap = await run(bin, ['snapshot', folder, '--review', '--json', '-o', outDir], env, left());
  const snapJson = parseJson(snap.stdout);
  const sheets: string[] = Array.isArray(snapJson?.contactSheets) ? snapJson.contactSheets : [];
  result.sheets = sheets.filter((s) => typeof s === 'string' && s.startsWith(path.resolve(outDir) + path.sep) && fs.existsSync(s));
  if (!result.sheets.length) {
    const why = snap.timedOut ? 'the snapshots took too long' : `no review sheets were made: ${(snap.stderr || snap.stdout).trim().split('\n').slice(-3).join(' ').slice(0, 300)}`;
    result.failure = result.failure ? `${result.failure}; ${why}` : why;
  }
  return result;
}
