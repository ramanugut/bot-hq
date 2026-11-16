import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { displayFor } from './box.js';
import { cdpUrlFor, screenFor } from './computer.js';
import { db } from './db.js';
import { env } from './env.js';
import { agentUsername, assertSafeAgentFile, requireAgentIdentity } from './security/agent-identity.js';
import { restrictManagedProfile } from './security/restricted-profile.js';
import type { EngineInfo, EngineProvider } from './types.js';

/**
 * Every bot is run by a Hermes agent.
 *
 * - The 'primary' engine is a Hermes gateway that already runs on the computer (HERMES_URL, home
 *   HERMES_HOME_PRIMARY). It has its own life: messaging, memory, model. We only talk to its API
 *   server; we never write its config, restart it or stop it.
 * - A 'managed' engine is a Hermes home of our own under ENGINES_DIR/<botId> with its own
 *   `hermes gateway run`, started here and left running when this server exits. Its home sits
 *   outside ~/.hermes, so Hermes treats it as a separate tenant beside the primary gateway.
 */

export type EngineKind = 'primary' | 'managed';
export interface Engine { kind: EngineKind; url: string; key: string; home: string }

const botRow = (botId: string) => db.prepare('SELECT * FROM bots WHERE id=?').get(botId) as any;

// ---------- small file helpers ----------

/** KEY=value lines of a dotenv file (quotes stripped). Missing file = {}. */
function readDotenv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function readYaml(file: string): any {
  try { return YAML.parse(fs.readFileSync(file, 'utf8')) ?? {}; } catch { return {}; }
}

