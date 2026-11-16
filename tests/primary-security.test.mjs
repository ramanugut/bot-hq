import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { xauthorityFor, isSecureXvfbCommand, createScreenAuthority } from '../server/dist/security/x11-auth.js';
import { listeningUid } from '../server/dist/security/primary-runtime.js';

test('X11 authorization path is stable; arbitrary displays are rejected', () => {
  assert.equal(xauthorityFor('/root/secure', 99), '/root/secure/xauthority-99');
  assert.throws(() => xauthorityFor('/root/secure', -1));
  assert.throws(() => xauthorityFor('/root/secure', 0));
  assert.throws(() => xauthorityFor('/root/secure', 70000));
});

test('Xvfb checks require -auth and forbid -ac', () => {
  const auth = '/opt/botly/data/screens/xauthority-99';
  assert.equal(isSecureXvfbCommand('/usr/bin/Xvfb :99 -screen 0 1280x800x24 -nolisten tcp -auth ' + auth, 99, auth), true);
  assert.equal(isSecureXvfbCommand('Xvfb :99 -screen 0 1280x800x24 -nolisten tcp -ac', 99, auth), false);
  assert.equal(isSecureXvfbCommand('Xvfb :100 -nolisten tcp -auth ' + auth, 99, auth), false);
  assert.equal(isSecureXvfbCommand('Xvfb :99 -nolisten tcp -auth /tmp/untrusted', 99, auth), false);
});

test('Xauthority creation is supported only in root-private directories', (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'botly-xauth-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.chmodSync(folder, 0o755);
  assert.throws(() => createScreenAuthority(folder, 199), /root-owned and private/);
  if (process.geteuid?.() !== 0) return;
  fs.chmodSync(folder, 0o700);
  try {
    execFileSync('xauth', ['-V'], { stdio: 'ignore' });
  } catch {
    t.skip('xauth is not installed');
    return;
  }
  const a = createScreenAuthority(folder, 199);
  assert.ok(fs.existsSync(a));
  assert.equal(fs.statSync(a).mode & 0o077, 0);
  assert.equal(createScreenAuthority(folder, 199), a);
});

test('Linux TCP listener guard locates the process effective UID', async (t) => {
  if (!fs.existsSync('/proc/net/tcp')) { t.skip('Linux /proc required'); return; }
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  assert.equal(listeningUid(port), process.geteuid());
});

test('Offline primary migrator preserves model config but removes privileged tools', () => {
  const py = String.raw`
import importlib.util
spec = importlib.util.spec_from_file_location('security_primary', 'scripts/security-primary-cutover.py')
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
conf = {'model': {'provider':'openai-codex'}, 'platform_toolsets': {'api_server':['hermes-api-server']},
        'mcp_servers': {'botly':{'url':'http://127.0.0.1:8787/mcp/primary'}, 'other':{'url':'https://example.org'}}}
got = mod.restrict_profile(conf)
assert got['platform_toolsets']['api_server'] == mod.ALLOW
assert 'terminal' in got['agent']['disabled_toolsets']
assert list(got['mcp_servers']) == ['botly']
assert got['model']['provider'] == 'openai-codex'
env = mod.change_env('SESSION_SECRET=redacted\nHERMES_HOME_PRIMARY=/root/.hermes\n')
assert 'HERMES_HOME_PRIMARY=/opt/botly/primary' in env
assert 'BOTLY_PRIMARY_SECURITY_MODE=restricted' in env
sup = mod.change_supervisor('[program:botly-hermes]\ncommand=/root/.local/bin/hermes gateway\n', '/opt/botly/hermes/bin/hermes')
assert 'user=botly_primary' in sup and '/root/.local/bin/hermes' not in sup
`;
  execFileSync('python3', ['-c', py], { timeout: 5000, stdio: 'pipe' });
});
