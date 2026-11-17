import { Hono } from 'hono';
import { requireUser, type AuthVars } from './lib/auth.js';
import { env } from './env.js';
import {
  agentBots, createConnector, deleteConnector, getConnector, importExistingConnectors, listConnectors, probeConnector,
  probeHeaders, saveTestResult, savedHeaders, updateConnector, urlForTest, viewOf, type ConnectorInput,
} from './connections.js';
import { applyConnectorChange, snapshot } from './connections-apply.js';

/**
 * Settings → Connectors: outside MCP servers for the bots (see connections.ts).
 * Anyone signed in can look; only the owner can add, change, test or remove one, because a connector
 * can carry a key and reaches every bot it is given to.
 */
export const connectorsApi = new Hono<AuthVars>();
connectorsApi.use('/connectors', requireUser);
connectorsApi.use('/connectors/*', requireUser);

const isOwner = (email: string) => !env.ownerEmail || email.toLowerCase() === env.ownerEmail;

connectorsApi.get('/connectors', (c) => {
  importExistingConnectors();
  return c.json({ connectors: listConnectors(), bots: agentBots(c.get('user').id), canEdit: isOwner(c.get('user').email) });
});

const body = async (c: any): Promise<ConnectorInput & { test?: boolean }> => c.req.json().catch(() => ({}));

connectorsApi.post('/connectors', async (c) => {
  if (!isOwner(c.get('user').email)) return c.json({ error: 'Only the owner can add connectors.' }, 403);
  const p = await body(c);
  const before = snapshot();
  const row = createConnector(p);
  if (typeof row === 'string') return c.json({ error: row }, 400);
  saveTestResult(row.id, await probeConnector(row.url, savedHeaders(row)));
  const applied = await applyConnectorChange(before);
  return c.json({ connector: viewOf(getConnector(row.id)), applied });
});

connectorsApi.patch('/connectors/:id', async (c) => {
  if (!isOwner(c.get('user').email)) return c.json({ error: 'Only the owner can change connectors.' }, 403);
  const id = c.req.param('id');
  if (!getConnector(id)) return c.json({ error: 'not found' }, 404);
  const p = await body(c);
  const before = snapshot();
  const row = updateConnector(id, p);
  if (typeof row === 'string') return c.json({ error: row }, 400);
  if (!row.last_test_at && row.enabled) saveTestResult(id, await probeConnector(row.url, savedHeaders(row)));
  const applied = await applyConnectorChange(before);
  return c.json({ connector: viewOf(getConnector(id)), applied });
});

connectorsApi.delete('/connectors/:id', async (c) => {
  if (!isOwner(c.get('user').email)) return c.json({ error: 'Only the owner can remove connectors.' }, 403);
  const id = c.req.param('id');
  if (!getConnector(id)) return c.json({ error: 'not found' }, 404);
  const before = snapshot();
  deleteConnector(id);
  const applied = await applyConnectorChange(before);
  return c.json({ ok: true, applied });
});

/** Test a saved connector as it is. */
connectorsApi.post('/connectors/:id/test', async (c) => {
  if (!isOwner(c.get('user').email)) return c.json({ error: 'Only the owner can test connectors.' }, 403);
  const row = getConnector(c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  saveTestResult(row.id, await probeConnector(row.url, savedHeaders(row)));
  return c.json({ connector: viewOf(getConnector(row.id)) });
});

/** Test before saving: an address and key typed into the form (for an edit, blanks mean "the saved one"). */
connectorsApi.post('/connectors/test', async (c) => {
  if (!isOwner(c.get('user').email)) return c.json({ error: 'Only the owner can test connectors.' }, 403);
  const p = (await body(c)) as ConnectorInput & { id?: string };
  const cur = p.id ? getConnector(p.id) : undefined;
  const url = urlForTest(p.url, cur);
  if (!url) return c.json({ error: 'Paste the server’s address, starting with https://' }, 400);
  const headers = probeHeaders(p.auth, cur);
  if (typeof headers === 'string') return c.json({ error: headers }, 400);
  const r = await probeConnector(url, headers);
  return c.json({ ok: r.ok, error: r.ok ? null : r.error, tools: r.tools, serverName: r.serverName ?? null });
});
