import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { db } from './db.js';
import { requireUser, type AuthVars } from './lib/auth.js';
import { extOf, extractText, kindOf, looksSecret, MAX_FILE, safeFileName, titleFromFile, ACCEPTED_EXT } from './lib/knowledge-text.js';
import {
  botSpaceIds, createEntry, deleteEntry, entryFile, getEntry, listEntries, listSpaces, ownSpace,
  restoreRevision, revisionBody, setBotSpaceIds, updateEntry,
} from './knowledge.js';

/** /api/knowledge: the Knowledge page. Only the signed-in owner reads and edits; bots go through their tools. */
export const knowledgeApi = new Hono<AuthVars>();
knowledgeApi.use('*', requireUser);

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', csv: 'text/csv; charset=utf-8',
};

knowledgeApi.get('/spaces', (c) => c.json({ spaces: listSpaces(c.get('user').id) }));

knowledgeApi.get('/entries', (c) => {
  const userId = c.get('user').id;
  const space = c.req.query('space') || null;
  if (space && !ownSpace(userId, space)) return c.json({ error: 'not found' }, 404);
  return c.json({ entries: listEntries(userId, space, c.req.query('q') ?? '') });
});

knowledgeApi.get('/entries/:id', (c) => {
  const e = getEntry(c.get('user').id, c.req.param('id'));
  return e ? c.json({ entry: e }) : c.json({ error: 'not found' }, 404);
});

knowledgeApi.get('/entries/:id/revisions/:rev', (c) => {
  const v = revisionBody(c.get('user').id, c.req.param('id'), Number(c.req.param('rev')));
  return v ? c.json({ revision: v }) : c.json({ error: 'not found' }, 404);
});

/** A typed entry. A body that looks like it holds a password is refused unless `confirmed` (the owner said so). */
knowledgeApi.post('/entries', async (c) => {
  const userId = c.get('user').id;
  const b = await c.req.json<{ spaceId?: string; title?: string; body?: string; confirmed?: boolean }>().catch(() => ({} as any));
  if (!b.spaceId || !ownSpace(userId, b.spaceId)) return c.json({ error: 'Pick a space.' }, 400);
  const body = String(b.body ?? '');
  const secret = looksSecret(`${b.title ?? ''}\n${body}`);
  if (secret && !b.confirmed) return c.json({ error: `This looks like it contains ${secret}. Knowledge is read by bots and may reach customers, so keep secrets out of it.`, secret }, 409);
  return c.json({ entry: createEntry(userId, { spaceId: b.spaceId, title: String(b.title ?? ''), body, by: 'you' }) });
});

knowledgeApi.patch('/entries/:id', async (c) => {
  const userId = c.get('user').id;
  const b = await c.req.json<{ title?: string; body?: string; spaceId?: string; confirmed?: boolean }>().catch(() => ({} as any));
  if (b.spaceId && !ownSpace(userId, b.spaceId)) return c.json({ error: 'No such space.' }, 400);
  const secret = b.body !== undefined || b.title !== undefined ? looksSecret(`${b.title ?? ''}\n${b.body ?? ''}`) : null;
  if (secret && !b.confirmed) return c.json({ error: `This looks like it contains ${secret}. Knowledge is read by bots and may reach customers, so keep secrets out of it.`, secret }, 409);
  const e = updateEntry(userId, c.req.param('id'), { title: b.title, body: b.body, spaceId: b.spaceId, by: 'you' });
  return e ? c.json({ entry: e }) : c.json({ error: 'not found' }, 404);
});

knowledgeApi.post('/entries/:id/restore', async (c) => {
  const b = await c.req.json<{ revisionId?: number }>().catch(() => ({} as any));
  const e = restoreRevision(c.get('user').id, c.req.param('id'), Number(b.revisionId), 'you');
  return e ? c.json({ entry: e }) : c.json({ error: 'not found' }, 404);
});

knowledgeApi.delete('/entries/:id', (c) => (deleteEntry(c.get('user').id, c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)));

