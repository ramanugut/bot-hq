import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { db, now } from './db.js';
import { env } from './env.js';
import { newId } from './lib/ids.js';
import type { ConnectorTool, ConnectorView } from './types.js';

/**
 * Connectors: outside MCP servers the owner adds in Settings → Connectors, each given to every bot or
 * to the bots the owner picks. They become Hermes `mcp_servers` entries:
 *   - an extra bot's own config.yaml, written by engine.ts (writeHome) when its gateway starts;
 *   - the primary agent's config.yaml, edited here in place (comments and every other setting kept).
 * Applying a change (restarting the agents that use it) is connections-apply.ts.
 *
 * Every `mcp_servers` key Botly has managed is remembered in connector_names, so a connector that is
 * removed or taken away from a bot is also removed from that bot's config. Keys Botly never managed
 * (the app's own `botly`/`hq` entry, servers added by hand) are never touched.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  auth_header TEXT,
  auth_value TEXT,
  options TEXT NOT NULL DEFAULT '{}',
  scope TEXT NOT NULL DEFAULT 'all',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_test_at INTEGER,
  last_test_ok INTEGER,
  last_error TEXT,
  tools TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS connector_bots (
  connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  PRIMARY KEY (connector_id, bot_id)
);
CREATE TABLE IF NOT EXISTS connector_names (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS connector_meta (key TEXT PRIMARY KEY, value TEXT);
`);

/** Keys that belong to the app itself. */
const RESERVED = new Set(['botly', 'hq']);

export type AuthInput = { type: 'none' } | { type: 'bearer'; value?: string } | { type: 'header'; header: string; value?: string };

// ---------- reading ----------

const rowById = (id: string) => db.prepare('SELECT * FROM connectors WHERE id=?').get(id) as any;
const allRows = () => db.prepare('SELECT * FROM connectors ORDER BY created_at ASC').all() as any[];
const botIdsOf = (id: string) => (db.prepare('SELECT bot_id FROM connector_bots WHERE connector_id=?').all(id) as any[]).map((r) => r.bot_id as string);

/** Agent bots that can be given connectors (not group chats, not hidden helpers). */
export function agentBots(userId?: string): { id: string; name: string; isPrimary: boolean }[] {
  return (db.prepare(`SELECT id, name, is_primary, engine FROM bots WHERE COALESCE(kind,'agent') <> 'room' AND COALESCE(hidden,0)=0${userId ? ' AND user_id=?' : ''} ORDER BY is_primary DESC, created_at ASC`).all(...(userId ? [userId] : [])) as any[])
    .map((b) => ({ id: b.id, name: b.name, isPrimary: b.engine === 'primary' || !!b.is_primary }));
}

const primaryId = () => (db.prepare("SELECT id FROM bots WHERE engine='primary' LIMIT 1").get() as any)?.id as string | undefined;

const imported = () => (db.prepare("SELECT value FROM connector_meta WHERE key='imported'").get() as any)?.value === '1';

function envExtras(): Record<string, any> {
  if (!env.extraMcpServers) return {};
  try {
    const v = JSON.parse(env.extraMcpServers);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    console.warn('[connectors] EXTRA_MCP_SERVERS is not valid JSON; ignored');
    return {};
  }
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
}

function headersOf(r: any): Record<string, string> {
  const extra = parseJson<any>(r.options, {}).headers ?? {};
  return { ...extra, ...(r.auth_header && r.auth_value ? { [r.auth_header]: r.auth_value } : {}) };
}

/** The Hermes `mcp_servers` entry for a connector. */
function entryOf(r: any): Record<string, any> {
  const { headers: _h, ...options } = parseJson<any>(r.options, {});
  const headers = headersOf(r);
  return { timeout: 300, connect_timeout: 30, ...options, url: r.url, ...(Object.keys(headers).length ? { headers } : {}) };
}

const appliesTo = (r: any, botId: string) => !!r.enabled && (r.scope === 'all' || botIdsOf(r.id).includes(botId));

/** The connectors one bot gets, as Hermes `mcp_servers` entries. Before the first import, EXTRA_MCP_SERVERS still applies. */
export function connectorEntriesFor(botId: string): Record<string, any> {
  const out: Record<string, any> = imported() ? {} : { ...envExtras() };
  for (const r of allRows()) if (appliesTo(r, botId)) out[r.name] = entryOf(r);
  return out;
}

/** Every `mcp_servers` key Botly manages or has managed (removed from a config when no longer given to that bot). */
export function managedConnectorNames(): string[] {
  const names = new Set((db.prepare('SELECT name FROM connector_names').all() as any[]).map((r) => r.name as string));
  for (const r of allRows()) names.add(r.name);
  return [...names].filter((n) => !RESERVED.has(n));
}

