import { db, now } from './db.js';
import { hub } from './lib/hub.js';
import type { Bot, ChatInfo, LiveState, Row, RowBody, RowKind, Routine, Task } from './types.js';
import { Cron } from 'croner';

// ---------- bots ----------

export function toBot(r: any): Bot {
  const last = db
    .prepare("SELECT body, created_at FROM rows WHERE bot_id=? AND generation=? AND kind IN ('message','card','event') ORDER BY seq DESC LIMIT 1")
    .get(r.id, r.generation) as any;
  let lastPreview: string | null = null;
  if (last) {
    const b = JSON.parse(last.body) as RowBody;
    lastPreview =
      b.type === 'message' ? b.text : b.type === 'card' ? (b.card === 'approval' ? `Waiting for you: ${b.title}` : b.card === 'question' ? b.question : b.card === 'connect' ? `Connect ${b.toolkitName}` : 'Draft') : b.type === 'event' ? b.text : null;
  }
  return {
    id: r.id,
    name: r.name,
    label: r.label,
    description: r.description,
    instructions: r.instructions,
    avatarShape: r.avatar_shape,
    avatarColor: r.avatar_color,
    mode: r.mode,
    isPrimary: !!r.is_primary,
    kind: r.kind === 'room' ? 'room' : 'agent',
    pinned: !!r.pinned,
    effort: r.effort,
    voice: r.voice ?? 'luna',
    voiceSpeed: r.voice_speed ?? 1,
    voiceLanguage: r.voice_language ?? 'auto',
    model: r.model ?? null,
    provider: r.provider ?? null,
    generation: r.generation,
    heartbeatMin: r.heartbeat_min ?? 0,
    heartbeatChecklist: r.heartbeat_checklist ?? '',
    heartbeatQuiet: (r.heartbeat_quiet ?? 1) !== 0,
    heartbeatLastAt: r.heartbeat_last_at ?? null,
    heartbeatLastNote: r.heartbeat_last_note ?? null,
    unread: r.unread,
    lastPreview: lastPreview ? lastPreview.slice(0, 140) : null,
    lastActivityAt: last?.created_at ?? r.updated_at,
    createdAt: r.created_at,
  };
}

export const getBotRow = (id: string) => db.prepare('SELECT * FROM bots WHERE id=?').get(id) as any;
export const getBot = (id: string) => {
  const r = getBotRow(id);
  return r ? toBot(r) : null;
};
export const listBots = (userId: string) =>
  (db.prepare('SELECT * FROM bots WHERE user_id=? AND COALESCE(hidden,0)=0 ORDER BY is_primary DESC, created_at ASC').all(userId) as any[]).map(toBot);

export function emitBot(botId: string) {
  const r = getBotRow(botId);
  if (r) hub.emit(r.user_id, { type: 'bot', bot: toBot(r) });
}

// ---------- rows ----------

function toRow(r: any): Row {
  return { botId: r.bot_id, generation: r.generation, seq: r.seq, updatedSeq: r.updated_seq, kind: r.kind, body: JSON.parse(r.body), createdAt: r.created_at };
}

function bumpRev(botId: string): number {
  db.prepare('UPDATE bots SET rev = rev + 1, updated_at=? WHERE id=?').run(now(), botId);
  return (db.prepare('SELECT rev FROM bots WHERE id=?').get(botId) as any).rev;
}

/** Append a new row. Returns its seq. */
export function appendRow(botId: string, kind: RowKind, body: RowBody): Row {
  const tx = db.transaction(() => {
    const b = db.prepare('SELECT user_id, generation, next_seq FROM bots WHERE id=?').get(botId) as any;
    const seq = b.next_seq;
    db.prepare('UPDATE bots SET next_seq = next_seq + 1 WHERE id=?').run(botId);
    const rev = bumpRev(botId);
    const t = now();
    db.prepare('INSERT INTO rows(bot_id,generation,seq,updated_seq,kind,body,created_at) VALUES (?,?,?,?,?,?,?)').run(botId, b.generation, seq, rev, kind, JSON.stringify(body), t);
    return { userId: b.user_id as string, row: { botId, generation: b.generation, seq, updatedSeq: rev, kind, body, createdAt: t } as Row };
  });
  const { userId, row } = tx();
  hub.emit(userId, { type: 'rows', botId, generation: row.generation, rows: [row] });
  return row;
}

