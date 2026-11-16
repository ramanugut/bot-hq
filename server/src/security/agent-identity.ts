import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Stable, non-guessable (but not secret) Linux username for one Botly bot. */
export function agentUsername(botId: string): string {
  if (!/^[a-zA-Z0-9_-]{3,120}$/.test(botId)) throw new Error('Invalid bot identifier');
  return 'botly_' + crypto.createHash('sha256').update(botId).digest('hex').slice(0, 16);
}

export interface AgentIdentity {
  username: string;
  uid: number;
  gid: number;
  home: string;
}

/**
 * Only pre-provisioned, non-root identities are accepted. An absent user or
 * mis-owned directory causes a hard failure: never fall back to the app's root.
 */
export function requireAgentIdentity(botId: string, home: string): AgentIdentity {
  const username = agentUsername(botId);
  let passwd: string;
  try {
    passwd = execFileSync('getent', ['passwd', username], { encoding: 'utf8', timeout: 3000 }).trim();
  } catch {
    throw new Error('Agent user is missing. Run the security provisioner in an approved maintenance window.');
  }
  const fields = passwd.split(':');
  if (fields[0] !== username) throw new Error('Agent identity lookup returned an unexpected user');
  const uid = Number(fields[2]), gid = Number(fields[3]);
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid < 100 || gid < 100) {
    throw new Error('Agent must have its own unprivileged Linux identity');
  }
  const resolved = path.resolve(home);
  const st = fs.lstatSync(resolved);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid || st.gid !== gid || (st.mode & 0o077) !== 0) {
    throw new Error('Hermes home is not an isolated 0700 directory owned by its agent user');
  }
  return { username, uid, gid, home: resolved };
}

/** Refuse app-owned file writes through any symlink, including writable subfolders. */
export function assertSafeAgentFile(file: string, home: string): void {
  const base = path.resolve(home);
  const dest = path.resolve(file);
  if (dest !== base && !dest.startsWith(base + path.sep)) throw new Error('Agent file is outside its home');
  let dir = path.dirname(dest);
  while (dir !== base) {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Agent directory cannot be a symlink');
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Agent directory escaped its home');
    dir = parent;
  }
  const baseStat = fs.lstatSync(base);
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) throw new Error('Agent home cannot be a symlink');
}

/** The primary Hermes owner is separate from managed bots and the root web app. */
export function requirePrimaryIdentity(home: string): AgentIdentity {
  const username = 'botly_primary';
  let passwd: string;
  try {
    passwd = execFileSync('getent', ['passwd', username], { encoding: 'utf8', timeout: 3000 }).trim();
  } catch {
    throw new Error('Primary agent account is missing; run the approved primary migration first');
  }
  const fields = passwd.split(':');
  if (fields[0] !== username) throw new Error('Unexpected primary-agent account');
  const uid = Number(fields[2]), gid = Number(fields[3]);
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid < 100 || gid < 100) {
    throw new Error('Primary Hermes user must be non-root');
  }
  const resolved = path.resolve(home);
  if (resolved === '/root' || resolved.startsWith('/root/')) {
    throw new Error('Primary Hermes home must not be inside /root');
  }
  const st = fs.lstatSync(resolved);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid || st.gid !== gid || (st.mode & 0o077) !== 0) {
    throw new Error('Primary Hermes home must be owned by botly_primary with mode 0700');
  }
  return { username, uid, gid, home: resolved };
}
