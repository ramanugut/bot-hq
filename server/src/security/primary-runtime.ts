import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { requirePrimaryIdentity } from './agent-identity.js';
import { DISABLED_DIRECT_TOOLSETS, isRestrictedToolsetSafe } from './restricted-profile.js';

/** Check the effective owner of the TCP process LISTENING on the Hermes API port. */
export function listeningUid(port: number): number | null {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('Invalid Hermes listener port');
  const portHex = port.toString(16).toUpperCase().padStart(4, '0');
  const inodes = new Set<string>();
  for (const filename of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text: string;
    try { text = fs.readFileSync(filename, 'utf8'); } catch { continue; }
    for (const line of text.split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length >= 10 && fields[1].endsWith(':' + portHex) && fields[3] === '0A') inodes.add(fields[9]);
    }
  }
  if (!inodes.size) return null;
  for (const proc of fs.readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    const fdDir = '/proc/' + proc + '/fd';
    let fds: string[];
    try { fds = fs.readdirSync(fdDir); } catch { continue; }
    for (const fd of fds) {
      let link: string;
      try { link = fs.readlinkSync(path.join(fdDir, fd)); } catch { continue; }
      const socket = /^socket:\[(\d+)\]$/.exec(link);
      if (!socket || !inodes.has(socket[1])) continue;
      const status = fs.readFileSync('/proc/' + proc + '/status', 'utf8');
      const match = /^Uid:\s+(\d+)\s+(\d+)/m.exec(status);
      if (match) return Number(match[2]);
    }
  }
  return null;
}

/**
 * Refuse a stale root primary gateway even when the HTTP health endpoint
 * responds. This is a runtime guard, not an OS sandbox.
 */
export function assertRestrictedPrimary(home: string, gatewayUrl: string): void {
  const identity = requirePrimaryIdentity(home);
  const cfgPath = path.join(home, 'config.yaml');
  const cfg = YAML.parse(fs.readFileSync(cfgPath, 'utf8')) ?? {};
  if (!isRestrictedToolsetSafe(cfg.platform_toolsets?.api_server ?? [])) {
    throw new Error('Primary Hermes API toolsets are not restricted');
  }
  const blocked: string[] = cfg.agent?.disabled_toolsets ?? [];
  if (!Array.isArray(blocked) || DISABLED_DIRECT_TOOLSETS.some(t => !blocked.includes(t))) {
    throw new Error('Primary Hermes does not disable direct privileged tools');
  }
  if (!cfg.mcp_servers?.botly || Object.keys(cfg.mcp_servers).length !== 1) {
    throw new Error('Primary Hermes has unauthorized direct MCP servers');
  }
  const url = new URL(gatewayUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:') {
    throw new Error('Restricted primary Hermes must use a loopback gateway');
  }
  const uid = listeningUid(Number(url.port));
  if (uid === null || uid !== identity.uid) {
    throw new Error('Refusing primary Hermes: gateway listener is missing or running under the wrong Linux user');
  }
}