/** A fingerprint of what one bot gets, to tell which bots a change affects. */
export function connectorSignature(botId: string): string {
  return stable(connectorEntriesFor(botId));
}

/** JSON with object keys sorted, so key order never counts as a change. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** Show the address without giving away a secret in it: long path parts and the query are shortened. */
export function maskUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').map((p) => (p.length >= 16 ? `${p.slice(0, 4)}…${p.slice(-3)}` : p));
    return `${u.origin}${parts.join('/')}${u.search ? '?…' : ''}`;
  } catch { return raw.length > 24 ? `${raw.slice(0, 20)}…` : raw; }
}

export function viewOf(r: any): ConnectorView {
  const isBearer = r.auth_header?.toLowerCase() === 'authorization' && /^bearer\s/i.test(r.auth_value ?? '');
  const tools = parseJson<ConnectorTool[]>(r.tools, []);
  return {
    id: r.id,
    name: r.name,
    label: r.label,
    url: maskUrl(r.url),
    auth: !r.auth_header || !r.auth_value ? 'none' : isBearer ? 'bearer' : 'header',
    authHeader: r.auth_header && !isBearer ? r.auth_header : null,
    secretHint: r.auth_value ? `••••${String(r.auth_value).slice(-4)}` : null,
    scope: r.scope === 'some' ? 'some' : 'all',
    botIds: botIdsOf(r.id),
    enabled: !!r.enabled,
    status: r.last_test_at ? { at: r.last_test_at, ok: !!r.last_test_ok, error: r.last_error ?? null, toolCount: tools.length } : null,
    tools,
  };
}

export const listConnectors = (): ConnectorView[] => allRows().map(viewOf);
export const getConnector = (id: string) => rowById(id);

// ---------- writing ----------

function slug(label: string, taken: Set<string>): string {
  let base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'connector';
  if (!/^[a-z]/.test(base)) base = `c_${base}`;
  let name = base;
  for (let i = 2; taken.has(name) || RESERVED.has(name); i++) name = `${base}_${i}`;
  return name;
}

function authColumns(auth: AuthInput | undefined, cur?: any): { header: string | null; value: string | null } | string {
  if (!auth) return { header: cur?.auth_header ?? null, value: cur?.auth_value ?? null };
  if (auth.type === 'none') return { header: null, value: null };
  const keep = (wasHeader: string) => cur?.auth_header?.toLowerCase() === wasHeader.toLowerCase() ? cur.auth_value : null;
  if (auth.type === 'bearer') {
    const v = String(auth.value ?? '').trim().replace(/^bearer\s+/i, '');
    if (v) return { header: 'Authorization', value: `Bearer ${v}` };
    const kept = /^bearer\s/i.test(cur?.auth_value ?? '') ? keep('Authorization') : null;
    return kept ? { header: 'Authorization', value: kept } : 'Paste the key or token';
  }
  const header = String(auth.header ?? '').trim();
  if (!/^[A-Za-z0-9-]{1,64}$/.test(header)) return 'Header name: letters, digits and dashes only (for example X-API-Key)';
  const v = String(auth.value ?? '').trim();
  if (v) return { header, value: v };
  const kept = keep(header);
  return kept ? { header, value: kept } : 'Paste the key for that header';
}

function cleanUrl(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch { return null; }
}

function setBots(id: string, scope: string, botIds: string[] | undefined) {
  if (botIds === undefined && scope !== 'all') return;
  db.prepare('DELETE FROM connector_bots WHERE connector_id=?').run(id);
  if (scope !== 'some') return;
  const valid = new Set(agentBots().map((b) => b.id));
  const ins = db.prepare('INSERT OR IGNORE INTO connector_bots(connector_id, bot_id) VALUES (?,?)');
  for (const b of botIds ?? []) if (valid.has(b)) ins.run(id, b);
}

export interface ConnectorInput { label?: string; url?: string; auth?: AuthInput; scope?: 'all' | 'some'; botIds?: string[]; enabled?: boolean }

