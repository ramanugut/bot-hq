/**
 * Tavily is a server-side research provider for Botly's own MCP tools.
 * Deliberately uses the documented REST endpoints: no CLI, child processes or extra dependencies.
 * Never return API keys, upstream error bodies, or whole unbounded web pages to the agent.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type TavilyAction = 'search' | 'extract' | 'map' | 'crawl' | 'research' | 'research_status';

export interface TavilyOutcome { output: string; summary: string }

function fromHermesEnv(): string {
  const home = process.env.HERMES_HOME_PRIMARY || path.join(os.homedir(), '.hermes');
  try {
    const file = fs.readFileSync(path.join(home, '.env'), 'utf8');
    const line = file.split(/\r?\n/).find((s) => /^\s*(?:export\s+)?TAVILY_API_KEY\s*=/.test(s));
    if (!line) return '';
    const val = line.slice(line.indexOf('=') + 1).trim();
    return val.length >= 2 && (val[0] === '"' || val[0] === "'") && val.endsWith(val[0])
      ? val.slice(1, -1) : val;
  } catch {
    return '';
  }
}

/** Botly uses its normal secret sources first, then the existing Hermes key. */
export function tavilyApiKey(): string {
  if (process.env.TAVILY_API_KEY?.trim()) return process.env.TAVILY_API_KEY.trim();
  if (process.env.TAVILY_API_KEY_FILE) {
    try { return fs.readFileSync(process.env.TAVILY_API_KEY_FILE, 'utf8').trim(); }
    catch { return ''; }
  }
  return fromHermesEnv();
}

export function tavilyConfigured(): boolean { return Boolean(tavilyApiKey()); }

/** Do not send internal/localhost addresses to a third-party crawler. */
export function publicWebUrl(raw: unknown): string {
  const input = String(raw ?? '').trim();
  if (!input || input.length > 2048) throw new Error('Please provide a public website URL.');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Please provide a valid http(s) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only public http(s) URLs without embedded credentials are allowed.');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // Reject IPv4, IPv6, dotless hosts, and common internal/dynamic-IP DNS names.
  if (!host.includes('.') || /^\[/.test(host) || /^\d+(?:\.\d+){3}$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host) ||
      /(?:^|\.)(?:nip\.io|sslip\.io|xip\.io|localtest\.me|home\.arpa)$/.test(host)) {
    throw new Error('Only public website hostnames are allowed.');
  }
  url.hash = '';
  return url.toString();
}

const clip = (value: unknown, limit: number): string =>
  (typeof value === 'string' ? value : JSON.stringify(value ?? '')).slice(0, limit);

const bounded = (value: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.floor(n))) : fallback;
};

/** Returns upstream JSON; errors are intentionally generic to avoid leaking secrets. */
export async function tavilyApi(endpoint: string, body?: Record<string, unknown>, timeoutMs = 25_000): Promise<any> {
  if (!/^(search|extract|map|crawl|research|research\/[a-f0-9-]{32,36}\?include_usage=true)$/i.test(endpoint)) {
    throw new Error('Unsupported Tavily operation.');
  }
  const key = tavilyApiKey();
  if (!key) throw new Error('Tavily is not configured. Add TAVILY_API_KEY to the server secret store or primary Hermes environment.');
  let response: Response;
  try {
    response = await fetch('https://api.tavily.com/' + endpoint, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(Math.min(70_000, timeoutMs)),
    });
  } catch {
    throw new Error('Tavily did not respond. Check network access and try again.');
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Tavily rejected the API key or access to this feature.');
    if (response.status === 429) throw new Error('Tavily rate limit reached. Try again later.');
    if (response.status === 402 || response.status === 432) throw new Error('Tavily usage or credit limit reached.');
    if (response.status === 404) throw new Error('Tavily could not find that research request.');
    throw new Error('Tavily request failed (HTTP ' + response.status + ').');
  }
  try { return await response.json(); }
  catch { throw new Error('Tavily returned an invalid response.'); }
}

const sources = (items: any[], max = 10): string =>
  items.slice(0, max).map((s: any, i: number) => String(i + 1) + '. ' +
    clip(s.title || s.url || 'Source', 180) + '\n' + clip(s.url || '', 2048)).join('\n');

const usage = (data: any): string =>
  Number.isFinite(Number(data?.usage?.credits)) ? '\nCredits reported: ' + Number(data.usage.credits) : '';

