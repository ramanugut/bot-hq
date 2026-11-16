import fs from 'node:fs';
import path from 'node:path';
import { db, now } from './db.js';
import { env } from './env.js';
import { newId } from './lib/ids.js';
import { ftsQuery, MAX_BODY, safeFileName, wikiLinks } from './lib/knowledge-text.js';

/**
 * Company knowledge: what the business knows, kept in spaces (Company, Customer-safe, Personal), searchable by
 * Teammate bots that are allowed into a space. Entries live in SQLite with a full-text index and a change history,
 * and every entry is also written out as a plain Markdown file under <data>/knowledge, so the knowledge stays
 * readable and portable without the app. Uploaded originals (logos, PDFs, Word files) are kept beside them.
 */

export type SpaceKind = 'company' | 'customer' | 'personal' | 'custom';
export interface KnowledgeSpace { id: string; name: string; kind: SpaceKind; description: string; entries: number }
export interface KnowledgeEntrySummary {
  id: string; spaceId: string; title: string; kind: 'text' | 'image' | 'document';
  fileName: string | null; size: number | null; updatedAt: number; updatedBy: string; snippet?: string;
}
export interface KnowledgeEntry extends KnowledgeEntrySummary {
  body: string; createdAt: number; links: { title: string; id: string | null }[];
  revisions: { id: number; title: string; at: number; by: string }[];
}

export const KNOWLEDGE_DIR = path.join(path.dirname(env.dbPath), 'knowledge');
const FILES_DIR = path.join(KNOWLEDGE_DIR, 'files');
const MAX_REVISIONS = 50;

const DEFAULT_SPACES: { kind: SpaceKind; name: string; description: string }[] = [
  { kind: 'company', name: 'Company', description: 'Internal know-how: how things work, suppliers, procedures. Never shown to customers.' },
  { kind: 'customer', name: 'Customer-safe', description: 'What a bot may tell customers: plans, prices, FAQs, policies, setup guides.' },
  { kind: 'personal', name: 'Personal', description: 'Your own notes and preferences. Only bots you tick can read it.' },
];