/** Rewrite an existing row's body (e.g. streaming text, card status). */
export function updateRow(botId: string, seq: number, body: RowBody): Row | null {
  const tx = db.transaction(() => {
    const b = db.prepare('SELECT user_id, generation FROM bots WHERE id=?').get(botId) as any;
    const existing = db.prepare('SELECT * FROM rows WHERE bot_id=? AND generation=? AND seq=?').get(botId, b.generation, seq) as any;
    if (!existing) return null;
    const rev = bumpRev(botId);
    db.prepare('UPDATE rows SET body=?, updated_seq=? WHERE bot_id=? AND generation=? AND seq=?').run(JSON.stringify(body), rev, botId, b.generation, seq);
    return { userId: b.user_id as string, row: { ...toRow(existing), body, updatedSeq: rev } as Row };
  });
  const res = tx();
  if (!res) return null;
  hub.emit(res.userId, { type: 'rows', botId, generation: res.row.generation, rows: [res.row] });
  return res.row;
}

export function getRow(botId: string, seq: number): Row | null {
  const b = getBotRow(botId);
  const r = db.prepare('SELECT * FROM rows WHERE bot_id=? AND generation=? AND seq=?').get(botId, b.generation, seq);
  return r ? toRow(r) : null;
}

export function listRows(botId: string, opts: { beforeSeq?: number; limit?: number; afterRev?: number } = {}): Row[] {
  const b = getBotRow(botId);
  if (!b) return [];
  if (opts.afterRev !== undefined) {
    return (db.prepare('SELECT * FROM rows WHERE bot_id=? AND generation=? AND updated_seq>? ORDER BY seq ASC').all(botId, b.generation, opts.afterRev) as any[]).map(toRow);
  }
  const limit = Math.min(opts.limit ?? 200, 500);
  const rows = (opts.beforeSeq
    ? db.prepare('SELECT * FROM rows WHERE bot_id=? AND generation=? AND seq<? ORDER BY seq DESC LIMIT ?').all(botId, b.generation, opts.beforeSeq, limit)
    : db.prepare('SELECT * FROM rows WHERE bot_id=? AND generation=? ORDER BY seq DESC LIMIT ?').all(botId, b.generation, limit)) as any[];
  return rows.reverse().map(toRow);
}

/** The next unused chat number for this bot (older chats keep theirs, so "+1" on the current one can clash). */
function nextGeneration(botId: string, current: number): number {
  const a = (db.prepare('SELECT MAX(generation) m FROM rows WHERE bot_id=?').get(botId) as any).m ?? 0;
  const b = (db.prepare('SELECT MAX(generation) m FROM chats WHERE bot_id=?').get(botId) as any).m ?? 0;
  return Math.max(current, a, b) + 1;
}

/** Point the bot at chat `generation` and tell the app to load it. */
function openGeneration(botId: string, generation: number) {
  const b = getBotRow(botId);
  const max = (db.prepare('SELECT MAX(seq) m FROM rows WHERE bot_id=? AND generation=?').get(botId, generation) as any).m ?? 0;
  db.prepare('UPDATE bots SET generation=?, next_seq=? WHERE id=?').run(generation, max + 1, botId);
  db.prepare('DELETE FROM pending_turns WHERE bot_id=?').run(botId);
  hub.emit(b.user_id, { type: 'cleared', botId, generation, reload: max > 0 });
  hub.emit(b.user_id, { type: 'chats', botId });
}

/** Start a new, empty chat. An empty current chat is reused rather than piling up blank ones. */
export function clearConversation(botId: string) {
  const b = getBotRow(botId);
  const empty = !db.prepare('SELECT 1 FROM rows WHERE bot_id=? AND generation=? LIMIT 1').get(botId, b.generation);
  if (empty) { hub.emit(b.user_id, { type: 'chats', botId }); return; }
  openGeneration(botId, nextGeneration(botId, b.generation));
}

// ---------- chats ----------


const rowText = (body: string): string | null => {
  try {
    const b = JSON.parse(body) as RowBody;
    if (b.type === 'message') return b.text;
    if (b.type === 'event') return b.text;
  } catch { /* */ }
  return null;
};