/** Upload one file (logo, photo, PDF, Word, text). Its text is extracted so bots can search it. */
knowledgeApi.post('/upload', async (c) => {
  const userId = c.get('user').id;
  const form = await c.req.parseBody().catch(() => null);
  const f = form?.file;
  const spaceId = typeof form?.spaceId === 'string' ? form.spaceId : '';
  if (!spaceId || !ownSpace(userId, spaceId)) return c.json({ error: 'Pick a space.' }, 400);
  if (!f || typeof f === 'string') return c.json({ error: 'No file.' }, 400);
  if (f.size > MAX_FILE) return c.json({ error: 'Files can be up to 25 MB.' }, 413);
  const name = safeFileName(f.name);
  const kind = kindOf(name);
  if (!kind) return c.json({ error: `That file type is not supported. Use: ${ACCEPTED_EXT.join(', ')}.` }, 415);
  const data = Buffer.from(await f.arrayBuffer());
  const description = typeof form?.description === 'string' ? form.description.slice(0, 4000) : '';
  let body = description;
  if (kind !== 'image') {
    // Extract from a private temporary copy; the stored original is written by createEntry.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'botly-kn-'));
    try {
      const file = path.join(tmp, name);
      fs.writeFileSync(file, data);
      const text = await extractText(file);
      body = [description, text].filter(Boolean).join('\n\n');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  const secret = looksSecret(body);
  if (secret && form?.confirmed !== '1') return c.json({ error: `${f.name} looks like it contains ${secret}. Knowledge is read by bots and may reach customers, so keep secrets out of it.`, secret }, 409);
  // A document that opens with its own heading ("# Refund policy") takes it as the title, without repeating it.
  let title = typeof form?.title === 'string' && form.title.trim() ? form.title : titleFromFile(f.name);
  const heading = /^\s*#\s+(.{2,120}?)\s*\n/.exec(body.slice(description.length ? description.length + 2 : 0));
  if (heading && !(typeof form?.title === 'string' && form.title.trim())) {
    title = heading[1].replace(/[#*_`]/g, '').trim() || title;
    body = description ? `${description}\n\n${body.slice(description.length + 2).replace(heading[0], '').trim()}` : body.replace(heading[0], '').trim();
  }
  const entry = createEntry(userId, { spaceId, title, body, by: 'you', file: { name, data, kind } });
  return c.json({ entry, extracted: kind === 'image' ? null : body.length > description.length });
});

/** The original file: inline for images and PDFs, a download otherwise. */
knowledgeApi.get('/entries/:id/file', (c) => {
  const file = entryFile(c.get('user').id, c.req.param('id'));
  if (!file) return c.json({ error: 'not found' }, 404);
  const ext = extOf(file.name);
  const inline = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf'].includes(ext) && c.req.query('download') !== '1';
  return new Response(Readable.toWeb(fs.createReadStream(file.path)) as ReadableStream, {
    headers: {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': String(fs.statSync(file.path).size),
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${file.name.replace(/"/g, '')}"`,
      // SVGs and HTML are downloaded, never rendered in the app's origin.
      'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=300',
    },
  });
});

// ---------- which spaces each bot may read ----------

const ownBotRow = (userId: string, id: string) => db.prepare('SELECT * FROM bots WHERE id=? AND user_id=?').get(id, userId) as any;

knowledgeApi.get('/bots/:id', (c) => {
  const b = ownBotRow(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  // Personal assistants read none, but the ticks they would get as a Teammate are still shown.
  return c.json({ teammate: b.mode === 'teammate', spaceIds: botSpaceIds({ ...b, mode: 'teammate' }) });
});

knowledgeApi.put('/bots/:id', async (c) => {
  const userId = c.get('user').id;
  const b = ownBotRow(userId, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ spaceIds?: string[] }>().catch(() => ({} as any));
  return c.json({ spaceIds: setBotSpaceIds(userId, b.id, Array.isArray(body.spaceIds) ? body.spaceIds : []) });
});
