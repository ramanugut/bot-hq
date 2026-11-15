import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';
import type { OrgoComputer, OrgoScreen } from './orgo.js';

/**
 * Screens on this machine, for running without Orgo (HQ_SCREENS=local).
 *
 * Every screen is an X display: Xvfb draws it, a small window manager keeps windows in place, and
 * x11vnc serves it on 127.0.0.1 only (the VNC relay in vnc.ts is the one way in from outside).
 * The default screen is :99; extra screens are :100, :101, ... — the same numbering Orgo uses,
 * so desk.ts, box.ts and hq-screen.py work unchanged.
 */

export const LOCAL_ID = 'local';
const FIRST_EXTRA = 100;

const stateDir = () => path.join(path.dirname(env.dbPath), 'screens');

/** The VNC password every local screen uses. Made once and kept beside the database. */
export function localVncPassword(): string {
  const dir = stateDir();
  const file = path.join(dir, 'vnc.pass');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const pw = crypto.randomBytes(6).toString('hex'); // VNC passwords are 8 characters at most
    fs.writeFileSync(file, pw.slice(0, 8), { mode: 0o600 });
    return pw.slice(0, 8);
  }
}

export const vncPortFor = (n: number) => 5900 + n;
const displayOf = (screenId: string) => (screenId === 'default' ? 99 : Number(screenId.replace('screen-', '')));
const idOf = (n: number) => (n === 99 ? 'default' : `screen-${n}`);

function run(cmd: string, args: string[], timeoutMs = 10_000): Promise<{ code: number; out: Buffer }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => {
      resolve({ code: err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0, out: stdout as Buffer });
    });
  });
}

const alive = async (n: number) => (await run('xdpyinfo', ['-display', `:${n}`], 5000)).code === 0;

function detached(cmd: string, args: string[], extraEnv: Record<string, string> = {}) {
  const log = fs.openSync(path.join(stateDir(), `${path.basename(cmd)}-${extraEnv.DISPLAY ?? args[0]}.log`.replace(/:/g, '')), 'a');
  const p = spawn(cmd, args, { detached: true, stdio: ['ignore', log, log], env: { ...process.env, ...extraEnv } });
  p.unref();
}

const which = async (bin: string) => (await run('bash', ['-c', `command -v ${bin}`])).code === 0;

const starting = new Map<number, Promise<void>>();

/** Start display :n (Xvfb, window manager, VNC) unless it already runs. */
function ensureDisplay(n: number): Promise<void> {
  const busy = starting.get(n);
  if (busy) return busy;
  const p = (async () => {
    fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    if (!(await alive(n))) {
      const [w, h] = (process.env.HQ_SCREEN_SIZE ?? '1280x800').split('x');
      detached('Xvfb', [`:${n}`, '-screen', '0', `${w}x${h}x24`, '-nolisten', 'tcp', '-ac']);
      for (let i = 0; i < 50 && !(await alive(n)); i++) await new Promise((r) => setTimeout(r, 200));
      if (!(await alive(n))) throw new Error(`screen :${n} did not start (is Xvfb installed?)`);
      const wm = (await which('openbox')) ? 'openbox' : (await which('xfwm4')) ? 'xfwm4' : '';
      if (wm) detached(wm, [], { DISPLAY: `:${n}` });
    }
    const port = vncPortFor(n);
    const passFile = path.join(stateDir(), 'vnc.rfbauth');
    // A VNC server left over from another install has another password: replace it.
    const ours = (await run('pgrep', ['-af', `x11vnc -display :${n} `])).out.toString();
    if (ours.trim() && !ours.includes(passFile)) {
      await run('pkill', ['-f', `x11vnc -display :${n} `]);
      await new Promise((r) => setTimeout(r, 300));
    }
    const listening = (await run('bash', ['-c', `ss -ltn 'sport = :${port}' | grep -q LISTEN`])).code === 0;
    if (!listening) {
      if (!fs.existsSync(passFile)) await run('x11vnc', ['-storepasswd', localVncPassword(), passFile]);
      detached('x11vnc', ['-display', `:${n}`, '-rfbport', String(port), '-localhost', '-forever', '-shared', '-rfbauth', passFile, '-noxdamage', '-quiet'], { DISPLAY: `:${n}` });
      for (let i = 0; i < 30; i++) {
        if ((await run('bash', ['-c', `ss -ltn 'sport = :${port}' | grep -q LISTEN`])).code === 0) break;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  })().finally(() => starting.delete(n));
  starting.set(n, p);
  return p;
}

async function size(n: number): Promise<{ width: number; height: number }> {
  const r = await run('xdpyinfo', ['-display', `:${n}`], 5000);
  const m = r.out.toString().match(/dimensions:\s+(\d+)x(\d+)/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 0, height: 0 };
}

async function screenOf(n: number): Promise<OrgoScreen> {
  return { id: idOf(n), display: `:${n}`, ...(await size(n)), default: n === 99 };
}

async function listScreens(): Promise<OrgoScreen[]> {
  await ensureDisplay(99); // the default screen always exists, like on an Orgo computer
  const out: OrgoScreen[] = [await screenOf(99)];
  for (let n = FIRST_EXTRA; n < FIRST_EXTRA + 16; n++) if (await alive(n)) out.push(await screenOf(n));
  return out;
}

export const localScreens = {
  getComputer: async (): Promise<OrgoComputer> => ({ id: LOCAL_ID, status: 'running', name: 'this server' }),
  start: async () => ({}),
  resume: async () => ({}),
  suspend: async () => ({}),
  vncPassword: async () => ({ password: localVncPassword(), desktop_api_token: '' }),

  listScreens: (_id: string) => listScreens(),
  createScreen: async (_id: string): Promise<OrgoScreen> => {
    for (let n = FIRST_EXTRA; n < FIRST_EXTRA + 16; n++) {
      if (await alive(n)) continue;
      await ensureDisplay(n);
      return screenOf(n);
    }
    throw new Error('no free display');
  },
  getScreen: async (_id: string, screen: string): Promise<OrgoScreen> => {
    const n = displayOf(screen);
    if (n === 99) await ensureDisplay(99);
    if (!(await alive(n))) throw new Error(`screen ${screen} is not running`);
    await ensureDisplay(n); // brings its VNC back if only that stopped
    return screenOf(n);
  },
  deleteScreen: async (_id: string, screen: string): Promise<void> => {
    const n = displayOf(screen);
    if (n === 99) return;
    await run('pkill', ['-f', `x11vnc -display :${n} `]);
    await run('pkill', ['-f', `^Xvfb :${n} `]);
  },

  screenshot: async (_id: string, screen?: string) => {
    const n = displayOf(screen ?? 'default');
    const r = await run('import', ['-display', `:${n}`, '-window', 'root', '-quality', '75', 'jpeg:-'], 15_000);
    if (r.code !== 0 || !r.out.length) throw new Error(`screenshot of :${n} failed`);
    const s = await size(n);
    return { image: r.out.toString('base64'), mime_type: 'image/jpeg', ...s };
  },

  bash: async () => { throw new Error('local screens run commands through box.ts'); },
  exportFile: async () => { throw new Error('local files are served directly'); },
};
