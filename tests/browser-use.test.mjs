import test from 'node:test';
import assert from 'node:assert/strict';
import { managedApiToolsets } from '../server/dist/browser-use-toolsets.js';

test('preserves existing managed-bot toolsets without Browser Use opt-in', () => {
  const input = ['web', 'file', 'browser'];
  assert.deepEqual(managedApiToolsets(input, false, false), ['web', 'file', 'browser', 'hermes-api-server']);
  assert.deepEqual(input, ['web', 'file', 'browser']);
});

test('adds browser and terminal together only when explicitly opted in', () => {
  const off = managedApiToolsets(['hermes-api-server'], true, false);
  assert.deepEqual(off, ['hermes-api-server', 'computer_use']);
  const on = managedApiToolsets(['hermes-api-server'], true, true);
  assert.deepEqual(on, ['hermes-api-server', 'computer_use', 'terminal', 'browser']);
});

test('deduplicates and tolerates missing/invalid settings', () => {
  assert.deepEqual(managedApiToolsets(null, false, true), ['hermes-api-server', 'terminal', 'browser']);
  assert.deepEqual(managedApiToolsets(['browser', 'terminal', 'browser', '', null], true, true),
    ['browser', 'terminal', 'hermes-api-server', 'computer_use']);
});