export function listChats(botId: string): ChatInfo[] {
  const b = getBotRow(botId);
  if (!b) return [];
  const stats = db.prepare(`SELECT generation g, MIN(created_at) first, MAX(created_at) last,
      SUM(CASE WHEN kind='message' THEN 1 ELSE 0 END) n FROM rows WHERE bot_id=? GROUP BY generation`).all(botId) as any[];
  const meta = new Map((db.prepare('SELECT * FROM chats WHERE bot_id=?').all(botId) as any[]).map((r) => [r.generation, r]));
  const gens = new Map<number, { first: number; last: number; n: number }>();
  for (const s of stats) gens.set(s.g, { first: s.first, last: s.last, n: s.n });
  if (!gens.has(b.generation)) gens.set(b.generation, { first: now(), last: now(), n: 0 });
  const firstUser = db.prepare("SELECT body FROM rows WHERE bot_id=? AND generation=? AND kind='message' AND json_extract(body,'$.role')='user' ORDER BY seq LIMIT 1");
  const lastMsg = db.prepare("SELECT body FROM rows WHERE bot_id=? AND generation=? AND kind IN ('message','event') ORDER BY seq DESC LIMIT 1");
  const out: ChatInfo[] = [];
  for (const [g, st] of gens) {
    const m = meta.get(g);
    const first = firstUser.get(botId, g) as any;
    const last = lastMsg.get(botId, g) as any;
    const auto = first ? (rowText(first.body) ?? '').replace(/\s+/g, ' ').trim() : '';
    out.push({
      generation: g,
      title: m?.title || (auto ? (auto.length > 60 ? `${auto.slice(0, 57).trimEnd()}…` : auto) : st.n ? 'Chat' : 'New chat'),
      preview: last ? (rowText(last.body) ?? '').replace(/\s+/g, ' ').slice(0, 120) || null : null,
      messages: st.n,
      archived: !!m?.archived,
      current: g === b.generation,
      createdAt: m?.created_at ?? st.first,
      updatedAt: st.last,
    });
  }
  return out.sort((x, y) => y.updatedAt - x.updatedAt);
}

const chatExists = (botId: string, g: number) =>
  !!db.prepare('SELECT 1 FROM rows WHERE bot_id=? AND generation=? LIMIT 1').get(botId, g) || getBotRow(botId)?.generation === g;

function upsertChat(botId: string, g: number, patch: { title?: string | null; archived?: boolean; note?: string | null }) {
  db.prepare('INSERT OR IGNORE INTO chats(bot_id,generation,created_at) VALUES (?,?,?)').run(botId, g, now());
  if (patch.title !== undefined) db.prepare('UPDATE chats SET title=? WHERE bot_id=? AND generation=?').run(patch.title, botId, g);
  if (patch.archived !== undefined) db.prepare('UPDATE chats SET archived=? WHERE bot_id=? AND generation=?').run(patch.archived ? 1 : 0, botId, g);
  if (patch.note !== undefined) db.prepare('UPDATE chats SET note=? WHERE bot_id=? AND generation=?').run(patch.note, botId, g);
}

export function openChat(botId: string, g: number) {
  if (!chatExists(botId, g)) throw new Error('That chat no longer exists.');
  upsertChat(botId, g, { archived: false });
  if (getBotRow(botId).generation !== g) openGeneration(botId, g);
  else hub.emit(getBotRow(botId).user_id, { type: 'chats', botId });
}

export function renameChat(botId: string, g: number, title: string) {
  if (!chatExists(botId, g)) throw new Error('That chat no longer exists.');
  upsertChat(botId, g, { title: title.trim().slice(0, 80) || null });
  hub.emit(getBotRow(botId).user_id, { type: 'chats', botId });
}

/** Archive or bring back a chat. Archiving the open chat moves the bot to a new one. */
export function archiveChat(botId: string, g: number, archived: boolean) {
  if (!chatExists(botId, g)) throw new Error('That chat no longer exists.');
  upsertChat(botId, g, { archived });
  const b = getBotRow(botId);
  if (archived && b.generation === g) openGeneration(botId, nextGeneration(botId, g));
  else hub.emit(b.user_id, { type: 'chats', botId });
}

/** Delete a chat for good. Deleting the open chat moves the bot to the newest other chat (or a new one). */
export function deleteChat(botId: string, g: number) {
  const b = getBotRow(botId);
  db.transaction(() => {
    db.prepare('DELETE FROM rows WHERE bot_id=? AND generation=?').run(botId, g);
    db.prepare('DELETE FROM llm_items WHERE bot_id=? AND generation=?').run(botId, g);
    db.prepare('DELETE FROM chats WHERE bot_id=? AND generation=?').run(botId, g);
  })();
  if (b.generation === g) {
    const next = db.prepare(`SELECT r.generation g FROM rows r LEFT JOIN chats c ON c.bot_id=r.bot_id AND c.generation=r.generation
      WHERE r.bot_id=? AND COALESCE(c.archived,0)=0 GROUP BY r.generation ORDER BY MAX(r.created_at) DESC LIMIT 1`).get(botId) as any;
    openGeneration(botId, next ? next.g : nextGeneration(botId, g));
  } else hub.emit(b.user_id, { type: 'chats', botId });
}

