import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { requireAgentIdentity } from './agent-identity.js';

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
): Promise<RestrictedCommandResult> {
  if (typeof command !== 'string' || !command.trim() || command.length > 4_000) {
    throw new Error('Expected a nonempty command of at most 4000 characters');
  }
  const home = path.join(enginesDir, botId);
  const identity = requireAgentIdentity(botId, home);
  const cwd = path.join(home, 'workspace');
  const st = fs.lstatSync(cwd);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== identity.uid || (st.mode & 0o077) !== 0) {
    throw new Error('Agent workspace is missing or not isolated');
  }
  const limit = Math.min(Math.max(1000, timeoutMs), 60_000);
  const child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', command], {
    uid: identity.uid, gid: identity.gid, cwd, detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      HOME: home,
      USER: identity.username,
      LOGNAME: identity.username,
      PATH: '/usr/local/bin:/usr/bin:/bin',
      LANG: 'C.UTF-8',
    },
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