export async function runTavily(action: TavilyAction, args: any): Promise<TavilyOutcome> {
  const a = args && typeof args === 'object' ? args : {};
  if (action === 'search') {
    const query = String(a.query || '').trim().slice(0, 1000);
    if (!query) throw new Error('Provide a search query.');
    const topic = a.topic === 'news' ? 'news' : 'general';
    const data = await tavilyApi('search', {
      query, topic, search_depth: 'basic', max_results: bounded(a.count, 1, 10, 5),
      include_answer: false, include_raw_content: false, include_images: false, include_usage: true,
    });
    const results = (Array.isArray(data.results) ? data.results : []).slice(0, 10);
    return {
      output: results.length ? results.map((r: any, i: number) =>
        String(i + 1) + '. ' + clip(r.title || '(untitled)', 180) + '\n' +
        clip(r.url, 2048) + '\n' + clip(r.content || '', 1400) +
        (r.published_date ? '\nPublished: ' + clip(r.published_date, 40) : '')).join('\n\n') + usage(data)
        : 'Tavily found no results for this query.',
      summary: 'Tavily: ' + results.length + ' search results',
    };
  }
  if (action === 'extract') {
    const input = Array.isArray(a.urls) ? a.urls : [a.url || a.urls];
    if (!input[0] || input.length > 3) throw new Error('Provide one to three public website URLs.');
    const urls = input.map(publicWebUrl);
    const data = await tavilyApi('extract', { urls, extract_depth: 'basic', format: 'markdown', include_usage: true }, 45_000);
    const results = Array.isArray(data.results) ? data.results.slice(0, 3) : [];
    return {
      output: (results.map((r: any) => 'Source: ' + clip(r.url, 2048) +
        '\n' + clip(r.raw_content || r.content || '', 12_000)).join('\n\n---\n\n') ||
        'No readable content was returned.') +
        (data.failed_results?.length ? '\nFailed URLs: ' + clip(data.failed_results.map((r: any) => r.url), 3000) : '') + usage(data),
      summary: 'Tavily: extracted ' + results.length + ' pages',
    };
  }
  if (action === 'map' || action === 'crawl') {
    const url = publicWebUrl(a.url);
    const instructions = String(a.instructions || '').trim().slice(0, 500);
    const limit = bounded(a.limit, 1, action === 'map' ? 30 : 8, action === 'map' ? 20 : 5);
    const data = await tavilyApi(action, {
      url, ...(instructions ? { instructions } : {}),
      max_depth: bounded(a.max_depth, 1, 2, 1),
      max_breadth: 10, limit, allow_external: false, timeout: 60,
      ...(action === 'crawl' ? { extract_depth: 'basic', format: 'markdown', include_images: false } : {}),
      include_usage: true,
    }, 65_000);
    if (action === 'map') {
      const links = Array.isArray(data.results) ? data.results : (Array.isArray(data.urls) ? data.urls : []);
      return { output: (links.slice(0, limit).map((v: any) => clip(typeof v === 'string' ? v : v.url, 2048)).join('\n') ||
        'No pages found.') + usage(data), summary: 'Tavily: mapped ' + Math.min(links.length, limit) + ' pages' };
    }
    const pages = (Array.isArray(data.results) ? data.results : []).slice(0, limit);
    return {
      output: (pages.map((r: any) => 'Source: ' + clip(r.url, 2048) + '\n' +
        clip(r.raw_content || r.content || '', 4500)).join('\n\n---\n\n') ||
        'No pages could be crawled.') + usage(data),
      summary: 'Tavily: crawled ' + pages.length + ' pages',
    };
  }
  if (action === 'research') {
    const input = String(a.question || a.input || '').trim().slice(0, 2000);
    if (!input) throw new Error('Provide a research question.');
    const data = await tavilyApi('research', {
      input, model: 'mini', stream: false, citation_format: 'numbered', output_length: 'standard',
    }, 30_000);
    return {
      output: 'Tavily research request: ' + clip(data.request_id || '', 80) +
        '\nStatus: ' + clip(data.status || 'pending', 60) +
        '\nCheck its result with tavily_research_status using this request ID. Do not start a duplicate task.',
      summary: 'Tavily: research started',
    };
  }
  if (action === 'research_status') {
    const id = String(a.request_id || '').trim();
    if (!/^[a-f0-9-]{32,36}$/i.test(id)) throw new Error('Provide a valid Tavily research request ID.');
    const data = await tavilyApi('research/' + id + '?include_usage=true', undefined, 20_000);
    const status = String(data.status || 'unknown');
    if (status !== 'completed') {
      return { output: 'Research status: ' + clip(status, 60) +
        (status === 'failed' ? '. Tavily could not complete the request.' : '. Check again later with the same request ID.'),
        summary: 'Tavily research: ' + status };
    }
    const content = clip(data.content || 'No report content was returned.', 40_000);
    const refs = Array.isArray(data.sources) ? data.sources : [];
    return {
      output: content + (refs.length ? '\n\nSources:\n' + sources(refs, 20) : '') + usage(data),
      summary: 'Tavily: research completed',
    };
  }
  throw new Error('Unsupported Tavily operation.');
}
