import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/** A secret from NAME, or from the file named by NAME_FILE (so keys need not sit in .env). */
function secret(name: string, optional = false): string {
  const direct = process.env[name];
  if (direct) return direct;
  const file = process.env[`${name}_FILE`];
  if (file) return fs.readFileSync(file, 'utf8').trim();
  if (optional) return '';
  throw new Error(`Missing env ${name} (or ${name}_FILE)`);
}

/**
 * Where the bots' screens come from. "orgo": an Orgo computer (needs ORGO_API_KEY). "local": X displays
 * on this machine (Xvfb + x11vnc), no Orgo at all. Default: local unless an Orgo key is set.
 */
const screensMode = (process.env.BOTLY_SCREENS ?? process.env.HQ_SCREENS) ?? (process.env.ORGO_API_KEY || process.env.ORGO_API_KEY_FILE ? 'orgo' : 'local');
const localScreens = screensMode === 'local';

if (process.env.DB_PATH === '/opt/hq/data/hq.db') {
  throw new Error('Existing HQ installation detected. Run the migration in docs/BOTLY-MIGRATION.md.');
}
const dataDir = new URL('../../data/', import.meta.url);
const dbFile = ['botly.db', 'grokbot.db', 'hq.db'].find((name) => fs.existsSync(new URL(name, dataDir))) ?? 'botly.db';
const hermesHome = process.env.HERMES_HOME_PRIMARY ?? path.join(os.homedir(), '.hermes');

export const env = {
  port: Number(process.env.PORT ?? 8787),
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  /** Public URL of this server, used for OAuth callbacks. */
  serverUrl: process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 8787}`,
  /** Optional: without it voice and research on X are off. */
  xaiKey: process.env.XAI_API_KEY ?? '',
  xaiModel: process.env.XAI_MODEL ?? 'grok-4.7',
  /** Optional: without it there are no connected apps. */
  composioKey: process.env.COMPOSIO_API_KEY ?? '',
  orgoKey: secret('ORGO_API_KEY', localScreens),
  /** Screens are X displays on this machine instead of an Orgo computer. */
  localScreens,
  sessionSecret: req('SESSION_SECRET'),
  devLogin: process.env.DEV_LOGIN === '1',
  dbPath: process.env.DB_PATH ?? new URL(dbFile, dataDir).pathname,

  // ---- Hermes engine ----
  /** The `hermes` CLI used to start a gateway for each extra bot. */
  hermesBin: process.env.HERMES_BIN ?? 'hermes',
  /** The primary bot's Hermes home and API server (an agent that already runs; never restarted by us). */
  hermesHome,
  hermesUrl: (process.env.HERMES_URL ?? 'http://127.0.0.1:8642').replace(/\/+$/, ''),
  hermesKey: process.env.HERMES_KEY ?? '',
  /** Where each extra bot's own Hermes home lives. Must be outside ~/.hermes so it is a separate tenant. */
  enginesDir: process.env.ENGINES_DIR ?? new URL('../../data/engines', import.meta.url).pathname,
  enginePortBase: Number(process.env.ENGINE_PORT_BASE ?? 8650),
  /** URL the Hermes gateways use to reach this server's MCP endpoint. */
  mcpBaseUrl: (process.env.MCP_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8787}`).replace(/\/+$/, ''),
  /** Extra MCP servers every managed bot gets, as a JSON object of Hermes `mcp_servers` entries (e.g. X's XMCP). */
  extraMcpServers: process.env.EXTRA_MCP_SERVERS ?? '',
  /** Opt-in: expose Hermes' native Browser Use CLI browser_exec in managed bot API sessions. */
  browserUseToolsets: process.env.BOTLY_BROWSER_USE_TOOLSETS === '1',
  primaryBotName: process.env.PRIMARY_BOT_NAME ?? 'Marvelous',
  primaryBotLabel: process.env.PRIMARY_BOT_LABEL ?? 'Chief of Staff',

  // ---- the one shared computer ----
  /** The Orgo computer every bot works on (one screen each). Empty = legacy one-box-per-user mode is not supported. */
  orgoComputerId: localScreens ? 'local' : process.env.ORGO_COMPUTER_ID ?? '',
  /** This server runs on that computer, so shell commands run locally instead of through Orgo's API. */
  localBox: localScreens || (process.env.BOTLY_LOCAL ?? process.env.HQ_LOCAL) === '1',
  /**
   * DevTools URL of a Chrome that already runs on the default screen and belongs to the primary bot
   * (e.g. http://127.0.0.1:9333). When set, we never start or stop that screen's Chrome ourselves.
   */
  primaryCdpUrl: process.env.PRIMARY_CDP_URL ?? '',
  /** Bots that can each have a screen (Orgo allows four screens on one Linux computer). */
  maxBots: Number(process.env.MAX_BOTS ?? 4),
  /** Hermes approvals.mode for the bots this app starts ('off' = no prompts, which nobody could answer anyway). Empty = leave Hermes' setting. */
  agentApprovals: (process.env.BOTLY_AGENT_APPROVALS ?? process.env.HQ_AGENT_APPROVALS) ?? (localScreens ? 'off' : ''),
  /** Comma-separated emails allowed to sign in; empty = anyone who can reach the app. */
  allowedEmails: (process.env.ALLOWED_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  /** Server-owner actions are disabled when no owner can be identified. */
  ownerEmail: (process.env.BOTLY_OWNER_EMAIL ?? (process.env.ALLOWED_EMAILS ?? '').split(',')[0] ?? '').trim().toLowerCase(),
};
