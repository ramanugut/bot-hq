import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { restrictManagedProfile, RESTRICTED_API_TOOLSETS, isRestrictedToolsetSafe } from '../server/dist/security/restricted-profile.js';
import { agentUsername, assertSafeAgentFile, requireAgentIdentity } from '../server/dist/security/agent-identity.js';
import { publicBrowserUrl } from '../server/dist/security/browser-control.js';
import { runApprovedCommand } from '../server/dist/security/approved-shell.js';

test('Hermes restricted profile never expands the powerful api-server composite', () => {
  const config = {
    platform_toolsets: { api_server: ['hermes-api-server', 'browser', 'terminal'] },
    agent: { reasoning_effort: 'medium', disabled_toolsets: ['custom-disabled'] },
    mcp_servers: { botly: { url: 'http://127.0.0.1:8787/mcp/bot' }, dangerous: { url: 'http://elsewhere' } },
    terminal: { cwd: '/root' },
    browser: { cdp_url: 'http://127.0.0.1:9299' },
  };
  restrictManagedProfile(config);
  assert.deepEqual(config.platform_toolsets.api_server, [...RESTRICTED_API_TOOLSETS]);
  assert.equal(isRestrictedToolsetSafe(config.platform_toolsets.api_server), true);
  assert.equal(config.agent.disabled_toolsets.includes('terminal'), true);
  assert.equal(config.agent.disabled_toolsets.includes('browser'), true);
  assert.equal(config.agent.disabled_toolsets.includes('code_execution'), true);
  assert.deepEqual(Object.keys(config.mcp_servers), ['botly']);
  assert.equal('terminal' in config, false);
  assert.equal('browser' in config, false);
  assert.equal(config.agent.reasoning_effort, 'medium');
  assert.equal(config.agent.disabled_toolsets.includes('custom-disabled'), true);
});

test('Missing Botly MCP cannot silently leave a restricted agent with other tools', () => {
  assert.throws(() => restrictManagedProfile({ mcp_servers: { unrelated: {} } }), /no Botly MCP/);
});

test('Agent usernames are stable and reject unsafe path components', () => {
  const a = agentUsername('bot_123');
  const b = agentUsername('bot_123');
  assert.equal(a, b);
  assert.match(a, /^botly_[a-f0-9]{16}$/);
  assert.notEqual(a, agentUsername('bot_456'));
  assert.throws(() => agentUsername('../root'));
});

test('File guard prevents writes through directory symlinks and outside the home', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'botly-agent-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'agent');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(home);
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(home, 'safe'));
  assert.doesNotThrow(() => assertSafeAgentFile(path.join(home, 'safe', 'note.txt'), home));
  assert.throws(() => assertSafeAgentFile(outside, home));
  fs.symlinkSync(outside, path.join(home, 'escape'));
  assert.throws(() => assertSafeAgentFile(path.join(home, 'escape', 'note.txt'), home), /symlink/);
});

test('Restricted shell refuses to run without a pre-provisioned bot user', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'botly-unprovisioned-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  assert.throws(() => requireAgentIdentity('bot_missing', path.join(base, 'bot_missing')));
  await assert.rejects(runApprovedCommand('bot_missing', base, 'whoami'), /user is missing/);
});

test('Browser URL check blocks obvious internal and credential-bearing targets', () => {
  assert.equal(publicBrowserUrl('https://example.com/path'), 'https://example.com/path');
  for (const url of ['http://localhost:8888', 'http://127.0.0.1', 'http://10.0.0.4',
    'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'https://a.local',
    'https://someone:password@example.com', 'file:///etc/passwd']) {
    assert.throws(() => publicBrowserUrl(url), url);
  }
});