/** A plain-text copy of a chat, for handing its content to the bot (merges) or to a person. */
export function chatTranscript(botId: string, g: number, maxChars = 12_000): string {
  const rows = db.prepare("SELECT body FROM rows WHERE bot_id=? AND generation=? AND kind='message' ORDER BY seq").all(botId, g) as any[];
  const lines = rows.map((r) => {
    const b = JSON.parse(r.body);
    const who = b.role === 'user' ? (b.from?.name ?? 'User') : 'You';
    return `${who}: ${String(b.text ?? '').trim()}`;
  }).filter((l) => !/:\s*$/.test(l));
  let text = lines.join('\n\n');
  if (text.length > maxChars) text = `…${text.slice(text.length - maxChars)}`;
  return text;
}

/**
 * Merge chat `from` into chat `into`: its messages are added at the end of `into` (oldest first),
 * `from` is removed, and the bot is told what was merged on its next turn in `into`.
 */
export function mergeChats(botId: string, from: number, into: number) {
  if (from === into) throw new Error('Pick two different chats.');
  if (!chatExists(botId, from) || !chatExists(botId, into)) throw new Error('That chat no longer exists.');
  const b = getBotRow(botId);
  const titleOf = (g: number) => listChats(botId).find((c) => c.generation === g)?.title ?? 'another chat';
  const fromTitle = titleOf(from);
  const transcript = chatTranscript(botId, from);
  db.transaction(() => {
    let seq = ((db.prepare('SELECT MAX(seq) m FROM rows WHERE bot_id=? AND generation=?').get(botId, into) as any).m ?? 0) + 1;
    const rev = bumpRev(botId);
    const ins = db.prepare('INSERT INTO rows(bot_id,generation,seq,updated_seq,kind,body,created_at) VALUES (?,?,?,?,?,?,?)');
    ins.run(botId, into, seq++, rev, 'event', JSON.stringify({ type: 'event', event: 'chat-merged', text: `Merged in: ${fromTitle}` }), now());
    const moved = db.prepare('SELECT kind, body, created_at FROM rows WHERE bot_id=? AND generation=? ORDER BY seq').all(botId, from) as any[];
    for (const r of moved) {
      const body = JSON.parse(r.body);
      // Cards from the old chat can't be answered any more: keep the text, not the buttons.
      if (r.kind === 'card' || r.kind === 'tool-call') continue;
      if (body.type === 'message') body.streaming = false;
      ins.run(botId, into, seq++, rev, r.kind, JSON.stringify(body), r.created_at);
    }
    db.prepare('DELETE FROM rows WHERE bot_id=? AND generation=?').run(botId, from);
    db.prepare('DELETE FROM llm_items WHERE bot_id=? AND generation=?').run(botId, from);
    db.prepare('DELETE FROM chats WHERE bot_id=? AND generation=?').run(botId, from);
    const prev = (db.prepare('SELECT note FROM chats WHERE bot_id=? AND generation=?').get(botId, into) as any)?.note;
    const note = transcript ? `The user merged another chat ("${fromTitle}") into this one. Treat it as part of this conversation:\n${transcript}` : null;
    if (note) upsertChat(botId, into, { note: prev ? `${prev}\n\n${note}` : note });
    if (b.generation === into) db.prepare('UPDATE bots SET next_seq=? WHERE id=?').run(seq, botId);
  })();
  if (b.generation === from || b.generation === into) openGeneration(botId, into);
  else hub.emit(b.user_id, { type: 'chats', botId });
}

/** Something the bot should be told once, at the start of its next turn in the open chat. */
export function takeChatNote(botId: string): string | null {
  const b = getBotRow(botId);
  const r = db.prepare('SELECT note FROM chats WHERE bot_id=? AND generation=?').get(botId, b.generation) as any;
  if (!r?.note) return null;
  db.prepare('UPDATE chats SET note=NULL WHERE bot_id=? AND generation=?').run(botId, b.generation);
  return r.note;
}

export function addChatNote(botId: string, note: string) {
  const b = getBotRow(botId);
  const prev = (db.prepare('SELECT note FROM chats WHERE bot_id=? AND generation=?').get(botId, b.generation) as any)?.note;
  upsertChat(botId, b.generation, { note: prev ? `${prev}\n\n${note}` : note });
}

/** Take a quiet heartbeat's own rows back out of chat `generation` (the user's messages stay). */
export function dropRowsFrom(botId: string, fromSeq: number, generation: number) {
  const b = getBotRow(botId);
  db.prepare(`DELETE FROM rows WHERE bot_id=? AND generation=? AND seq>=?
    AND NOT (kind='message' AND json_extract(body,'$.role')='user')`).run(botId, generation, fromSeq);
  if (b.generation === generation) hub.emit(b.user_id, { type: 'cleared', botId, generation, reload: true });
}