export function createConnector(p: ConnectorInput): any | string {
  const label = String(p.label ?? '').trim().slice(0, 60);
  if (!label) return 'Give the connector a name';
  const url = cleanUrl(p.url);
  if (!url) return 'Paste the server’s address, starting with https://';
  const auth = authColumns(p.auth ?? { type: 'none' });
  if (typeof auth === 'string') return auth;
  const scope = p.scope === 'some' ? 'some' : 'all';
  if (scope === 'some' && !(p.botIds ?? []).length) return 'Pick at least one bot, or choose All bots';
  const name = slug(label, new Set(managedConnectorNames()));
  const id = newId('con');
  db.prepare('INSERT INTO connectors(id,name,label,url,auth_header,auth_value,scope,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, name, label, url, auth.header, auth.value, scope, p.enabled === false ? 0 : 1, now(), now());
  db.prepare('INSERT OR IGNORE INTO connector_names(name) VALUES (?)').run(name);
  setBots(id, scope, p.botIds);
  return rowById(id);
}

export function updateConnector(id: string, p: ConnectorInput): any | string {
  const cur = rowById(id);
  if (!cur) return 'not found';
  const label = p.label === undefined ? cur.label : String(p.label).trim().slice(0, 60);
  if (!label) return 'Give the connector a name';
  // An empty address keeps the saved one (it is never sent to the browser in full).
  const url = p.url === undefined || String(p.url).trim() === '' ? cur.url : cleanUrl(p.url);
  if (!url) return 'Paste the server’s address, starting with https://';
  const auth = authColumns(p.auth, cur);
  if (typeof auth === 'string') return auth;
  const scope = p.scope === undefined ? cur.scope : p.scope === 'some' ? 'some' : 'all';
  if (scope === 'some' && p.botIds !== undefined && !p.botIds.length) return 'Pick at least one bot, or choose All bots';
  const enabled = p.enabled === undefined ? cur.enabled : p.enabled ? 1 : 0;
  const changedTarget = url !== cur.url || auth.header !== cur.auth_header || auth.value !== cur.auth_value;
  db.prepare('UPDATE connectors SET label=?, url=?, auth_header=?, auth_value=?, scope=?, enabled=?, updated_at=? WHERE id=?')
    .run(label, url, auth.header, auth.value, scope, enabled, now(), id);
  if (changedTarget) db.prepare('UPDATE connectors SET last_test_at=NULL, last_test_ok=NULL, last_error=NULL, tools=NULL WHERE id=?').run(id);
  setBots(id, scope, p.botIds);
  return rowById(id);
}

export function deleteConnector(id: string) {
  db.prepare('DELETE FROM connectors WHERE id=?').run(id);
}

export function saveTestResult(id: string, r: ProbeResult) {
  db.prepare('UPDATE connectors SET last_test_at=?, last_test_ok=?, last_error=?, tools=? WHERE id=?')
    .run(now(), r.ok ? 1 : 0, r.ok ? null : r.error, r.ok ? JSON.stringify(r.tools) : null, id);
}

/** Headers for testing a connector that is not saved yet (or saved, with a new key typed in). */
export function probeHeaders(auth: AuthInput | undefined, cur?: any): Record<string, string> | string {
  const a = authColumns(auth, cur);
  if (typeof a === 'string') return a;
  const extra = cur ? parseJson<any>(cur.options, {}).headers ?? {} : {};
  return { ...extra, ...(a.header && a.value ? { [a.header]: a.value } : {}) };
}

export const savedHeaders = (r: any) => headersOf(r);
export const urlForTest = (raw: unknown, cur?: any) => (cur && (raw === undefined || String(raw).trim() === '') ? cur.url : cleanUrl(raw));

// ---------- the first run: bring in what add-mcp.sh set up ----------

/**
 * Turn MCP servers set up outside Settings → Connectors (scripts/add-mcp.sh: EXTRA_MCP_SERVERS, and URL
 * entries in the primary agent's config) into connectors, so they can be managed there. Entries in
 * EXTRA_MCP_SERVERS go to every bot; ones only in the primary config only to the primary bot. Runs on
 * start and whenever the list is opened; a name Botly has managed before (even one removed since) is
 * never brought back. After the first run EXTRA_MCP_SERVERS is no longer applied directly.
 * Waits until the primary bot exists.
 */
export function importExistingConnectors() {
  const primary = primaryId();
  if (!primary) return;
  const extras = envExtras();
  const primaryServers = readYamlFile(primaryConfigPath())?.mcp_servers ?? {};
  const found: Record<string, { entry: any; all: boolean }> = {};
  for (const [k, v] of Object.entries(primaryServers)) found[k] = { entry: v, all: false };
  for (const [k, v] of Object.entries(extras)) found[k] = { entry: v, all: true };
  const taken = new Set(managedConnectorNames());
  const tx = db.transaction(() => {
    for (const [name, { entry, all }] of Object.entries(found)) {
      if (RESERVED.has(name) || taken.has(name) || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) continue;
      if (!entry || typeof entry !== 'object' || typeof (entry as any).url !== 'string' || !cleanUrl((entry as any).url)) continue; // programs (command:) stay as they are
      const { url, headers, ...options } = entry as any;
      const h: Record<string, string> = headers && typeof headers === 'object' ? { ...headers } : {};
      const authHeader = Object.keys(h).find((k) => k.toLowerCase() === 'authorization') ?? Object.keys(h)[0] ?? null;
      const authValue = authHeader ? String(h[authHeader]) : null;
      if (authHeader) delete h[authHeader];
      if (Object.keys(h).length) options.headers = h;
      const id = newId('con');
      db.prepare('INSERT INTO connectors(id,name,label,url,auth_header,auth_value,options,scope,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)')
        .run(id, name, name.toUpperCase().length <= 6 ? name.toUpperCase() : name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), url, authHeader, authValue, JSON.stringify(options), all ? 'all' : 'some', now(), now());
      db.prepare('INSERT OR IGNORE INTO connector_names(name) VALUES (?)').run(name);
      if (!all) db.prepare('INSERT OR IGNORE INTO connector_bots(connector_id, bot_id) VALUES (?,?)').run(id, primary);
      taken.add(name);
    }
    db.prepare("INSERT OR REPLACE INTO connector_meta(key, value) VALUES ('imported', '1')").run();
  });
  const before = allRows().length;
  tx();
  const added = allRows().length - before;
  if (added) console.log(`[connectors] brought in ${added} MCP server(s) set up outside Settings → Connectors`);
}

