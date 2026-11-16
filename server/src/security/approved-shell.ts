import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { requireAgentIdentity, requirePrimaryIdentity } from './agent-identity.js';

export interface RestrictedCommandResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

export async function runApprovedCommand(
  botId: string,
  enginesDir: string,
  command: string,
  timeoutMs = 30_000,
  primaryHome?: string,
): Promise<RestrictedCommandResult> {
  if (typeof command !== 'string' || !command.trim() || command.length > 4_000) {
    throw new Error('Expected a nonempty command of at most 4000 characters');
  }
  const home = primaryHome ?? path.join(enginesDir, botId);
  const identity = primaryHome ? requirePrimaryIdentity(primaryHome) : requireAgentIdentity(botId, home);
  const cwd = path.join(home, 'workspace');
  const st = fs.lstatSync(cwd);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== identity.uid || (st.mode & 0o077) !== 0) {
    throw new Error('Agent workspace is missing or not isolated');
  }
  // Commands MUST execute inside a filesystem + network sandbox. Without
  // bubblewrap, fail closed: a plain non-root shell could reach every bot's
  // loopback CDP port and bypass future browser approvals.
  const sandbox = '/usr/bin/bwrap';
  const bin = fs.statSync(sandbox);
  if (!bin.isFile() || bin.uid !== 0 || (bin.mode & 0o111) === 0) {
    throw new Error('Root-managed bubblewrap is required for approved shell tools');
  }
  const args = [
    '--unshare-user', '--unshare-net', '--unshare-pid', '--unshare-ipc', '--unshare-uts',
    '--die-with-parent', '--clearenv', '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/bin', '/bin', '--ro-bind', '/lib', '/lib',
    ...(fs.existsSync('/lib64') ? ['--ro-bind', '/lib64', '/lib64'] : []),
    '--ro-bind-try', '/etc/passwd', '/etc/passwd', '--ro-bind-try', '/etc/group', '/etc/group',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--bind', cwd, '/workspace', '--chdir', '/workspace',
    '--setenv', 'HOME', '/workspace',
    '--setenv', 'PATH', '/usr/bin:/bin',
    '--setenv', 'LANG', 'C.UTF-8',
    '--', '/bin/bash', '--noprofile', '--norc', '-c', command,
  ];
  const limit = Math.min(Math.max(1000, timeoutMs), 60_000);
  const child = spawn(sandbox, args, {
    uid: identity.uid, gid: identity.gid, cwd, detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
  });
  return new Promise((resolve, reject) => {
    let output = '';
    let finished = false;
    let timedOut = false;
    const append = (v: Buffer) => { output = (output + v.toString('utf8')).slice(-12_000); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const terminate = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); }
      catch { try { child.kill(signal); } catch { /* already gone */ } }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate('SIGTERM');
      setTimeout(() => { if (!finished) terminate('SIGKILL'); }, 1000).unref();
    }, limit);
    child.on('error', (error) => { clearTimeout(timer); finished = true; reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;
      resolve({ exitCode: code, output, timedOut });
    });
  });
}
