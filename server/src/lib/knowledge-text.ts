import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

/** Text kept per entry. Longer documents are cut here; the original file stays available. */
export const MAX_BODY = 200_000;
/** Largest file accepted into knowledge. */
export const MAX_FILE = 25 * 1024 * 1024;

export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];
export const DOC_EXT = ['pdf', 'docx', 'doc', 'pptx', 'xlsx', 'xls', 'odt', 'rtf', 'html', 'htm', 'csv', 'json'];
export const TEXT_EXT = ['txt', 'md', 'markdown'];
export const ACCEPTED_EXT = [...IMAGE_EXT, ...DOC_EXT, ...TEXT_EXT];

export const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();
export const kindOf = (name: string): 'image' | 'document' | 'text' | null => {
  const e = extOf(name);
  return IMAGE_EXT.includes(e) ? 'image' : DOC_EXT.includes(e) ? 'document' : TEXT_EXT.includes(e) ? 'text' : null;
};

/**
 * A reason when text looks like it holds a password, key or token; null when it looks fine.
 * Knowledge is read by bots and may reach customers, so secrets never belong in it.
 */
export function looksSecret(text: string): string | null {
  const t = text.slice(0, MAX_BODY);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t)) return 'a private key';
  if (/\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9]{16,}/.test(t)) return 'an API key';
  if (/\b(?:ghp|gho|ghs|github_pat|xox[abpr]|AKIA|AIza)[A-Za-z0-9_-]{12,}/.test(t)) return 'an access token';
  // "Password: Hunter22!" is a secret; "Password: reset it in the client area" is help text.
  if (/\b(?:password|passwd|pwd|passcode|pin|secret|api[ _-]?key|token)\s*[:=]\s*(?=\S*[\d!@#$%^&*_])\S{6,}/i.test(t)) return 'a password or key';
  return null;
}

/** Turn what a person or bot typed into a safe SQLite full-text query: every word must appear, as a prefix. */
export function ftsQuery(q: string, mode: 'all' | 'any' = 'all'): string | null {
  const words = q.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter((w) => w.length > 1).slice(0, 12);
  if (!words.length) return null;
  return words.map((w) => `"${w}"*`).join(mode === 'all' ? ' AND ' : ' OR ');
}

/** Titles linked with [[Title]] in an entry's text. */
export function wikiLinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\]\n]{1,120})\]\]/g)) out.add(m[1].trim());
  return [...out];
}

/** A file-system-safe name for a stored copy, keeping the extension. */
export function safeFileName(name: string): string {
  const base = path.basename(name || 'file').replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, '-').slice(-100);
  return base && base !== '.' && base !== '..' ? base : 'file';
}

/** A readable title from a file name: "refund-policy_2026.pdf" -> "Refund policy 2026". */
export function titleFromFile(name: string): string {
  const t = path.basename(name).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : 'Untitled';
}

function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

/**
 * The text inside a file, as Markdown where possible. Uses MarkItDown (installed by extras.sh), then
 * pdftotext or pandoc, then plain reading. Images have no text: their entry holds the description instead.
 */
export async function extractText(file: string): Promise<string> {
  const e = extOf(file);
  if (IMAGE_EXT.includes(e)) return '';
  if (TEXT_EXT.includes(e) || e === 'csv' || e === 'json') return fs.readFileSync(file, 'utf8').slice(0, MAX_BODY);
  const viaMarkItDown = await run('markitdown', [file]);
  if (viaMarkItDown?.trim()) return viaMarkItDown.trim().slice(0, MAX_BODY);
  if (e === 'pdf') {
    const viaPdf = await run('pdftotext', ['-layout', file, '-']);
    if (viaPdf?.trim()) return viaPdf.trim().slice(0, MAX_BODY);
  }
  if (['docx', 'doc', 'odt', 'rtf', 'html', 'htm'].includes(e)) {
    const viaPandoc = await run('pandoc', [file, '-t', 'gfm', '--wrap=none']);
    if (viaPandoc?.trim()) return viaPandoc.trim().slice(0, MAX_BODY);
  }
  return '';
}
