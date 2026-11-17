import { execFile } from 'node:child_process';
import { isBotBusy } from './agent/loop.js';
import { agentBots, connectorSignature, importExistingConnectors, syncPrimaryConfig } from './connections.js';
import { engineKind, restartEngine } from './engine.js';
import { env } from './env.js';
import type { ConnectorApply } from './types.js';

/**
 * Putting a connector change into effect. A Hermes agent reads its MCP servers when it starts, so each
 * bot whose connectors changed has its agent restarted: an extra bot's gateway through engine.ts (which
 * rewrites its config on the way up), the primary agent by editing its config (connections.ts) and
 * restarting its supervisor program. A bot that is in the middle of a turn is restarted when it is done.
 */

/** Bot id → connector fingerprint, taken before a change. */
export type Snapshot = Map<string, string>;

export function snapshot(): Snapshot {
  return new Map(agentBots().map((b) => [b.id, connectorSignature(b.id)]));
}

/** The primary agent cannot be restarted from here (no supervisor on this machine). */
class ManualRestart extends Error {}

const waiting = new Set<string>();
let timer: NodeJS.Timeout | null = null;

function restartPrimary(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('supervisorctl', ['restart', env.primaryHermesProgram], { timeout: 60_000 }, (err, stdout, stderr) => {
      if ((err as any)?.code === 'ENOENT') reject(new ManualRestart());
      else if (err) reject(new Error(`${stdout}${stderr}`.trim() || err.message));
      else resolve();
    });
  });
}

const canRestartPrimary = () => env.localBox && !!env.primaryHermesProgram;

async function restartBot(botId: string): Promise<void> {
  if (engineKind(botId) === 'primary') await restartPrimary();
  else await restartEngine(botId);
}

function scheduleWaiting() {
  if (timer || !waiting.size) return;
  timer = setInterval(() => {
    for (const id of [...waiting]) {
      if (isBotBusy(id)) continue;
      waiting.delete(id);
      restartBot(id).catch((e) => console.warn(`[connectors] restart of ${id} failed: ${e?.message ?? e}`));
    }
    if (!waiting.size && timer) { clearInterval(timer); timer = null; }
  }, 15_000);
  timer.unref();
}

/** Restart the agents of the bots whose connectors differ from `before`. */
export async function applyConnectorChange(before: Snapshot, opts: { skipPrimary?: boolean } = {}): Promise<ConnectorApply[]> {
  const out: ConnectorApply[] = [];
  for (const b of agentBots()) {
    if (before.get(b.id) === connectorSignature(b.id)) continue;
    const kind = engineKind(b.id);
    if (!kind) continue; // no agent yet: it reads its connectors when it gets one
    if (kind === 'primary' && opts.skipPrimary) continue;
    try {
      if (kind === 'primary') {
        if (!syncPrimaryConfig()) continue;
        if (!canRestartPrimary()) {
          out.push({ botId: b.id, name: b.name, result: 'manual', message: `Saved. Restart ${b.name}’s agent to load it.` });
          continue;
        }
      }
      if (isBotBusy(b.id)) {
        waiting.add(b.id);
        scheduleWaiting();
        out.push({ botId: b.id, name: b.name, result: 'waiting', message: `${b.name} is busy; it picks this up when it finishes.` });
        continue;
      }
      await restartBot(b.id);
      out.push({ botId: b.id, name: b.name, result: 'restarted' });
    } catch (e: any) {
      if (e instanceof ManualRestart) out.push({ botId: b.id, name: b.name, result: 'manual', message: `Saved. Restart ${b.name}’s agent to load it.` });
      else out.push({ botId: b.id, name: b.name, result: 'error', message: e?.message ?? String(e) });
    }
  }
  return out;
}

/** On server start, after the engines: bring in servers set up before Settings → Connectors existed. */
export function initConnectors() {
  try {
    const before = snapshot();
    importExistingConnectors();
    // Extra bots that are already running get servers just brought in (add-mcp.sh already gave them to the
    // primary agent and restarted it). Gateways come up in the background, so give them a moment first.
    const t = setTimeout(() => {
      applyConnectorChange(before, { skipPrimary: true })
        .then((r) => r.forEach((a) => a.result === 'error' && console.warn(`[connectors] ${a.name}: ${a.message}`)))
        .catch(() => {});
    }, 20_000);
    t.unref();
  } catch (e: any) { console.warn(`[connectors] import skipped: ${e?.message ?? e}`); }
}
