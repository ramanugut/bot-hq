import { db, now } from './db.js';
import { userTimezone } from './store.js';

/**
 * Heartbeat (idea borrowed from OpenClaw): a bot with heartbeat_min > 0 wakes every N minutes, goes
 * through its checklist and only speaks when something needs the user. A check-in with nothing to
 * say leaves no trace in the chat (see the 'heartbeat' trigger in agent/loop.ts).
 *
 * Each check-in uses the user's ChatGPT allowance, so the shortest interval is 30 minutes, and by
 * default nothing runs between 22:00 and 07:00 in the user's time zone.
 */

export const HEARTBEAT_OK = 'HEARTBEAT_OK';
export const MIN_HEARTBEAT_MIN = 30;
const DAILY_REVIEW_MS = 24 * 60 * 60_000;

type Enqueue = (botId: string, t: { type: 'heartbeat'; text: string }) => void;
let enqueueFn: Enqueue | null = null;
let busyFn: (botId: string) => boolean = () => false;

export function initHeartbeat(enqueue: Enqueue, isBusy: (botId: string) => boolean) {
  enqueueFn = enqueue;
  busyFn = isBusy;
  db.exec(`CREATE TABLE IF NOT EXISTS heartbeat_state (
    bot_id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL DEFAULT '',
    last_ai_at INTEGER NOT NULL DEFAULT 0
  )`);
  setInterval(tick, 60_000).unref();
  const n = (db.prepare('SELECT COUNT(*) n FROM bots WHERE heartbeat_min > 0').get() as any).n;
  console.log(`[heartbeat] ${n} bot(s) with a heartbeat`);
}

function localHour(tz: string): number {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  } catch {
    return new Date().getUTCHours();
  }
}

export const isQuietHour = (hour: number) => hour >= 22 || hour < 7;

function tick() {
  if (!enqueueFn) return;
  const bots = db.prepare("SELECT id, user_id, heartbeat_min, heartbeat_quiet, heartbeat_last_at FROM bots WHERE heartbeat_min > 0 AND COALESCE(kind,'agent') != 'room'").all() as any[];
  for (const b of bots) {
    try {
      const every = Math.max(MIN_HEARTBEAT_MIN, b.heartbeat_min) * 60_000;
      if (b.heartbeat_last_at && now() - b.heartbeat_last_at < every) continue;
      if (b.heartbeat_quiet && isQuietHour(localHour(userTimezone(b.user_id)))) continue;
      if (busyFn(b.id)) continue; // try again next minute
      runHeartbeat(b.id, false);
    } catch (e) {
      console.warn('[heartbeat] tick failed for', b.id, (e as Error).message);
    }
  }
}

/** Manual check-ins always run. Automatic check-ins with no checklist first use
 * local SQLite state to avoid spending ChatGPT allowance every 30 minutes. */
export function runHeartbeat(botId: string, force = true) {
  const b = db.prepare('SELECT heartbeat_checklist FROM bots WHERE id=?').get(botId) as any;
  if (!b || !enqueueFn) return;
  const checklist = String(b.heartbeat_checklist ?? '').trim();
  const relevantTasks = db.prepare("SELECT id,state,updated_at FROM tasks WHERE bot_id=? AND state IN ('needs_input','in_progress') ORDER BY id").all(botId) as any[];
  const approvals = db.prepare("SELECT id,status FROM approvals WHERE bot_id=? AND status='pending' ORDER BY id").all(botId) as any[];
  const fingerprint = JSON.stringify({ relevantTasks, approvals });
  const last = db.prepare('SELECT fingerprint,last_ai_at FROM heartbeat_state WHERE bot_id=?').get(botId) as { fingerprint: string; last_ai_at: number } | undefined;
  const changed = last?.fingerprint !== fingerprint;
  const needsReview = checklist.length > 0 || (changed && (relevantTasks.length > 0 || approvals.length > 0)) || !last?.last_ai_at || now() - last.last_ai_at >= DAILY_REVIEW_MS;
  db.prepare('UPDATE bots SET heartbeat_last_at=? WHERE id=?').run(now(), botId);
  if (!force && !needsReview) return;
  db.prepare(`INSERT INTO heartbeat_state(bot_id,fingerprint,last_ai_at) VALUES (?,?,?)
    ON CONFLICT(bot_id) DO UPDATE SET fingerprint=excluded.fingerprint,last_ai_at=excluded.last_ai_at`)
    .run(botId, fingerprint, now());
  enqueueFn(botId, {
    type: 'heartbeat',
    text:
      `[Heartbeat check-in. Nobody is waiting for you; this is your regular look around.]\n` +
      (checklist
        ? `Go through your checklist:\n${checklist}\n`
        : `You have no checklist yet. Look at your open tasks, your memories and anything you promised to follow up on.\n`) +
      `Only message the user if something needs them now: a reply they owe, a deadline, something that changed, or a finished result. ` +
      `Keep that message short. Never repeat something you already told them. ` +
      `If nothing needs them, reply with exactly ${HEARTBEAT_OK} and nothing else.`,
  });
}