function writePrivate(file: string, content: string, owner?: { uid: number; gid: number; home: string }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (owner) assertSafeAgentFile(file, owner.home);
  // Atomic replacement prevents a managed bot from swapping a config path
  // for a symlink while the privileged app is writing it.
  const tmp = `${file}.${crypto.randomBytes(10).toString('hex')}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, content);
    if (owner) fs.fchownSync(fd, owner.uid, owner.gid);
    fs.fchmodSync(fd, 0o600);
    fs.closeSync(fd);
    fd = undefined;
    // Replacing a symlink does not follow it. All chmod/chown calls are on
    // the open fd *before* rename, avoiding races with an agent-owned home.
    fs.renameSync(tmp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch { /* already renamed */ }
  }
}

function assertRegularOrMissing(file: string) {
  try {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile()) throw new Error('Unsafe non-regular managed-agent file');
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e;
  }
}

function assertRunningAgentIdentity(botId: string) {
  if (!env.restrictedAgents) return;
  const identity = requireAgentIdentity(botId, homeFor(botId));
  const pid = gatewayPid(identity.home);
  if (!pid) throw new Error('A restricted managed gateway must be started by Botly and verified before reuse');
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
  const line = /^Uid:\s+(\d+)\s+(\d+)/m.exec(status);
  if (!line || Number(line[2]) !== identity.uid) {
    throw new Error('Refusing an existing managed gateway that is not running as its dedicated agent user');
  }
}

// ---------- identity ----------

/** Token a bot's Hermes agent presents to this server's MCP endpoint. `primary` names the primary bot. */
export function mcpToken(botId: string): string {
  return crypto.createHmac('sha256', env.sessionSecret).update(`mcp:${botId}`).digest('hex');
}

export function primaryBotId(): string | null {
  return (db.prepare("SELECT id FROM bots WHERE engine='primary' LIMIT 1").get() as any)?.id ?? null;
}

export function engineKind(botId: string): EngineKind | null {
  const e = botRow(botId)?.engine;
  return e === 'primary' || e === 'managed' ? e : null;
}

const homeFor = (botId: string) => path.join(env.enginesDir, botId);

let cachedPrimaryKey: string | null = null;
function primaryKey(): string {
  if (env.hermesKey) return env.hermesKey;
  if (cachedPrimaryKey === null) cachedPrimaryKey = readDotenv(path.join(env.hermesHome, '.env')).API_SERVER_KEY ?? '';
  return cachedPrimaryKey;
}

// ---------- assignment ----------

function freePort(): number {
  const used = new Set((db.prepare('SELECT engine_port FROM bots WHERE engine_port IS NOT NULL').all() as any[]).map((r) => r.engine_port as number));
  let p = env.enginePortBase;
  while (used.has(p)) p++;
  return p;
}

/** Give a new agent bot its engine: the existing agent if nobody has it yet, otherwise one of our own. */
export function assignEngine(botId: string): EngineKind {
  const b = botRow(botId);
  if (!b) throw new Error('bot not found');
  if (b.engine === 'primary' || b.engine === 'managed') return b.engine;
  if (!primaryBotId()) {
    db.prepare("UPDATE bots SET engine='primary', engine_port=NULL WHERE id=?").run(botId);
    return 'primary';
  }
  db.prepare("UPDATE bots SET engine='managed', engine_port=? WHERE id=?").run(freePort(), botId);
  return 'managed';
}

// ---------- a managed bot's Hermes home ----------

/** Model credentials a managed agent may inherit from the primary agent. Never messaging tokens. */
const SHARED_ENV = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENROUTER_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'NOUS_API_KEY',
  'FIRECRAWL_API_KEY', 'TAVILY_API_KEY', 'EXA_API_KEY', 'PARALLEL_API_KEY',
];

/** Parts of the primary agent's config a managed agent starts from, so it reaches the same models. */
const SHARED_CONFIG = ['model', 'providers', 'custom_providers', 'auxiliary', 'fallback_model', 'fallback_providers', 'image_gen'];

function soul(b: any): string {
  const owner = (db.prepare('SELECT name FROM users WHERE id=?').get(b.user_id) as any)?.name ?? 'the user';
  const role = b.label ? `, ${b.label}` : '';
  return [
    `You are ${b.name}${role}. You work for ${owner} as one of a small team of AI agents, each with its own screen on a shared computer.`,
    b.description ? `\n${b.description}` : '',
    '\nYou are direct, warm and brief. You do the work rather than describe it, and you say plainly what you did and what you could not do.',
    '',
  ].join('\n');
}

/** Rewrite the persona file after a rename or a new description. The primary agent keeps its own, and a soul the user wrote stays. */
export function syncPersona(botId: string) {
  const b = botRow(botId);
  if (!b || b.engine !== 'managed' || b.soul_custom) return;
  const home = homeFor(botId);
  if (!fs.existsSync(home)) return;
  const file = path.join(home, 'SOUL.md');
  const owner = env.restrictedAgents ? requireAgentIdentity(botId, home) : undefined;
  if (owner) { assertSafeAgentFile(file, home); assertRegularOrMissing(file); }
  writePrivate(file, soul(b), owner);
}

// ---------- the soul (SOUL.md): who the bot is, editable in Bot settings ----------

const soulFile = (botId: string): string | null => {
  const home = engineHome(botId);
  return home ? path.join(home, 'SOUL.md') : null;
};

export const SOUL_MAX = 20_000;

/** The bot's soul as Hermes reads it. `custom` = the user wrote it (renames no longer rewrite it). */
export function readSoul(botId: string): { text: string; custom: boolean; suggested: string } {
  const b = botRow(botId);
  const suggested = b ? soul(b) : '';
  const file = soulFile(botId);
  let text = '';
  if (file && env.restrictedAgents && b?.engine === 'managed') {
    const home = homeFor(botId);
    assertSafeAgentFile(file, home);
    assertRegularOrMissing(file);
  }
  try { if (file) text = fs.readFileSync(file, 'utf8'); } catch { /* not written yet */ }
  return { text: text || suggested, custom: !!b?.soul_custom, suggested };
}

/** Save the soul, or put the app's default back (text = null). */
export function writeSoul(botId: string, text: string | null) {
  const b = botRow(botId);
  const file = soulFile(botId);
  if (!b || !file) throw new Error('This bot has no engine yet; send it a message first.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = text === null ? soul(b) : text.slice(0, SOUL_MAX);
  const home = homeFor(botId);
  const owner = env.restrictedAgents && b.engine === 'managed' ? requireAgentIdentity(botId, home) : undefined;
  if (owner) { assertSafeAgentFile(file, home); assertRegularOrMissing(file); }
  writePrivate(file, body.endsWith('\n') ? body : `${body}\n`, owner);
  db.prepare('UPDATE bots SET soul_custom=? WHERE id=?').run(text === null ? 0 : 1, botId);
}

function extraMcpServers(): Record<string, any> {
  if (!env.extraMcpServers) return {};
  try {
    const v = JSON.parse(env.extraMcpServers);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    console.warn('[engine] EXTRA_MCP_SERVERS is not valid JSON; ignored');
    return {};
  }
}

/** Create or refresh the home. config.yaml is created once; after that only the keys we own are patched. */
async function writeHome(botId: string): Promise<{ home: string; key: string; display: string | null }> {
  const b = botRow(botId);
  const home = homeFor(botId);
  // Require offline provisioning first. Never silently run a protected agent as root.
  const identity = env.restrictedAgents ? requireAgentIdentity(botId, home) : undefined;
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(home, 'locks'), { recursive: true });
  fs.chmodSync(home, 0o700);
  if (identity) {
    for (const sub of ['logs', 'locks']) {
      const dir = path.join(home, sub);
      assertSafeAgentFile(path.join(dir, '.check'), home);
      // Work on the opened directory, not on a path the bot could swap.
      const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      try { fs.fchownSync(fd, identity.uid, identity.gid); fs.fchmodSync(fd, 0o700); }
      finally { fs.closeSync(fd); }
    }
  }

  // Its screen decides which display and which Chrome it drives. Only meaningful on the computer itself.
  let display: string | null = null;
  let cdp = '';
  if (env.localBox) {
    try {
      const s = await screenFor(b.user_id, botId);
      display = displayFor(s.screenId);
      cdp = cdpUrlFor(botId, s.screenId);
    } catch (e: any) {
      console.warn(`[engine] no screen for ${b.name} yet: ${e?.message ?? e}`);
    }
  }

  const cwd = identity ? path.join(home, 'workspace') : env.localBox ? `/root/botly/files/${botId}` : path.join(home, 'workspace');
  fs.mkdirSync(cwd, { recursive: true });
  if (identity) {
    assertSafeAgentFile(path.join(cwd, '.check'), home);
    const fd = fs.openSync(cwd, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fchownSync(fd, identity.uid, identity.gid); fs.fchmodSync(fd, 0o700); }
    finally { fs.closeSync(fd); }
  }

  const cfgFile = path.join(home, 'config.yaml');
  if (identity) {
    assertSafeAgentFile(cfgFile, home);
    assertRegularOrMissing(cfgFile);
  }
  const fresh = !fs.existsSync(cfgFile);
  const cfg = fresh ? {} : readYaml(cfgFile);
  if (fresh) {
    const primary = readYaml(path.join(env.hermesHome, 'config.yaml'));
    for (const k of SHARED_CONFIG) if (primary[k] !== undefined) cfg[k] = primary[k];
    cfg.agent = { reasoning_effort: 'medium' };
  }
  cfg.platform_toolsets = { ...(cfg.platform_toolsets ?? {}), api_server: ['hermes-api-server', ...(display ? ['computer_use'] : [])] };
  cfg.terminal = { ...(cfg.terminal ?? {}), cwd };
  // Nobody can answer Hermes' own approval prompts through the app, so a prompt would only time out.
  // BOTLY_AGENT_APPROVALS=off lets bots act on their own screen (Hermes' hard blocks still apply).
  if (env.agentApprovals) cfg.approvals = { ...(cfg.approvals ?? {}), mode: env.agentApprovals };
  if (cdp) cfg.browser = { ...(cfg.browser ?? {}), cdp_url: cdp };
  const existingMcp = { ...(cfg.mcp_servers ?? {}) };
  if (String(existingMcp.hq?.url ?? '').endsWith(`/mcp/${botId}`)) delete existingMcp.hq;
  cfg.mcp_servers = {
    ...existingMcp,
    ...(identity ? {} : extraMcpServers()),
    botly: { url: `${env.mcpBaseUrl}/mcp/${botId}`, headers: { Authorization: `Bearer ${mcpToken(botId)}` }, timeout: 1800, connect_timeout: 30 },
  };
  if (identity) restrictManagedProfile(cfg);
  writePrivate(cfgFile, YAML.stringify(cfg), identity);

  const soulPath = path.join(home, 'SOUL.md');
  if (identity) { assertSafeAgentFile(soulPath, home); assertRegularOrMissing(soulPath); }
  if (!fs.existsSync(soulPath)) writePrivate(soulPath, soul(b), identity);

  // Subscription sign-ins live in auth.json. Start from the primary agent's; later sign-ins are this bot's own.
  const auth = path.join(home, 'auth.json');
  if (identity) { assertSafeAgentFile(auth, home); assertRegularOrMissing(auth); }
  if (!fs.existsSync(auth)) {
    try { writePrivate(auth, fs.readFileSync(path.join(env.hermesHome, 'auth.json'), 'utf8'), identity); } catch { /* the primary agent has none */ }
  }

  // .env is ours entirely: the API server plus inherited model keys. Keys the user added by hand are kept.
  const envFile = path.join(home, '.env');
  if (identity) { assertSafeAgentFile(envFile, home); assertRegularOrMissing(envFile); }
  const mine = readDotenv(envFile);
  const key = mine.API_SERVER_KEY || crypto.randomBytes(24).toString('hex');
  const primaryEnv = readDotenv(path.join(env.hermesHome, '.env'));
  const vars: Record<string, string> = { ...mine };
  for (const k of SHARED_ENV) {
    const v = primaryEnv[k] ?? process.env[k];
    if (v && !vars[k]) vars[k] = v;
  }
  Object.assign(vars, { API_SERVER_ENABLED: 'true', API_SERVER_KEY: key, API_SERVER_PORT: String(b.engine_port), API_SERVER_HOST: '127.0.0.1' });
  if (cdp && !identity) vars.BROWSER_CDP_URL = cdp; else delete vars.BROWSER_CDP_URL;
  if (identity) { delete vars.BU_CDP_WS; delete vars.BU_CDP_URL; }
  writePrivate(envFile, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', identity);

  return { home, key, display };
}

// ---------- a managed bot's gateway ----------

async function healthy(url: string, timeoutMs = 2500): Promise<any | null> {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function keyAccepted(url: string, key: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/v1/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch { return false; }
}

/** The gateway's pid, but only if the pid file belongs to this home and the process is alive. */
function gatewayPid(home: string): number | null {
  let raw = '';
  try { raw = fs.readFileSync(path.join(home, 'gateway.pid'), 'utf8').trim(); } catch { return null; }
  let pid = NaN;
  try {
    const j = JSON.parse(raw);
    if (typeof j === 'number') pid = j;
    else {
      if (j?.hermes_home && path.resolve(j.hermes_home) !== path.resolve(home)) return null;
      pid = Number(j?.pid);
    }
  } catch { pid = Number(raw); }
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try { process.kill(pid, 0); } catch { return null; }
  try {
    if (!fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('gateway')) return null;
    if (env.restrictedAgents) {
      const identity = requireAgentIdentity(path.basename(home), home);
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const uids = /^Uid:\s+(\d+)\s+(\d+)/m.exec(status);
      if (!uids || Number(uids[2]) !== identity.uid) return null;
      const processEnv = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
      if (!processEnv.split('\0').includes(`HERMES_HOME=${home}`)) return null;
    }
  } catch { return null; }
  return pid;
}

async function stopGateway(botId: string) {
  const home = homeFor(botId);
  const pid = gatewayPid(home);
  if (!pid) return;
  const signal = (sig: NodeJS.Signals) => {
    try { process.kill(-pid, sig); } catch { try { process.kill(pid, sig); } catch { /* gone */ } }
  };
  signal('SIGTERM');
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { process.kill(pid, 0); } catch { return; }
  }
  signal('SIGKILL');
  await new Promise((r) => setTimeout(r, 300));
}

const starting = new Map<string, Promise<void>>();
const failures = new Map<string, string>();
const keys = new Map<string, string>();

function managedUrl(botId: string): string {
  return `http://127.0.0.1:${botRow(botId).engine_port}`;
}