// ---------- the primary agent's config.yaml ----------

export const primaryConfigPath = () => path.join(env.hermesHome, 'config.yaml');

function readYamlFile(file: string): any {
  try { return YAML.parse(fs.readFileSync(file, 'utf8')) ?? {}; } catch { return null; }
}

const same = (a: unknown, b: unknown) => stable(a) === stable(b);

/**
 * Make the primary agent's `mcp_servers` match what the primary bot should have. Only keys Botly manages
 * change; comments, layout and every other setting stay. A dated copy is kept (the last three), and the
 * result must read back as intended before it replaces the file. Returns whether the file changed.
 */
export function syncPrimaryConfig(): boolean {
  const primary = primaryId();
  if (!primary) return false;
  const file = primaryConfigPath();
  if (!fs.existsSync(file)) throw new Error(`The main agent’s settings file is missing (${file}).`);
  const text = fs.readFileSync(file, 'utf8');
  const doc = YAML.parseDocument(text);
  if (doc.errors.length) throw new Error('The main agent’s settings file could not be read, so it was left as it is.');
  const want = connectorEntriesFor(primary);
  const managed = new Set(managedConnectorNames());

  const servers = doc.get('mcp_servers');
  if (!YAML.isMap(servers)) {
    if (servers != null && !(YAML.isScalar(servers) && servers.value == null)) throw new Error('mcp_servers in the main agent’s settings is in a form Botly does not edit.');
    if (!Object.keys(want).length) return false;
    doc.set('mcp_servers', doc.createNode({}));
  }
  for (const name of managed) if (!(name in want) && doc.hasIn(['mcp_servers', name])) doc.deleteIn(['mcp_servers', name]);
  for (const [name, entry] of Object.entries(want)) {
    const cur = doc.getIn(['mcp_servers', name]) as any;
    const curJs = cur && typeof cur.toJSON === 'function' ? cur.toJSON() : cur;
    if (!same(curJs, entry)) doc.setIn(['mcp_servers', name], doc.createNode(entry));
  }
  const next = doc.toString();
  if (next === text) return false;

  // Read back: nothing but Botly's keys may differ.
  const before = YAML.parse(text) ?? {};
  const after = YAML.parse(next) ?? {};
  const rest = (o: any) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'mcp_servers'));
  const others = (o: any) => Object.fromEntries(Object.entries(o?.mcp_servers ?? {}).filter(([k]) => !managed.has(k) && !(k in want)));
  const mine = Object.fromEntries(Object.entries(after.mcp_servers ?? {}).filter(([k]) => k in want));
  if (!same(rest(before), rest(after)) || !same(others(before), others(after)) || !same(Object.keys(mine).sort(), Object.keys(want).sort())) {
    throw new Error('Changing the main agent’s settings would have touched other settings, so it was left as it is.');
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  fs.copyFileSync(file, `${file}.before-connectors-${stamp}`);
  const dir = path.dirname(file);
  const base = path.basename(file);
  const old = fs.readdirSync(dir).filter((f) => f.startsWith(`${base}.before-connectors-`)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 3))) fs.rmSync(path.join(dir, f), { force: true });
  const tmp = `${file}.connectors-tmp`;
  const st = fs.statSync(file);
  fs.writeFileSync(tmp, next, { mode: st.mode & 0o777 });
  try { fs.chownSync(tmp, st.uid, st.gid); } catch { /* not root: same owner anyway */ }
  fs.renameSync(tmp, file);
  return true;
}

