import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A throwaway database and data folder, set before the server modules load.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'botly-knowledge-'));
process.env.DB_PATH = path.join(tmp, 'data', 'botly.db');
process.env.SESSION_SECRET ??= 'test-secret-test-secret-test-secret';
const text = await import('../server/dist/lib/knowledge-text.js');
const kn = await import('../server/dist/knowledge.js');
const { db } = await import('../server/dist/db.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const userId = 'usr_test';
db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run(userId, 'owner@example.com', 'Owner', Date.now());
const addBot = (id, mode) => db.prepare('INSERT INTO bots(id,user_id,name,mode,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, userId, id, mode, Date.now(), Date.now());
addBot('bot_team', 'teammate');
addBot('bot_personal', 'personal');
const bot = (id) => db.prepare('SELECT * FROM bots WHERE id=?').get(id);

test('secrets are caught, ordinary help text is not', () => {
  assert.equal(text.looksSecret('Password: Hunter22!'), 'a password or key');
  assert.equal(text.looksSecret('api_key = sk-live-abcdefghijklmnop1234'), 'an API key');
  assert.equal(text.looksSecret('-----BEGIN RSA PRIVATE KEY-----\nabc'), 'a private key');
  assert.equal(text.looksSecret('token: ghp_abcdefghijklmnopqrstuvwxyz123456'), 'an access token');
  assert.equal(text.looksSecret('Password: reset it in the client area under Security.'), null);
  assert.equal(text.looksSecret('The Business plan costs R79 a month and includes 30 GB.'), null);
});

test('search queries are made safe', () => {
  assert.equal(text.ftsQuery('Refund policy?'), '"refund"* AND "policy"*');
  assert.equal(text.ftsQuery('"); DROP TABLE x; --'), '"drop"* AND "table"*');
  assert.equal(text.ftsQuery('?!'), null);
  assert.deepEqual(text.wikiLinks('See [[Business plan]] and [[Email setup]], again [[Business plan]].'), ['Business plan', 'Email setup']);
});

test('three spaces are created once, then entries are searchable by space', () => {
  const spaces = kn.listSpaces(userId);
  assert.deepEqual(spaces.map((s) => s.kind), ['company', 'customer', 'personal']);
  assert.equal(kn.listSpaces(userId).length, 3);
  const [company, customer] = spaces;
  kn.createEntry(userId, { spaceId: customer.id, title: 'Business plan', body: 'R79 a month. 30 GB, free SSL, 2 email accounts. See [[Email setup]].', by: 'you' });
  kn.createEntry(userId, { spaceId: customer.id, title: 'Email setup', body: 'Use mail.yourdomain.co.za, port 993 for IMAP.', by: 'you' });
  kn.createEntry(userId, { spaceId: company.id, title: 'Supplier costs', body: 'The Business plan costs us R31 a month on the reseller account.', by: 'you' });
  const all = kn.search(userId, null, 'business plan');
  assert.equal(all[0].title, 'Business plan');
  const customerOnly = kn.search(userId, [customer.id], 'reseller costs');
  assert.equal(customerOnly.length, 0, 'internal entries never appear in a Customer-safe search');
  assert.equal(kn.search(userId, [company.id], 'reseller')[0].title, 'Supplier costs');
  const plan = kn.getEntry(userId, all[0].id);
  assert.deepEqual(plan.links.map((l) => l.title), ['Email setup']);
  assert.ok(plan.links[0].id, 'a link to an existing entry resolves to its id');
});

test('changes keep a history that can be restored, and deletion removes everything', () => {
  const [, customer] = kn.listSpaces(userId);
  const e = kn.createEntry(userId, { spaceId: customer.id, title: 'Refunds', body: 'Refunds within 7 days.', by: 'you' });
  const changed = kn.updateEntry(userId, e.id, { body: 'Refunds within 30 days.', by: 'Marvelous' });
  assert.equal(changed.updatedBy, 'Marvelous');
  assert.equal(changed.revisions.length, 1);
  assert.equal(kn.search(userId, null, '30 days')[0].id, e.id);
  const restored = kn.restoreRevision(userId, e.id, changed.revisions[0].id, 'you');
  assert.match(restored.body, /7 days/);
  assert.equal(restored.revisions.length, 2, 'restoring is itself undoable');
  const mirrors = () => fs.readdirSync(path.join(kn.KNOWLEDGE_DIR, 'Customer-safe')).filter((f) => f.endsWith(`-${e.id}.md`));
  assert.equal(mirrors().length, 1, 'each entry is mirrored as one Markdown file');
  assert.ok(kn.deleteEntry(userId, e.id));
  assert.equal(kn.search(userId, null, 'refunds').length, 0);
  assert.equal(mirrors().length, 0);
});

test('uploaded files are stored with the entry and removed with it', () => {
  const [company] = kn.listSpaces(userId);
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const e = kn.createEntry(userId, { spaceId: company.id, title: 'Logo', body: 'Mumatec logo, white on blue', by: 'you', file: { name: 'logo.png', data: png, kind: 'image' } });
  assert.equal(e.kind, 'image');
  const file = kn.entryFile(userId, e.id);
  assert.ok(file && fs.readFileSync(file.path).equals(png));
  assert.equal(kn.search(userId, null, 'logo')[0].id, e.id, 'images are found by their title and description');
  kn.deleteEntry(userId, e.id);
  assert.equal(fs.existsSync(file.path), false);
});

test('only Teammate bots read knowledge, and only the spaces ticked for them', () => {
  const [company, customer, personal] = kn.listSpaces(userId);
  assert.deepEqual(kn.botSpaceIds(bot('bot_personal')), [], 'Personal assistants get no knowledge');
  assert.deepEqual(kn.botSpaceIds(bot('bot_team')), [company.id, customer.id], 'Teammates default to Company and Customer-safe');
  kn.setBotSpaceIds(userId, 'bot_team', [customer.id, personal.id, 'ks_not_mine']);
  assert.deepEqual(kn.botSpaceIds(bot('bot_team')), [customer.id, personal.id]);
  kn.setBotSpaceIds(userId, 'bot_team', []);
  assert.deepEqual(kn.botSpaceIds(bot('bot_team')), [], 'unticking everything means nothing, not the defaults');
});

test("another owner's entries stay invisible", () => {
  db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('usr_other', 'other@example.com', 'Other', Date.now());
  const [theirs] = kn.listSpaces('usr_other');
  kn.createEntry('usr_other', { spaceId: theirs.id, title: 'Their secret plan', body: 'Unicorn pricing', by: 'you' });
  assert.equal(kn.search(userId, null, 'unicorn').length, 0);
  const mine = kn.listSpaces(userId)[0];
  assert.throws(() => kn.createEntry('usr_other', { spaceId: mine.id, title: 'x', body: 'y', by: 'you' }), /No such space/);
});
