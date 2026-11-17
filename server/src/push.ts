import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { db, now } from './db.js';
import { env } from './env.js';

/**
 * Phone and desktop notifications (Web Push). Keys are made once and kept beside the database.
 * A notification is only sent when none of the user's open app windows has been visible in the
 * last 45 seconds: if they are looking at the app, they already see the reply.
 */

db.exec(`CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  keys TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);

interface Vapid { publicKey: string; privateKey: string }
let vapid: Vapid | null = null;
function keys(): Vapid {
  if (vapid) return vapid;
  const file = path.join(path.dirname(env.dbPath), 'vapid.json');
  try { vapid = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
    vapid = webpush.generateVAPIDKeys();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(vapid), { mode: 0o600 });
  }
  webpush.setVapidDetails(env.appUrl.startsWith('https:') ? env.appUrl : 'mailto:botly@localhost', vapid!.publicKey, vapid!.privateKey);
  return vapid!;
}

export const pushPublicKey = () => keys().publicKey;

export function saveSubscription(userId: string, sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }) {
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('bad subscription');
  db.prepare('INSERT OR REPLACE INTO push_subs(endpoint,user_id,keys,created_at) VALUES (?,?,?,?)').run(sub.endpoint, userId, JSON.stringify(sub.keys), now());
}

export function removeSubscription(userId: string, endpoint: string) {
  db.prepare('DELETE FROM push_subs WHERE endpoint=? AND user_id=?').run(endpoint, userId);
}

const seen = new Map<string, number>();
/** The app is open and visible for this user right now. */
export const markPresent = (userId: string) => seen.set(userId, Date.now());

export async function notify(userId: string, n: { title: string; body: string; url?: string; tag?: string }, force = false) {
  if (!force && Date.now() - (seen.get(userId) ?? 0) < 45_000) return;
  const subs = db.prepare('SELECT endpoint, keys FROM push_subs WHERE user_id=?').all(userId) as { endpoint: string; keys: string }[];
  if (!subs.length) return;
  keys();
  const payload = JSON.stringify({ title: n.title, body: n.body.slice(0, 180), url: n.url ?? '/', tag: n.tag });
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, payload, { TTL: 3600 });
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(s.endpoint);
      else console.warn('[push] send failed', e?.statusCode ?? e?.message);
    }
  }));
}

/** Notify the owner of a bot. */
export function notifyBot(botId: string, body: string, tag = 'reply') {
  const b = db.prepare('SELECT user_id, name FROM bots WHERE id=?').get(botId) as any;
  if (!b) return;
  void notify(b.user_id, { title: b.name, body, url: `/?bot=${encodeURIComponent(botId)}`, tag: `${botId}:${tag}` }).catch(() => {});
}