function managedKey(botId: string): string {
  let k = keys.get(botId);
  if (!k) {
    if (env.restrictedAgents) {
      const file = path.join(homeFor(botId), '.env');
      assertSafeAgentFile(file, homeFor(botId));
      assertRegularOrMissing(file);
    }
    k = readDotenv(path.join(homeFor(botId), '.env')).API_SERVER_KEY ?? '';
    if (k) keys.set(botId, k);
  }
  return k;
}

async function startGateway(botId: string): Promise<void> {
  const b = botRow(botId);
  if (!b || b.engine !== 'managed') throw new Error('not a managed engine');
  if (!b.engine_port) db.prepare('UPDATE bots SET engine_port=? WHERE id=?').run(freePort(), botId);
  const url = managedUrl(botId);

  // A previously running root gateway may NOT be adopted in restricted mode.
  if ((await healthy(url)) && managedKey(botId) && (await keyAccepted(url, managedKey(botId)))) {
    assertRunningAgentIdentity(botId);
    return;
  }
  if (await healthy(url)) {
    if (gatewayPid(homeFor(botId))) await stopGateway(botId);
    else throw new Error(`Port ${botRow(botId).engine_port} is taken by something else.`);
  }

  const { home, key, display } = await writeHome(botId);
  const agentIdentity = env.restrictedAgents ? requireAgentIdentity(botId, home) : undefined;
  keys.set(botId, key);
  if (gatewayPid(home)) await stopGateway(botId);

  // In restricted mode, only root can traverse the stdout log directory.
  // A bot must never be able to replace the log path with a symlink.
  const logDir = '/var/log/botly/agents';
  if (agentIdentity) {
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(logDir, 0o700);
  }
  const logPath = agentIdentity ? path.join(logDir, `${agentUsername(botId)}.log`) : path.join(home, 'logs', 'gateway.out.log');
  const log = fs.openSync(logPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
  const child = spawn(env.hermesBin, ['gateway', 'run', '--no-supervise'], {
    cwd: home,
    detached: true,
    ...(agentIdentity ? { uid: agentIdentity.uid, gid: agentIdentity.gid } : {}),
    stdio: ['ignore', log, log],
    // Only what the agent needs. None of this server's secrets, and nothing of the primary agent's messaging.
    env: {
      PATH: process.env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: agentIdentity?.home ?? process.env.HOME ?? '/root',
      USER: agentIdentity?.username ?? process.env.USER ?? 'root',
      LOGNAME: agentIdentity?.username ?? process.env.USER ?? 'root',
      LANG: process.env.LANG ?? 'C.UTF-8',
      HERMES_HOME: home,
      HERMES_GATEWAY_LOCK_DIR: path.join(home, 'locks'),
      // Hermes' browser tool talks to a helper process it finds under this folder. With the default
      // (one folder per HOME) every agent on the computer would end up driving the same browser.
      BH_HOME: path.join(home, 'browser-harness'),
      ...(display ? { DISPLAY: display } : {}),
    },
  });
  fs.closeSync(log);
  let exited: string | null = null;
  child.once('error', (e) => { exited = `could not run ${env.hermesBin}: ${e.message}`; });
  child.once('exit', (code) => { exited = `the agent stopped while starting (exit ${code}). See ${path.join(home, 'logs', 'gateway.out.log')}`; });
  child.unref();

  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (exited) throw new Error(exited);
    if (await healthy(url, 1500)) {
      console.log(`[engine] ${b.name}: gateway up on ${url}`);
      return;
    }
  }
  throw new Error('The agent did not come up within 90 seconds.');
}