db.exec(`
CREATE TABLE IF NOT EXISTS knowledge_spaces (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'text',
  file_name TEXT,
  file_size INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'you'
);
CREATE INDEX IF NOT EXISTS knowledge_entries_space ON knowledge_entries(space_id, updated_at);
CREATE TABLE IF NOT EXISTS knowledge_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(entry_id UNINDEXED, title, body, tokenize = 'porter unicode61 remove_diacritics 2');
`);
// Which spaces a Teammate bot may read: a JSON list of space ids; NULL means the defaults (Company, Customer-safe).
{
  const cols = db.prepare('PRAGMA table_info(bots)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'knowledge_spaces')) db.exec('ALTER TABLE bots ADD COLUMN knowledge_spaces TEXT');
}

const toSummary = (r: any): KnowledgeEntrySummary => ({
  id: r.id, spaceId: r.space_id, title: r.title, kind: r.kind, fileName: r.file_name ?? null, size: r.file_size ?? null,
  updatedAt: r.updated_at, updatedBy: r.updated_by, ...(r.snippet ? { snippet: r.snippet } : {}),
});

/** The user's spaces, creating the three defaults the first time. */
export function listSpaces(userId: string): KnowledgeSpace[] {
  const has = db.prepare('SELECT 1 FROM knowledge_spaces WHERE user_id=? LIMIT 1').get(userId);
  if (!has) {
    const ins = db.prepare('INSERT INTO knowledge_spaces(id,user_id,name,kind,description,created_at) VALUES (?,?,?,?,?,?)');
    DEFAULT_SPACES.forEach((s, i) => ins.run(newId('ks'), userId, s.name, s.kind, s.description, now() + i));
  }
  return (db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM knowledge_entries e WHERE e.space_id=s.id) AS entries
    FROM knowledge_spaces s WHERE s.user_id=? ORDER BY s.created_at`).all(userId) as any[])
    .map((s) => ({ id: s.id, name: s.name, kind: s.kind, description: s.description, entries: s.entries }));
}

export const ownSpace = (userId: string, spaceId: string) =>
  db.prepare('SELECT * FROM knowledge_spaces WHERE id=? AND user_id=?').get(spaceId, userId) as any;
const ownEntry = (userId: string, id: string) =>
  db.prepare('SELECT * FROM knowledge_entries WHERE id=? AND user_id=?').get(id, userId) as any;

function index(id: string, title: string, body: string) {
  db.prepare('DELETE FROM knowledge_fts WHERE entry_id=?').run(id);
  db.prepare('INSERT INTO knowledge_fts(entry_id,title,body) VALUES (?,?,?)').run(id, title, body);
}

/** Plain Markdown copy of every entry: <data>/knowledge/<space name>/<title>-<id>.md */
function mirrorPath(entry: { id: string; title: string; space_id: string }): string {
  const space = db.prepare('SELECT name FROM knowledge_spaces WHERE id=?').get(entry.space_id) as any;
  const dir = safeFileName(space?.name ?? 'space').replace(/\.+$/, '');
  const name = safeFileName(entry.title).replace(/\.[^.]*$/, '').slice(0, 60) || 'entry';
  return path.join(KNOWLEDGE_DIR, dir, `${name}-${entry.id}.md`);
}
function writeMirror(id: string) {
  const r = db.prepare('SELECT * FROM knowledge_entries WHERE id=?').get(id) as any;
  if (!r) return;
  for (const old of findMirrors(id)) fs.rmSync(old, { force: true });
  const file = mirrorPath(r);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const head = `# ${r.title}\n\n${r.file_name ? `File: ${r.file_name}\n\n` : ''}`;
  fs.writeFileSync(file, `${head}${r.body}\n`);
}
function findMirrors(id: string): string[] {
  if (!fs.existsSync(KNOWLEDGE_DIR)) return [];
  const out: string[] = [];
  for (const d of fs.readdirSync(KNOWLEDGE_DIR, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name === 'files') continue;
    for (const f of fs.readdirSync(path.join(KNOWLEDGE_DIR, d.name))) if (f.endsWith(`-${id}.md`)) out.push(path.join(KNOWLEDGE_DIR, d.name, f));
  }
  return out;
}

/** Where an entry's original file is kept. */
export function entryFilePath(entry: { id: string; file_name: string | null }): string | null {
  return entry.file_name ? path.join(FILES_DIR, entry.id, safeFileName(entry.file_name)) : null;
}

export function listEntries(userId: string, spaceId: string | null, q?: string): KnowledgeEntrySummary[] {
  if (q && q.trim()) return search(userId, spaceId ? [spaceId] : null, q, 50);
  const rows = spaceId
    ? db.prepare('SELECT * FROM knowledge_entries WHERE user_id=? AND space_id=? ORDER BY updated_at DESC LIMIT 500').all(userId, spaceId)
    : db.prepare('SELECT * FROM knowledge_entries WHERE user_id=? ORDER BY updated_at DESC LIMIT 500').all(userId);
  return (rows as any[]).map(toSummary);
}

/** Full-text search, best matches first. Every word must match; if nothing does, any word may. */
export function search(userId: string, spaceIds: string[] | null, q: string, limit = 6): KnowledgeEntrySummary[] {
  if (spaceIds && !spaceIds.length) return [];
  const where = spaceIds ? `AND e.space_id IN (${spaceIds.map(() => '?').join(',')})` : '';
  const stmt = db.prepare(`SELECT e.*, snippet(knowledge_fts, 2, '«', '»', '…', 18) AS snippet
    FROM knowledge_fts f JOIN knowledge_entries e ON e.id = f.entry_id
    WHERE knowledge_fts MATCH ? AND e.user_id=? ${where}
    ORDER BY bm25(knowledge_fts, 0, 6, 1) LIMIT ?`);
  for (const mode of ['all', 'any'] as const) {
    const fq = ftsQuery(q, mode);
    if (!fq) return [];
    const rows = stmt.all(fq, userId, ...(spaceIds ?? []), limit) as any[];
    if (rows.length) return rows.map(toSummary);
  }
  return [];
}

export function getEntry(userId: string, id: string): KnowledgeEntry | null {
  const r = ownEntry(userId, id);
  if (!r) return null;
  const revisions = (db.prepare('SELECT id,title,by,created_at FROM knowledge_revisions WHERE entry_id=? ORDER BY id DESC').all(id) as any[])
    .map((v) => ({ id: v.id, title: v.title, at: v.created_at, by: v.by }));
  const links = wikiLinks(r.body).map((title) => {
    const hit = db.prepare('SELECT id FROM knowledge_entries WHERE user_id=? AND lower(title)=lower(?) LIMIT 1').get(userId, title) as any;
    return { title, id: hit?.id ?? null };
  });
  return { ...toSummary(r), body: r.body, createdAt: r.created_at, links, revisions };
}

export interface NewEntry { spaceId: string; title: string; body: string; by: string; file?: { name: string; data: Buffer; kind: 'image' | 'document' | 'text' } }

export function createEntry(userId: string, e: NewEntry): KnowledgeEntry {
  if (!ownSpace(userId, e.spaceId)) throw new Error('No such space.');
  const id = newId('kn');
  const title = e.title.trim().slice(0, 160) || 'Untitled';
  const body = e.body.slice(0, MAX_BODY);
  const kind = e.file?.kind === 'image' ? 'image' : e.file && e.file.kind !== 'text' ? 'document' : 'text';
  db.prepare(`INSERT INTO knowledge_entries(id,user_id,space_id,title,body,kind,file_name,file_size,created_at,updated_at,updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, e.spaceId, title, body, kind, e.file?.name ?? null, e.file?.data.length ?? null, now(), now(), e.by);
  if (e.file) {
    const file = entryFilePath({ id, file_name: e.file.name })!;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, e.file.data);
  }
  index(id, title, body);
  writeMirror(id);
  return getEntry(userId, id)!;
}

/** Change an entry, keeping the previous version in its history. */
export function updateEntry(userId: string, id: string, p: { title?: string; body?: string; spaceId?: string; by: string }): KnowledgeEntry | null {
  const r = ownEntry(userId, id);
  if (!r) return null;
  if (p.spaceId && !ownSpace(userId, p.spaceId)) throw new Error('No such space.');
  const title = p.title !== undefined ? p.title.trim().slice(0, 160) || r.title : r.title;
  const body = p.body !== undefined ? p.body.slice(0, MAX_BODY) : r.body;
  const spaceId = p.spaceId ?? r.space_id;
  if (title === r.title && body === r.body && spaceId === r.space_id) return getEntry(userId, id);
  db.prepare('INSERT INTO knowledge_revisions(entry_id,title,body,by,created_at) VALUES (?,?,?,?,?)').run(id, r.title, r.body, r.updated_by, r.updated_at);
  db.prepare(`DELETE FROM knowledge_revisions WHERE entry_id=? AND id NOT IN (SELECT id FROM knowledge_revisions WHERE entry_id=? ORDER BY id DESC LIMIT ${MAX_REVISIONS})`).run(id, id);
  db.prepare('UPDATE knowledge_entries SET title=?, body=?, space_id=?, updated_at=?, updated_by=? WHERE id=?').run(title, body, spaceId, now(), p.by, id);
  index(id, title, body);
  writeMirror(id);
  return getEntry(userId, id);
}

/** Put an older version back (the current one goes into the history first, so this can be undone too). */
export function restoreRevision(userId: string, id: string, revisionId: number, by: string): KnowledgeEntry | null {
  const v = db.prepare('SELECT v.* FROM knowledge_revisions v JOIN knowledge_entries e ON e.id=v.entry_id WHERE v.id=? AND v.entry_id=? AND e.user_id=?').get(revisionId, id, userId) as any;
  if (!v) return null;
  return updateEntry(userId, id, { title: v.title, body: v.body, by });
}

export function revisionBody(userId: string, id: string, revisionId: number): { title: string; body: string } | null {
  const v = db.prepare('SELECT v.title, v.body FROM knowledge_revisions v JOIN knowledge_entries e ON e.id=v.entry_id WHERE v.id=? AND v.entry_id=? AND e.user_id=?').get(revisionId, id, userId) as any;
  return v ?? null;
}

export function deleteEntry(userId: string, id: string): boolean {
  const r = ownEntry(userId, id);
  if (!r) return false;
  db.prepare('DELETE FROM knowledge_fts WHERE entry_id=?').run(id);
  db.prepare('DELETE FROM knowledge_entries WHERE id=?').run(id);
  for (const f of findMirrors(id)) fs.rmSync(f, { force: true });
  fs.rmSync(path.join(FILES_DIR, id), { recursive: true, force: true });
  return true;
}

/** An entry with its stored file, for serving it to the owner or copying it into a bot's Library. */
export function entryFile(userId: string, id: string): { path: string; name: string } | null {
  const r = ownEntry(userId, id);
  const file = r ? entryFilePath(r) : null;
  return file && fs.existsSync(file) ? { path: file, name: r.file_name } : null;
}

// ---------- which bots may read what ----------

/** Spaces a bot may read. Only Teammate bots use knowledge; Personal assistants get none. */
export function botSpaceIds(bot: { user_id: string; mode: string; knowledge_spaces: string | null }): string[] {
  if (bot.mode !== 'teammate') return [];
  const spaces = listSpaces(bot.user_id);
  const valid = new Set(spaces.map((s) => s.id));
  if (bot.knowledge_spaces === null || bot.knowledge_spaces === undefined) {
    return spaces.filter((s) => s.kind === 'company' || s.kind === 'customer').map((s) => s.id);
  }
  try {
    const ids = JSON.parse(bot.knowledge_spaces);
    return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string' && valid.has(x)) : [];
  } catch { return []; }
}

export function setBotSpaceIds(userId: string, botId: string, ids: string[]): string[] {
  const valid = new Set(listSpaces(userId).map((s) => s.id));
  const clean = [...new Set(ids.filter((x) => valid.has(x)))];
  db.prepare('UPDATE bots SET knowledge_spaces=? WHERE id=? AND user_id=?').run(JSON.stringify(clean), botId, userId);
  return clean;
}

/** Where a bot can read: space ids and names, for its tools and instructions. */
export function botSpaces(bot: { user_id: string; mode: string; knowledge_spaces: string | null }): { id: string; name: string; kind: SpaceKind }[] {
  const ids = new Set(botSpaceIds(bot));
  return listSpaces(bot.user_id).filter((s) => ids.has(s.id)).map((s) => ({ id: s.id, name: s.name, kind: s.kind }));
}