// ---------- LLM history (Responses API input items) ----------

export function loadHistory(botId: string): any[] {
  const b = getBotRow(botId);
  return (db.prepare('SELECT item FROM llm_items WHERE bot_id=? AND generation=? ORDER BY idx ASC').all(botId, b.generation) as any[]).map((r) => JSON.parse(r.item));
}

export function appendHistory(botId: string, items: any[]) {
  if (!items.length) return;
  const b = getBotRow(botId);
  const start = ((db.prepare('SELECT MAX(idx) m FROM llm_items WHERE bot_id=? AND generation=?').get(botId, b.generation) as any).m ?? -1) + 1;
  const ins = db.prepare('INSERT INTO llm_items(bot_id,generation,idx,item) VALUES (?,?,?,?)');
  db.transaction(() => items.forEach((it, i) => ins.run(botId, b.generation, start + i, JSON.stringify(it))))();
}

// ---------- live state ----------

const live = new Map<string, LiveState>();

export function getLive(botId: string): LiveState {
  return live.get(botId) ?? { botId, isRunning: false, activity: null, awaiting: null, startedAt: null };
}

export function setLive(botId: string, patch: Partial<LiveState>) {
  const next = { ...getLive(botId), ...patch, botId };
  live.set(botId, next);
  const b = getBotRow(botId);
  if (b) hub.emit(b.user_id, { type: 'live', state: next });
}

export const allLive = (userId: string) => listBots(userId).map((b) => getLive(b.id));

// ---------- routines / tasks ----------

export function describeCron(expr: string, tz = 'UTC'): string {
  if (isOnceSchedule(expr)) { let z = tz; try { new Intl.DateTimeFormat('en', { timeZone: z }); } catch { z = 'UTC'; } return `Once, ${new Date(expr).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: z })}`; }
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return expr;
  const [m, h, dom, mon, dow] = p;
  const time = /^\d+$/.test(m) && /^\d+$/.test(h) ? new Date(2000, 0, 1, +h, +m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;
  if (time && dom === '*' && mon === '*' && dow === '*') return `Every day at ${time}`;
  if (time && dom === '*' && mon === '*' && dow === '1-5') return `Weekdays at ${time}`;
  if (time && dom === '*' && mon === '*' && /^[0-6]$/.test(dow)) return `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][+dow]} at ${time}`;
  if (m === '0' && h === '*') return 'Every hour';
  if (/^\*\/\d+$/.test(m) && h === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${m.slice(2)} minutes`;
  if (m === '0' && /^\*\/\d+$/.test(h) && dom === '*' && mon === '*' && dow === '*') return `Every ${h.slice(2)} hours`;
  return expr;
}

function describeEventSlug(schedule: string) {
  const words = schedule.slice(6).split('_');
  const app = words.shift() ?? '';
  return `When ${app.charAt(0) + app.slice(1).toLowerCase()}: ${words.join(' ').toLowerCase()}`;
}

export function toRoutine(r: any): Routine {
  let nextRunAt: number | null = null;
  try {
    nextRunAt = r.enabled ? new Cron(r.schedule, { timezone: r.timezone, paused: true }).nextRun()?.getTime() ?? null : null;
  } catch { /* invalid cron */ }
  return {
    id: r.id, botId: r.bot_id, name: r.name, prompt: r.prompt, schedule: r.schedule, timezone: r.timezone,
    enabled: !!r.enabled, nextRunAt, lastRunAt: r.last_run_at, description: r.schedule.startsWith('event:') ? describeEventSlug(r.schedule) : describeCron(r.schedule, r.timezone),
  };
}

export const listRoutines = (botId: string) => (db.prepare('SELECT * FROM routines WHERE bot_id=? ORDER BY created_at').all(botId) as any[]).map(toRoutine);

export const toTask = (r: any): Task => ({ id: r.id, botId: r.bot_id, title: r.title, state: r.state, note: r.note, updatedAt: r.updated_at });
export const listTasks = (botId: string) => (db.prepare('SELECT * FROM tasks WHERE bot_id=? ORDER BY updated_at DESC').all(botId) as any[]).map(toTask);

/** A one-off schedule is an ISO date-time with an offset, e.g. 2026-11-16T17:00:00+02:00. */
export function isOnceSchedule(expr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(expr.trim()) && !Number.isNaN(Date.parse(expr));
}

/** The user's time zone (from their browser), or the server's default. */
export function userTimezone(userId: string): string {
  const r = db.prepare('SELECT timezone FROM users WHERE id=?').get(userId) as any;
  return r?.timezone || process.env.HQ_TIMEZONE || 'UTC';
}