/** Start (or adopt) the bot's gateway. Safe to call often; concurrent calls share one start. */
function ensureManaged(botId: string): Promise<void> {
  let p = starting.get(botId);
  if (!p) {
    p = startGateway(botId)
      .then(() => { failures.delete(botId); })
      .catch((e: any) => {
        const msg = String(e?.message ?? e);
        failures.set(botId, msg);
        console.warn(`[engine] ${botId}: ${msg}`);
        throw e;
      })
      .finally(() => starting.delete(botId));
    starting.set(botId, p);
  }
  return p;
}

/** Where to send this bot's turns. Starts its gateway if it is not running. */
export async function engineFor(botId: string): Promise<Engine> {
  let kind = engineKind(botId);
  if (!kind) {
    const b = botRow(botId);
    if (!b) throw new Error('bot not found');
    if (b.kind === 'room') throw new Error('A group chat has no agent of its own.');
    kind = assignEngine(botId);
  }
  if (kind === 'primary') return { kind, url: env.hermesUrl, key: primaryKey(), home: env.hermesHome };
  const url = managedUrl(botId);
  if (env.restrictedAgents && await healthy(url, 1500)) assertRunningAgentIdentity(botId);
  if (!(await healthy(url, 1500)) || !managedKey(botId)) await ensureManaged(botId);
  if (env.restrictedAgents) assertRunningAgentIdentity(botId);
  return { kind, url, key: managedKey(botId), home: homeFor(botId) };
}

