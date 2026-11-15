import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeLibraryReadPath } from '../server/dist/lib/library-path.js';

test('documents cannot escape their bot Library', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'botly-guard-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const one = path.join(base, 'bot_alpha');
  const two = path.join(base, 'bot_beta');
  fs.mkdirSync(one);
  fs.mkdirSync(two);
  fs.writeFileSync(path.join(one, 'allowed.txt'), 'ok');
  fs.writeFileSync(path.join(two, 'private.txt'), 'secret');
  assert.equal(safeLibraryReadPath(base, 'bot_alpha', 'allowed.txt'), path.join(one, 'allowed.txt'));
  assert.equal(safeLibraryReadPath(base, 'bot_alpha', path.join(one, 'allowed.txt')), path.join(one, 'allowed.txt'));
  assert.throws(() => safeLibraryReadPath(base, 'bot_alpha', '../bot_beta/private.txt'));
  assert.throws(() => safeLibraryReadPath(base, 'bot_alpha', path.join(two, 'private.txt')));
  assert.throws(() => safeLibraryReadPath(base, 'bot_alpha', '/etc/passwd'));
  assert.throws(() => safeLibraryReadPath(base, '../bot_beta', 'private.txt'));
  fs.symlinkSync(path.join(two, 'private.txt'), path.join(one, 'escape.txt'));
  assert.throws(() => safeLibraryReadPath(base, 'bot_alpha', 'escape.txt'));
  fs.mkdirSync(path.join(one, 'folder'));
  assert.throws(() => safeLibraryReadPath(base, 'bot_alpha', 'folder'));
});
