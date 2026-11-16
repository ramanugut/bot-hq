import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import { env } from './env.js';
import { api } from './routes.js';
import { attachVncRelay } from './vnc.js';
import { initRoutines } from './routines.js';
import { initTriggers } from './triggers.js';
import { initProactive } from './proactive.js';
import { initSubagents } from './agent/subagents.js';
import { initRooms } from './agent/rooms.js';
import { checkinsApi } from './routes-proactive.js';
import { roomsApi } from './routes-rooms.js';
import { knowledgeApi } from './routes-knowledge.js';
import { enqueue, expireStaleApprovals, isBotBusy } from './agent/loop.js';
import { initHeartbeat } from './heartbeat.js';
import { startScreenSleeper } from './computer.js';
import { desSelfTest } from './lib/des.js';
import { configApi } from './routes-config.js';
import { startIdleWatcher } from './idle.js';
import { mcpApi } from './mcp.js';
import { initEngines } from './engine.js';

if (!desSelfTest()) throw new Error('DES self-test failed');
initSubagents();
initRooms();
// Approvals wait in memory; whatever was still open when the last process stopped can no longer be answered.
expireStaleApprovals();

const app = new Hono();
app.get('/api/health', (c) => c.json({ ok: true, engine: 'hermes' }));
// The app's tools for the agent engines (MCP).
app.route('/mcp', mcpApi);
app.route('/api/checkins', checkinsApi);
app.route('/api/rooms', roomsApi);
app.route('/api/knowledge', knowledgeApi);
app.route('/api', api);
app.route('/api', configApi);

// Serve the built web app in production.
const webDist = path.resolve(new URL('.', import.meta.url).pathname, '../../web/dist');
if (fs.existsSync(webDist)) {
  // Build files have content hashes in their names, so browsers may keep them for a year; everything else is
  // checked on each visit. The build writes .br/.gz copies, sent to browsers that accept them.
  app.use('/*', serveStatic({
    root: path.relative(process.cwd(), webDist),
    precompressed: true,
    onFound: (file, c) => { c.header('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache'); },
  }));
  const indexHtml = fs.readFileSync(path.join(webDist, 'index.html'), 'utf8');
  app.get('*', (c) => { c.header('Cache-Control', 'no-cache'); return c.html(indexHtml); });
}

const server = serve({ fetch: app.fetch, port: env.port }, (info) => console.log(`[botly] server on http://localhost:${info.port}`));
attachVncRelay(server as unknown as Server);
// BOTLY_NO_SCHEDULER=1 for extra dev/test servers sharing a database copy, so routines and triggers don't fire twice.
if ((process.env.BOTLY_NO_SCHEDULER ?? process.env.GROKBOT_NO_SCHEDULER) !== '1') {
  initRoutines(enqueue);
  void initTriggers(enqueue);
  initProactive(enqueue);
  initHeartbeat(enqueue, isBotBusy);
} else console.log('[botly] scheduler disabled (BOTLY_NO_SCHEDULER=1)');
startIdleWatcher();
startScreenSleeper(isBotBusy);
initEngines();