/** The bot's Hermes home, without starting anything (memory files, sign-in commands). */
export function engineHome(botId: string): string | null {
  const kind = engineKind(botId);
  return kind === 'primary' ? env.hermesHome : kind === 'managed' ? homeFor(botId) : null;
}

/**
 * Hermes can run a private screen of its own for a profile (its "Bot Desktop": an Xvnc display with
 * state in <home>/bot-desktop). While that screen is up, the agent's computer-use tool acts there and
 * not on the screen this app shows (so does its browser tool, unless the config pins it to a Chrome
 * with `browser.cdp_url`), so the user could be watching an idle desktop.
 */
export function ownScreenOn(botId: string): boolean {
  const home = engineHome(botId);
  if (!home) return false;
  const dir = path.join(home, 'bot-desktop');
  try {
    // launcher.pid holds "<pid> <create time>"; the env file appears once the screen is usable.
    const pid = Number(fs.readFileSync(path.join(dir, 'launcher.pid'), 'utf8').trim().split(/\s+/)[0]);
    if (!Number.isInteger(pid) || pid <= 1 || !fs.existsSync(path.join(dir, 'env'))) return false;
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM';
  }
}

/** Ask Hermes to stop that private screen. Hermes refuses while a person is using it; the refusal is passed on. */
export function stopOwnScreen(botId: string): Promise<void> {
  const home = engineHome(botId);
  if (!home) return Promise.reject(new Error('This bot has no agent.'));
  return new Promise((resolve, reject) => {
    execFile(env.hermesBin, ['computer-use', 'screen', 'stop'], { env: { ...process.env, HERMES_HOME: home }, timeout: 60_000 }, (err, stdout, stderr) => {
      if (!ownScreenOn(botId)) return resolve();
      const said = `${stderr || ''}\n${stdout || ''}`.trim().split('\n').filter(Boolean).pop();
      reject(new Error(said || (err ? String(err.message) : 'The screen is still running.')));
    });
  });
}

