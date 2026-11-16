import { db, now } from './db.js';
import { env } from './env.js';
import { hub } from './lib/hub.js';
import { orgo, OrgoError, type OrgoScreen } from './orgo.js';
import { cdpPortFor, dressScreen, resetScreen, undressScreen, type DeskBot } from './desk.js';
import { box } from './box.js';
import type { ComputerState } from './types.js';

/**
 * One Orgo computer for the whole team (ORGO_COMPUTER_ID), one screen per bot. The primary bot's
 * engine already lives on that computer's own desktop, so it keeps the default screen; every other
 * bot gets a screen of its own, dressed in its colour (see desk.ts). The computer is never created,
 * suspended or deleted from here: it is somebody's working machine.
 */

/** Orgo allows this many screens on one Linux computer, the default one included. */
export const MAX_SCREENS = 4;

export interface BotScreen { computerId: string; screenId: string; width?: number; height?: number }

function computerId(): string {
  if (!env.orgoComputerId) throw new Error('ORGO_COMPUTER_ID is not set, so there is no computer for the bots to use.');
  return env.orgoComputerId;
}

function rowFor(userId: string) {
  let r = db.prepare('SELECT * FROM computers WHERE user_id=?').get(userId) as any;
  if (!r) {
    db.prepare("INSERT INTO computers(user_id,orgo_id,status,updated_at) VALUES (?, ?, 'starting', ?)").run(userId, env.orgoComputerId || null, now());
    r = db.prepare('SELECT * FROM computers WHERE user_id=?').get(userId);
  }
  return r;
}

function setStatus(userId: string, status: ComputerState['status'], error: string | null = null) {
  rowFor(userId);
  db.prepare('UPDATE computers SET status=?, orgo_id=?, error=?, updated_at=? WHERE user_id=?').run(status, env.orgoComputerId || null, error, now(), userId);
  hub.emit(userId, { type: 'computer', state: computerState(userId) });
}

export function computerState(userId: string): ComputerState {
  const r = rowFor(userId);
  const screens = (db.prepare('SELECT bot_id, screen_id, width, height, asleep FROM screens WHERE user_id=?').all(userId) as any[]).map((s) => ({
    botId: s.bot_id as string,
    screenId: s.screen_id as string,
    asleep: !!s.asleep,
    ...(s.width && s.height ? { width: s.width as number, height: s.height as number } : {}),
  }));
  return { status: r.status, orgoId: env.orgoComputerId || r.orgo_id, error: r.error, screens, maxScreens: Math.min(env.maxBots, MAX_SCREENS) };
}

function mapStatus(s: string): ComputerState['status'] {
  if (s === 'running') return 'running';
  if (s === 'creating') return 'creating';
  if (s === 'suspended') return 'suspended';
  if (s === 'suspending') return 'suspending';
  if (s === 'resuming') return 'resuming';
  if (s === 'frozen' || s === 'stopped') return 'stopped';
  if (s === 'error') return 'error';
  return 'starting';
}

async function waitRunning(id: string, timeoutMs = 240_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const c = await orgo.getComputer(id);
    if (c.status === 'running' && !c.asleep) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Timed out waiting for the computer to start');
}

let checkedAt = 0;
let inflight: Promise<string> | null = null;

