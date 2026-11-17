import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';

/**
 * How much of the ChatGPT subscription the bots have used, read from the same endpoint the Codex CLI
 * uses for /status. Best effort: if the sign-in isn't a ChatGPT one, or the endpoint changes, the app
 * simply shows no meter.
 */

export interface UsageWindow { label: string; usedPercent: number; resetsAt: number | null }
export interface Usage { plan?: string; windows: UsageWindow[]; checkedAt: number }

function findToken(o: any, depth = 0): { access?: string; account?: string; id?: string } | null {
  if (!o || typeof o !== 'object' || depth > 6) return null;
  const access = o.access_token ?? o.accessToken;
  if (typeof access === 'string' && access.length > 40) {
    return { access, account: o.account_id ?? o.accountId ?? o.chatgpt_account_id, id: o.id_token ?? o.idToken };
  }
  // Prefer entries that are about Codex / OpenAI.
  const keys = Object.keys(o).sort((a, b) => Number(/codex|openai|chatgpt/i.test(b)) - Number(/codex|openai|chatgpt/i.test(a)));
  for (const k of keys) {
    if (depth === 0 && /nous|anthropic|claude|xai|grok|gemini|google|copilot/i.test(k)) continue;
    const r = findToken(o[k], depth + 1);
    if (r) return r;
  }
  return null;
}

function accountFromJwt(jwt?: string): string | undefined {
  try {
    const claims = JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8'));
    return claims?.['https://api.openai.com/auth']?.chatgpt_account_id;
  } catch { return undefined; }
}

function pickWindows(data: any): UsageWindow[] {
  const out: UsageWindow[] = [];
  const add = (label: string, w: any) => {
    if (!w || typeof w !== 'object') return;
    const used = Number(w.used_percent ?? w.usedPercent ?? w.utilization);
    if (!Number.isFinite(used)) return;
    const after = Number(w.reset_after_seconds ?? w.resetAfterSeconds ?? w.resets_in_seconds);
    const at = Number(w.reset_at ?? w.resets_at ?? w.resetsAt);
    const resetsAt = Number.isFinite(at) && at > 0 ? (at < 1e12 ? at * 1000 : at) : Number.isFinite(after) ? Date.now() + after * 1000 : null;
    out.push({ label, usedPercent: Math.max(0, Math.min(100, used)), resetsAt });
  };
  const rl = data?.rate_limit ?? data?.rateLimit ?? data;
  add('5 hours', rl?.primary_window ?? rl?.primaryWindow ?? rl?.primary);
  add('Week', rl?.secondary_window ?? rl?.secondaryWindow ?? rl?.secondary);
  return out;
}

let cache: Usage | null = null;
let inflight: Promise<Usage | null> | null = null;

export function chatgptUsage(): Promise<Usage | null> {
  if (cache && Date.now() - cache.checkedAt < 120_000) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const auth = JSON.parse(fs.readFileSync(path.join(env.hermesHome, 'auth.json'), 'utf8'));
      const t = findToken(auth);
      if (!t?.access) return null;
      const account = t.account ?? accountFromJwt(t.id) ?? accountFromJwt(t.access);
      const headers: Record<string, string> = { Authorization: `Bearer ${t.access}`, 'User-Agent': 'codex_cli_rs', Accept: 'application/json', ...(account ? { 'chatgpt-account-id': account } : {}) };
      for (const url of ['https://chatgpt.com/backend-api/codex/usage', 'https://chatgpt.com/backend-api/wham/usage']) {
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) }).catch(() => null);
        if (!r?.ok) continue;
        const data = await r.json().catch(() => null);
        const windows = pickWindows(data);
        if (windows.length) { cache = { plan: data?.plan_type ?? data?.planType, windows, checkedAt: Date.now() }; return cache; }
      }
      return null;
    } catch { return null; } finally { inflight = null; }
  })();
  return inflight;
}