/** Start the gateway in the background (after creating a bot, or on server start). */
export function provisionEngine(botId: string) {
  if (engineKind(botId) === 'managed') ensureManaged(botId).catch(() => {});
}

export async function restartEngine(botId: string): Promise<void> {
  if (engineKind(botId) !== 'managed') return;
  await starting.get(botId)?.catch(() => {});
  await stopGateway(botId);
  optionsCache.delete(botId);
  provisionEngine(botId);
}

/** The bot is gone: stop its gateway and delete its home. The primary agent is left alone. */
export async function removeEngine(botId: string): Promise<void> {
  const home = homeFor(botId);
  if (!fs.existsSync(home)) return;
  await starting.get(botId)?.catch(() => {});
  await stopGateway(botId);
  keys.delete(botId);
  failures.delete(botId);
  optionsCache.delete(botId);
  if (path.resolve(home).startsWith(path.resolve(env.enginesDir) + path.sep)) fs.rmSync(home, { recursive: true, force: true });
}

/** On server start: give older bots an engine, then bring the managed gateways up. */
export function initEngines() {
  fs.mkdirSync(env.enginesDir, { recursive: true });
  const bots = db.prepare("SELECT id, is_primary FROM bots WHERE engine IS NULL AND COALESCE(kind,'agent') <> 'room' AND COALESCE(hidden,0)=0 ORDER BY is_primary DESC, created_at ASC").all() as any[];
  for (const b of bots) assignEngine(b.id);
  for (const b of db.prepare("SELECT id FROM bots WHERE engine='managed'").all() as any[]) provisionEngine(b.id);
}