// ---------- testing a server ----------

export interface ProbeResult { ok: boolean; tools: ConnectorTool[]; error: string; serverName?: string }

/** Read one JSON-RPC answer (by id) from a JSON or event-stream response, then stop reading. */
async function rpcAnswer(res: Response, id: number): Promise<any> {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('text/event-stream')) {
    const body = await res.text();
    const parsed = parseJson<any>(body, null);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const hit = list.find((m) => m && m.id === id);
    if (!hit) throw new Error(body.trim() ? 'The server answered, but not like an MCP server.' : 'The server sent an empty answer.');
    return hit;
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.search(/\r?\n\r?\n/)) >= 0) {
        const event = buf.slice(0, cut);
        buf = buf.slice(cut).replace(/^\r?\n\r?\n/, '');
        const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        const msg = parseJson<any>(data, null);
        if (msg && msg.id === id) return msg;
      }
    }
  } finally { reader.cancel().catch(() => {}); }
  throw new Error('The server closed the connection before answering.');
}

/** Connect the way a bot would (MCP over streamable HTTP), and list the tools. */
export async function probeConnector(url: string, headers: Record<string, string>): Promise<ProbeResult> {
  const fail = (error: string): ProbeResult => ({ ok: false, tools: [], error });
  let session = '';
  let version = '2025-06-18';
  const post = async (body: any) => {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers };
    if (session) h['Mcp-Session-Id'] = session;
    if (body.method !== 'initialize') h['MCP-Protocol-Version'] = version;
    return fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  };
  const httpError = (r: Response) =>
    r.status === 401 || r.status === 403 ? `The server refused access (${r.status}). Check the key, or whether this server needs a sign-in that Botly can’t do yet.`
      : r.status === 404 ? 'Nothing found at that address (404). Check the URL.'
        : r.status === 405 ? 'That address doesn’t accept MCP requests (405). It may use the older SSE transport, which Botly doesn’t support.'
          : `The server answered with an error (${r.status}).`;
  try {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'botly', version: '1.0' } } });
    if (!init.ok) return fail(httpError(init));
    session = init.headers.get('mcp-session-id') ?? '';
    const hello = await rpcAnswer(init, 1);
    if (hello.error) return fail(`The server said: ${hello.error.message ?? 'error'}`);
    version = hello.result?.protocolVersion ?? version;
    const serverName = hello.result?.serverInfo?.name;
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).then((r) => r.body?.cancel()).catch(() => {});
    const tools: ConnectorTool[] = [];
    let cursor: string | undefined;
    for (let page = 0, id = 2; page < 10; page++, id++) {
      const r = await post({ jsonrpc: '2.0', id, method: 'tools/list', params: cursor ? { cursor } : {} });
      if (!r.ok) return fail(httpError(r));
      const m = await rpcAnswer(r, id);
      if (m.error) return fail(`The server said: ${m.error.message ?? 'error'}`);
      for (const t of m.result?.tools ?? []) {
        if (tools.length >= 300) break;
        tools.push({ name: String(t.name), description: String(t.description ?? '').split('\n')[0].slice(0, 160) });
      }
      cursor = m.result?.nextCursor;
      if (!cursor) break;
    }
    if (session) fetch(url, { method: 'DELETE', headers: { ...headers, 'Mcp-Session-Id': session }, signal: AbortSignal.timeout(5000) }).then((r) => r.body?.cancel()).catch(() => {});
    return { ok: true, tools, error: '', serverName };
  } catch (e: any) {
    const why = String(e?.cause?.message ?? '');
    const msg = String(e?.cause?.code ?? e?.cause?.errors?.[0]?.code ?? why.match(/\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH)\b/)?.[1] ?? e?.name ?? '');
    if (msg === 'TimeoutError' || e?.name === 'TimeoutError') return fail('The server took too long to answer.');
    if (msg === 'ENOTFOUND') return fail('That address could not be found. Check the URL.');
    if (msg === 'ECONNREFUSED') return fail('The server refused the connection.');
    if (/CERT|SSL|TLS/i.test(msg)) return fail('The server’s security certificate could not be verified.');
    if (msg === 'EHOSTUNREACH' || msg === 'ETIMEDOUT') return fail('The server could not be reached.');
    return fail(`Could not connect${why ? `: ${why}` : e?.message ? `: ${e.message}` : '.'}`);
  }
}