/** Make sure the shared computer is awake. Returns its Orgo id. */
export function ensureComputer(userId: string): Promise<string> {
  const id = computerId();
  if (Date.now() - checkedAt < 30_000) return Promise.resolve(id);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const c = await orgo.getComputer(id);
      if (c.status === 'running' && !c.asleep) {
        if (rowFor(userId).status !== 'running') setStatus(userId, 'running');
      } else if (c.status === 'suspended' || c.status === 'suspending' || c.asleep) {
        console.log(`[computer] waking ${id} (was ${c.status})`);
        setStatus(userId, 'resuming');
        for (let i = 0; i < 40 && (await orgo.getComputer(id)).status === 'suspending'; i++) await new Promise((res) => setTimeout(res, 3000));
        await orgo.resume(id);
        await waitRunning(id);
        setStatus(userId, 'running');
      } else if (c.status === 'frozen' || c.status === 'stopped' || c.status === 'error') {
        setStatus(userId, 'starting');
        await orgo.start(id);
        await waitRunning(id);
        setStatus(userId, 'running');
      } else {
        setStatus(userId, mapStatus(c.status));
        await waitRunning(id);
        setStatus(userId, 'running');
      }
      checkedAt = Date.now();
      return id;
    } catch (e: any) {
      const msg = e instanceof OrgoError && e.status === 404 ? 'The computer set in ORGO_COMPUTER_ID was not found with this Orgo key.' : String(e?.message ?? e);
      setStatus(userId, 'error', msg);
      throw new Error(msg);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function deskBot(botId: string): DeskBot | null {
  const b = db.prepare('SELECT id, name, label, avatar_shape, avatar_color FROM bots WHERE id=?').get(botId) as any;
  return b ? { id: b.id, name: b.name, label: b.label ?? '', avatarShape: b.avatar_shape, avatarColor: b.avatar_color } : null;
}

const isPrimaryEngine = (botId: string) => (db.prepare('SELECT engine FROM bots WHERE id=?').get(botId) as any)?.engine === 'primary';

/** The primary bot's own Chrome (when PRIMARY_CDP_URL names one) is never started or stopped by us. */
const managesChrome = (botId: string) => !(isPrimaryEngine(botId) && env.primaryCdpUrl);

const verified = new Map<string, number>();
const leasing = new Map<string, Promise<BotScreen>>();
const dressing = new Map<string, Promise<void>>();

function saveSize(botId: string, s: OrgoScreen | undefined) {
  if (s?.width && s?.height) db.prepare('UPDATE screens SET width=?, height=? WHERE bot_id=?').run(s.width, s.height, botId);
}

/** This bot's screen on the shared computer; leases one the first time. */
export function screenFor(userId: string, botId: string): Promise<BotScreen> {
  const running = leasing.get(botId);
  if (running) return running;
  const p = lease(userId, botId).finally(() => leasing.delete(botId));
  leasing.set(botId, p);
  return p;
}

async function lease(userId: string, botId: string): Promise<BotScreen> {
  const id = await ensureComputer(userId);
  const mine = db.prepare('SELECT screen_id, width, height FROM screens WHERE bot_id=?').get(botId) as any;
  if (mine) {
    const fresh = Date.now() - (verified.get(botId) ?? 0) < 120_000;
    if (fresh || mine.screen_id === 'default') {
      db.prepare('UPDATE screens SET last_used_at=? WHERE bot_id=?').run(now(), botId);
      return { computerId: id, screenId: mine.screen_id, width: mine.width ?? undefined, height: mine.height ?? undefined };
    }
    try {
      const s = await orgo.getScreen(id, mine.screen_id);
      verified.set(botId, Date.now());
      saveSize(botId, s);
      db.prepare('UPDATE screens SET last_used_at=? WHERE bot_id=?').run(now(), botId);
      return { computerId: id, screenId: mine.screen_id, width: s?.width ?? mine.width ?? undefined, height: s?.height ?? mine.height ?? undefined };
    } catch {
      // The screen is gone (the computer restarted): lease again below.
      db.prepare('DELETE FROM screens WHERE bot_id=?').run(botId);
      dressing.delete(botId);
    }
  }

  const taken = new Set((db.prepare('SELECT screen_id FROM screens').all() as any[]).map((r) => r.screen_id as string));
  const existing = await orgo.listScreens(id);
  let screen: OrgoScreen | undefined;
  if (isPrimaryEngine(botId)) {
    screen = existing.find((s) => s.id === 'default' || s.default) ?? ({ id: 'default', display: ':99', width: 0, height: 0, default: true } as OrgoScreen);
    screen = { ...screen, id: 'default' };
  } else {
    screen = existing.find((s) => s.id !== 'default' && !s.default && !taken.has(s.id));
    if (!screen) {
      if (existing.length >= MAX_SCREENS) throw new Error(`Every screen on the computer is in use (${MAX_SCREENS} at most). Remove a bot to free one.`);
      screen = await orgo.createScreen(id);
    }
  }
  db.prepare('INSERT OR REPLACE INTO screens(bot_id,user_id,screen_id,last_used_at,width,height) VALUES (?,?,?,?,?,?)').run(botId, userId, screen.id, now(), screen.width || null, screen.height || null);
  verified.set(botId, Date.now());
  hub.emit(userId, { type: 'computer', state: computerState(userId) });
  return { computerId: id, screenId: screen.id, width: screen.width || undefined, height: screen.height || undefined };
}

/**
 * The bot's screen, dressed as its own computer (wallpaper, dock, its Chrome on its home screen).
 * Dressing happens once per server run per bot, and again when `redress` is set (rename, new colour).
 */
export async function readyScreen(userId: string, botId: string, opts: { redress?: boolean } = {}): Promise<BotScreen> {
  const s = await screenFor(userId, botId);
  if (opts.redress) dressing.delete(botId);
  let d = dressing.get(botId);
  if (!d) {
    const bot = deskBot(botId);
    d = bot
      ? dressScreen(bot, s.screenId, { manageChrome: managesChrome(botId) }).catch((e) => {
          console.warn(`[computer] could not dress ${s.screenId} for ${botId}: ${e?.message ?? e}`);
          dressing.delete(botId);
        })
      : Promise.resolve();
    dressing.set(botId, d);
  }
  await d;
  return s;
}

/** DevTools address of the Chrome on this bot's screen (for Hermes' browser tools). */
export function cdpUrlFor(botId: string, screenId: string): string {
  if (isPrimaryEngine(botId) && env.primaryCdpUrl) return env.primaryCdpUrl;
  return `http://127.0.0.1:${cdpPortFor(screenId)}`;
}

/**
 * Called before a bot starts working: its screen is leased and dressed, and the browser we run for it
 * answers. Without this a bot's first turn finds no browser and goes off to start one of its own.
 */
export async function screenForWork(userId: string, botId: string): Promise<void> {
  if (!env.orgoComputerId) return;
  await wakeScreen(userId, botId);
  markScreenUsed(botId);
  if (!managesChrome(botId)) {
    // It brings its own browser, so nothing it needs depends on the dressing: don't make it wait.
    void readyScreen(userId, botId).catch((e) => console.warn(`[computer] screen not ready for ${botId}: ${e?.message ?? e}`));
    return;
  }
  const s = await readyScreen(userId, botId);
  if (!env.localBox) return;
  const alive = await fetch(`${cdpUrlFor(botId, s.screenId)}/json/version`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
  if (!alive) await readyScreen(userId, botId, { redress: true });
}

/** Close everything on the bot's screen and bring its browser back to the home screen. Logins stay. */
export async function resetBotScreen(userId: string, botId: string): Promise<void> {
  const s = await screenFor(userId, botId);
  const bot = deskBot(botId);
  if (bot) await resetScreen(bot, s.screenId, { manageChrome: managesChrome(botId) });
}

/** The bot is gone: stop what we ran on its screen and free the screen for the next bot. */
export async function releaseScreen(botId: string): Promise<void> {
  const mine = db.prepare('SELECT screen_id, user_id FROM screens WHERE bot_id=?').get(botId) as any;
  if (!mine) return;
  db.prepare('DELETE FROM screens WHERE bot_id=?').run(botId);
  dressing.delete(botId);
  verified.delete(botId);
  if (mine.screen_id !== 'default') {
    try { await undressScreen(botId, mine.screen_id); } catch (e: any) { console.warn(`[computer] undress failed: ${e?.message ?? e}`); }
  }
  hub.emit(mine.user_id, { type: 'computer', state: computerState(mine.user_id) });
}

/** A deleted bot leaves nothing behind on the computer: its browser profile and its Library folder go. */
export async function forgetBotFiles(botId: string): Promise<void> {
  if (!/^bot_[\w-]+$/.test(botId)) return;
  await box.bash(`rm -rf -- /root/botly/profiles/${botId} /root/botly/files/${botId}`, 60);
}

/** "Sleep" button: put every screen that isn't working right now to sleep. */
export async function suspendComputer(userId: string, _reason = 'manual'): Promise<void> {
  const rows = db.prepare('SELECT bot_id FROM screens WHERE user_id=? AND asleep=0').all(userId) as any[];
  for (const r of rows) if (!busyCheck(r.bot_id) && !(screenViewers.get(r.bot_id) ?? 0)) await sleepScreen(r.bot_id);
}

// ---------------------------------------------------------------- sleeping screens

/**
 * A bot's screen falls asleep after BOTLY_SCREEN_SLEEP_MIN idle minutes (15 by default): its browser and
 * desktop apps are closed, which frees most of the memory a screen uses. Logins stay in the browser
 * profile. Work wakes it again: every turn (chat, routine, heartbeat) calls screenForWork, and opening
 * the screen in the app wakes it too. The blank display itself keeps running; it costs very little,
 * and stopping it would break programs that still hold a connection to it.
 */
export const SCREEN_SLEEP_MIN = Number((process.env.BOTLY_SCREEN_SLEEP_MIN ?? process.env.HQ_SCREEN_SLEEP_MIN) ?? 15);
const lastUsed = new Map<string, number>();
const screenViewers = new Map<string, number>();
let busyCheck: (botId: string) => boolean = () => false;

export function markScreenUsed(botId: string) { lastUsed.set(botId, Date.now()); }

/** Someone opened or closed this bot's screen in the app. */
export function screenViewer(botId: string, delta: 1 | -1) {
  const n = Math.max(0, (screenViewers.get(botId) ?? 0) + delta);
  if (n) screenViewers.set(botId, n); else screenViewers.delete(botId);
  markScreenUsed(botId);
}

export async function sleepScreen(botId: string): Promise<boolean> {
  if (!env.localScreens) return false; // an Orgo computer manages itself
  const mine = db.prepare('SELECT screen_id, user_id, asleep FROM screens WHERE bot_id=?').get(botId) as any;
  if (!mine || mine.asleep || !managesChrome(botId)) return false;
  db.prepare('UPDATE screens SET asleep=1 WHERE bot_id=?').run(botId);
  try { await undressScreen(botId, mine.screen_id); } catch (e: any) { console.warn(`[computer] could not put ${botId}'s screen to sleep: ${e?.message ?? e}`); }
  dressing.delete(botId);
  verified.delete(botId);
  console.log(`[computer] ${botId}'s screen is asleep`);
  hub.emit(mine.user_id, { type: 'computer', state: computerState(mine.user_id) });
  return true;
}

/** Wake the bot's screen if it sleeps. Its browser comes back when the screen is dressed again. */
export async function wakeScreen(userId: string, botId: string): Promise<void> {
  markScreenUsed(botId);
  const mine = db.prepare('SELECT screen_id, asleep FROM screens WHERE bot_id=?').get(botId) as any;
  if (!mine?.asleep) return;
  db.prepare('UPDATE screens SET asleep=0, last_used_at=? WHERE bot_id=?').run(now(), botId);
  dressing.delete(botId);
  try { await orgo.getScreen(computerId(), mine.screen_id); } catch { /* lease() starts it again if needed */ }
  console.log(`[computer] ${botId}'s screen woke up`);
  hub.emit(userId, { type: 'computer', state: computerState(userId) });
  await readyScreen(userId, botId).catch((e) => console.warn(`[computer] wake of ${botId} failed: ${e?.message ?? e}`));
}

export function startScreenSleeper(isBusy: (botId: string) => boolean) {
  busyCheck = isBusy;
  if (!env.localScreens || SCREEN_SLEEP_MIN <= 0) return;
  console.log(`[computer] idle screens sleep after ${SCREEN_SLEEP_MIN} min`);
  setInterval(() => {
    const rows = db.prepare('SELECT bot_id, last_used_at FROM screens WHERE asleep=0').all() as any[];
    for (const r of rows) {
      if (isBusy(r.bot_id) || (screenViewers.get(r.bot_id) ?? 0) > 0) { markScreenUsed(r.bot_id); continue; }
      const last = Math.max(lastUsed.get(r.bot_id) ?? 0, r.last_used_at ?? 0);
      if (Date.now() - last >= SCREEN_SLEEP_MIN * 60_000) void sleepScreen(r.bot_id);
    }
  }, 60_000).unref();
}

/** Refresh status and screen sizes from Orgo (cheap; used when the UI opens). */
export async function refreshComputer(userId: string): Promise<ComputerState> {
  if (!env.orgoComputerId) {
    setStatus(userId, 'error', 'ORGO_COMPUTER_ID is not set.');
    return computerState(userId);
  }
  try {
    const c = await orgo.getComputer(env.orgoComputerId);
    const s = mapStatus(c.asleep ? 'suspended' : c.status);
    const r = rowFor(userId);
    if (s !== r.status || r.error) setStatus(userId, s);
    if (s === 'running') {
      const screens = await orgo.listScreens(env.orgoComputerId);
      const byId = new Map(screens.map((x) => [x.default ? 'default' : x.id, x]));
      for (const row of db.prepare('SELECT bot_id, screen_id FROM screens WHERE user_id=?').all(userId) as any[]) saveSize(row.bot_id, byId.get(row.screen_id));
    }
  } catch (e: any) {
    setStatus(userId, 'error', e instanceof OrgoError && e.status === 404 ? 'The computer was not found with this Orgo key.' : String(e?.message ?? e));
  }
  return computerState(userId);
}
