import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * An X11 cookie is a capability to use that screen. It must NEVER be written
 * to logs or placed in a bot's environment. The root-owned Botly desktop
 * supervisor uses it when driving Xvfb/openbox/VNC/Chrome.
 */
export function xauthorityFor(screenStateDir: string, display: number): string {
  if (!Number.isInteger(display) || display < 1 || display > 65535) {
    throw new Error('Invalid X11 display number');
  }
  return path.join(screenStateDir, `xauthority-${display}`);
}

export function createScreenAuthority(screenStateDir: string, display: number): string {
  const file = xauthorityFor(screenStateDir, display);
  const state = fs.lstatSync(screenStateDir);
  if (!state.isDirectory() || state.isSymbolicLink() ||
      (state.mode & 0o077) !== 0 || state.uid !== 0) {
    throw new Error('X11 authority directory must be root-owned and private');
  }
  try {
    const existing = fs.lstatSync(file);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.uid !== 0 ||
        (existing.mode & 0o077) !== 0) {
      throw new Error('Existing X11 authority is unsafe');
    }
    return file;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
  const tmp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const secret = crypto.randomBytes(16).toString('hex');
  try {
    // Xauthority accepts a command script through stdin. The cookie is never
    // on the process command line (where other local users can see it).
    const result = spawnSync('xauth', ['-q', '-f', tmp, 'source', '-'], {
      input: `add :${display} MIT-MAGIC-COOKIE-1 ${secret}\n`,
      encoding: 'utf8', timeout: 5000,
    });
    if (result.status !== 0) throw new Error('Could not create X11 authority (install xauth)');
    const st = fs.lstatSync(tmp);
    if (!st.isFile() || st.isSymbolicLink()) throw new Error('Unsafe generated X11 authority');
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
    return file;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* renamed or not created */ }
  }
}

/**
 * Fail closed when an old -ac Xvfb is still running. Enabling the secure flag
 * must not silently reuse an unprotected display.
 */
export function isSecureXvfbCommand(commandLine: string, display: number, authorityPath: string): boolean {
  const parts = commandLine.split(/\s+/);
  const binary = path.basename(parts[0] ?? '');
  if (binary !== 'Xvfb' || parts[1] !== `:${display}` || parts.includes('-ac')) return false;
  const index = parts.indexOf('-auth');
  return index >= 0 && parts[index + 1] === authorityPath && parts.includes('-nolisten') &&
    parts[parts.indexOf('-nolisten') + 1] === 'tcp';
}