// ---------- what the settings panel shows ----------

/** Providers worth showing even when not signed in. */
const WELL_KNOWN = ['anthropic', 'openai-codex', 'xai-oauth', 'xai', 'openrouter', 'nous', 'gemini', 'openai-api'];

const optionsCache = new Map<string, { at: number; data: any }>();

async function modelOptions(botId: string, e: { url: string; key: string }): Promise<any | null> {
  const hit = optionsCache.get(botId);
  if (hit && Date.now() - hit.at < 15_000) return hit.data;
  try {
    const r = await fetch(`${e.url}/api/model/options`, { headers: e.key ? { Authorization: `Bearer ${e.key}` } : {}, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();
    optionsCache.set(botId, { at: Date.now(), data });
    return data;
  } catch { return null; }
}

function toProviders(data: any): EngineProvider[] {
  const list: any[] = Array.isArray(data?.providers) ? data.providers : [];
  const out = list
    .filter((p) => p?.slug && (p.authenticated || WELL_KNOWN.includes(p.slug)))
    .map((p): EngineProvider => {
      const featured = Array.isArray(p.featured_models) && p.featured_models.length ? p.featured_models : Array.isArray(p.models) ? p.models : [];
      return {
        id: String(p.slug),
        name: p.slug === 'anthropic' ? 'Claude (Anthropic)' : String(p.name ?? p.slug),
        // Hermes lists Anthropic as an API-key provider, yet it can also sign in to a Claude subscription. Offer that until a key is in place.
        kind: String(p.auth_type ?? '').includes('oauth') || (p.slug === 'anthropic' && !p.authenticated) ? 'subscription' : 'api_key',
        connected: !!p.authenticated,
        models: featured.filter((m: unknown) => typeof m === 'string').slice(0, 12),
      };
    });
  const rank = (p: EngineProvider) => (p.connected ? 0 : 1) * 100 + (WELL_KNOWN.indexOf(p.id) < 0 ? 50 : WELL_KNOWN.indexOf(p.id));
  return out.sort((a, b) => rank(a) - rank(b));
}

export async function engineInfo(botId: string): Promise<EngineInfo> {
  const b = botRow(botId);
  if (!b) throw new Error('bot not found');
  const kind = engineKind(botId);
  const base: EngineInfo = { botId, profile: kind === 'primary' ? 'default' : botId, status: 'stopped', error: null, model: b.model ?? null, provider: b.provider ?? null, version: null, providers: [], ownScreen: kind ? ownScreenOn(botId) : false };
  if (!kind) return { ...base, status: 'error', error: 'This bot has no agent.' };

  let e: { url: string; key: string };
  if (kind === 'primary') e = { url: env.hermesUrl, key: primaryKey() };
  else {
    if (!b.engine_port) return { ...base, status: 'error', error: 'No port assigned.' };
    e = { url: managedUrl(botId), key: managedKey(botId) };
  }

  const health = await healthy(e.url);
  if (!health) {
    if (kind === 'primary') return { ...base, status: 'error', error: `The agent at ${env.hermesUrl} is not answering.` };
    if (starting.has(botId)) return { ...base, status: 'starting' };
    const failed = failures.get(botId);
    if (failed) return { ...base, status: 'error', error: failed };
    provisionEngine(botId);
    return { ...base, status: 'starting' };
  }
  if (kind === 'managed' && starting.has(botId)) return { ...base, status: 'starting' };

  const data = await modelOptions(botId, e);
  return {
    ...base,
    status: 'ready',
    version: typeof health.version === 'string' && health.version !== 'unknown' ? health.version : null,
    model: b.model ?? data?.model ?? null,
    provider: b.provider ?? data?.provider ?? null,
    providers: toProviders(data),
  };
}

/** After a sign-in the provider list changes; drop what we remembered. */
export function forgetEngineOptions(botId: string) { optionsCache.delete(botId); }
