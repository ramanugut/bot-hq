import { db, now } from '../db.js';
import { newId } from '../lib/ids.js';
import { hub } from '../lib/hub.js';
import { box } from '../box.js';
import { env } from '../env.js';
import { appendRow, getBotRow, listRoutines, toRoutine, describeCron, isOnceSchedule, userTimezone } from '../store.js';
import { executeComposio, innerToolSlugs, isReadOnlySlug, toolkitInfo } from '../composio.js';
import { scheduleRoutine, unscheduleRoutine } from '../routines.js';
import { createEventRoutine, deleteEventTrigger, describeEvent, listTriggerTypes } from '../triggers.js';
import { setCheckins } from '../proactive.js';
import { createRoom, postToRoom } from './rooms.js';
import type { ActivityKind } from '../types.js';
import { Cron } from 'croner';

export interface ToolCtx {
  userId: string;
  botId: string;
  enqueueBotMessage: (fromBotId: string, toBotId: string, text: string, depth: number) => void;
  depth: number;
}

export interface ToolResult {
  /** Text handed back to the agent. */
  output: string;
  summary?: string;
  /** End the turn after this tool (e.g. a question was asked). */
  endTurn?: boolean;
}

type Impl = (args: any, ctx: ToolCtx) => Promise<ToolResult>;

interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  activity: ActivityKind;
  label: string;
  impl: Impl;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

function botByName(userId: string, name: string) {
  return db.prepare('SELECT * FROM bots WHERE user_id=? AND lower(name)=lower(?)').get(userId, name.trim()) as any;
}

/** Live X research through xAI's search tool. Returns the answer text followed by the posts it cites. */
async function xSearch(a: any): Promise<string> {
  const clean = (v: unknown) => (Array.isArray(v) ? v.map((h) => String(h).replace(/^@/, '').trim()).filter(Boolean).slice(0, 10) : []);
  if (!env.xaiKey) return 'Research on X is off on this install: XAI_API_KEY is not set.';
  const tool: Record<string, unknown> = { type: 'x_search' };
  const only = clean(a.handles);
  const not = clean(a.exclude_handles);
  if (only.length) tool.allowed_x_handles = only;
  else if (not.length) tool.excluded_x_handles = not;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (day.test(String(a.from_date ?? ''))) tool.from_date = a.from_date;
  if (day.test(String(a.to_date ?? ''))) tool.to_date = a.to_date;
  const res = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.xaiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(240_000),
    body: JSON.stringify({
      model: env.xaiModel,
      store: false,
      tools: [tool],
      input: [
        { role: 'system', content: 'You are a research tool used by another AI agent. Search X and answer the question precisely. For each post you rely on give the author handle, the date, engagement numbers when you can see them, and the link. No preamble and no advice.' },
        { role: 'user', content: String(a.query ?? '') },
      ],
    }),
  });
  if (!res.ok) throw new Error(`X search failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  const parts: string[] = [];
  const links = new Set<string>();
  for (const item of data.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (typeof c?.text === 'string') parts.push(c.text);
      for (const an of c?.annotations ?? []) if (an?.url) links.add(String(an.url));
    }
  }
  for (const u of data.citations ?? []) if (typeof u === 'string') links.add(u);
  const text = parts.join('\n\n').trim() || 'No answer came back.';
  const sources = [...links].slice(0, 40);
  return (sources.length ? `${text}\n\nSources:\n${sources.map((u) => `- ${u}`).join('\n')}` : text).slice(0, 60000);
}

/** Where each bot's Library lives on the shared computer. */
export const LIBRARY_ROOT = '/root/grokbot/files';

export const TOOLS: ToolDef[] = [
  {
    name: 'save_file',
    description: "Save a finished deliverable (report, notes, CSV, code, markdown) to your Library so the user can open and download it. Saved under /root/grokbot/files/<your id>/ on your computer. Files you write into that folder yourself show up in the Library too.",
    parameters: obj({ filename: { type: 'string', description: 'e.g. briefing-2026-11-09.md' }, content: { type: 'string' } }, ['filename', 'content']),
    activity: 'drafting_file',
    label: 'Saving a file',
    impl: async (a, ctx) => {
      const name = String(a.filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file.txt';
      const file = `${LIBRARY_ROOT}/${ctx.botId}/${name}`;
      const content = String(a.content ?? '');
      // A bot that passes a file's path as the content means "save that file": copy it rather than write the path.
      const asPath = /^\/\S+$/.test(content.trim()) ? await box.readFile(content.trim()) : null;
      if (asPath && /\.(png|jpe?g|webp|gif)$/i.test(name)) {
        const r = await postImage(ctx.botId, content.trim());
        return { output: r.message, ...(r.ok ? { summary: `Saved ${r.name}` } : {}) };
      }
      await box.writeFile(file, asPath ?? content);
      return { output: JSON.stringify({ ok: true, path: file }), summary: `Saved ${name}` };
    },
  },
  {
    name: 'show_image',
    description: "Show an image in the chat (PNG, JPG, WEBP or GIF). Give the path of an image you made, e.g. one from your image generation tool; it is copied into your Library and appears in the conversation. Call it every time you make an image for the user.",
    parameters: obj({ path: { type: 'string', description: 'Absolute path of the image file on your computer' }, caption: { type: 'string' } }, ['path']),
    activity: 'drafting_file',
    label: 'Sharing an image',
    impl: async (a, ctx) => {
      const r = await postImage(ctx.botId, String(a.path ?? ''), a.caption ? String(a.caption) : undefined);
      return { output: r.message, ...(r.ok ? { summary: `Shared ${r.name}` } : {}) };
    },
  },
  {
    name: 'x_search',
    description: "Research X (Twitter) live: what people are posting about a topic, what is going viral, reactions to news, or one account's recent posts. Returns a written answer with links to the posts. Ask one focused question per call and say what you want back, e.g. \"the 10 most-engaged posts about AI agents from the last 48 hours, with author, likes and link\".",
    parameters: obj({
      query: { type: 'string', description: 'What to find out, in plain words.' },
      handles: { type: 'array', items: { type: 'string' }, description: 'Only search posts from these accounts (without @). Up to 10.' },
      exclude_handles: { type: 'array', items: { type: 'string' }, description: 'Leave out posts from these accounts.' },
      from_date: { type: 'string', description: 'Earliest post date, YYYY-MM-DD.' },
      to_date: { type: 'string', description: 'Latest post date, YYYY-MM-DD.' },
    }, ['query']),
    activity: 'searching_web',
    label: 'Searching X',
    impl: async (a) => {
      const r = await xSearch(a);
      return { output: r, summary: 'Searched X' };
    },
  },
  {
    name: 'create_routine',
    description: 'Schedule a job you will run automatically, recurring or once. The user sees and controls it in the app. Use it whenever the user asks for something later or regularly ("every morning", "remind me at 5", "check this weekly"), and on your own when a task clearly needs a follow-up. `schedule`: a 5-field cron expression (minute hour day-of-month month day-of-week) for repeating jobs, e.g. "0 8 * * 1-5" for weekdays at 8:00; or, for a one-off job, a date-time with offset such as "2026-11-16T17:00:00+02:00". Times are in the user\'s time zone unless you pass another. `prompt` is the full instruction you will follow when it runs (it runs without this conversation in front of you, so include every detail).',
    parameters: obj({ name: { type: 'string' }, prompt: { type: 'string' }, schedule: { type: 'string' }, timezone: { type: 'string', description: "IANA time zone; defaults to the user's" } }, ['name', 'prompt', 'schedule']),
    activity: 'working',
    label: 'Setting up a routine',
    impl: async (a, ctx) => {
      const tz = a.timezone || userTimezone(ctx.userId);
      const sched = String(a.schedule ?? '').trim();
      if (isOnceSchedule(sched)) {
        if (Date.parse(sched) <= Date.now()) return { output: 'That time is already in the past. Pick a future time.' };
      } else {
        try { new Cron(sched, { paused: true, timezone: tz }); } catch (e: any) { return { output: `Invalid schedule: ${e.message}` }; }
        const runs = new Cron(sched, { paused: true, timezone: tz }).nextRuns(3).map((d) => d.getTime());
        if (runs.length >= 2 && runs[1] - runs[0] < 15 * 60_000) return { output: 'That runs more often than every 15 minutes, which would use up the user\'s model allowance. Choose a slower schedule, or ask the user first.' };
      }
      const id = newId('rt');
      db.prepare('INSERT INTO routines(id,bot_id,name,prompt,schedule,timezone,enabled,created_at) VALUES (?,?,?,?,?,?,1,?)').run(id, ctx.botId, a.name, a.prompt, sched, tz, now());
      const r = toRoutine(db.prepare('SELECT * FROM routines WHERE id=?').get(id));
      scheduleRoutine(r);
      appendRow(ctx.botId, 'event', { type: 'event', event: 'routine-created', text: `Routine created: ${a.name} · ${describeCron(sched, tz)}`, ref: id });
      hub.emit(ctx.userId, { type: 'routines', botId: ctx.botId });
      return { output: JSON.stringify({ ok: true, routine: r }), summary: `Created routine ${a.name}` };
    },
  },
  {
    name: 'list_event_triggers',
    description: 'List the event triggers a connected app offers (e.g. new email, new Slack message, new GitHub PR), with each trigger\'s config fields. Use before create_event_routine.',
    parameters: obj({ toolkit: { type: 'string', description: 'Composio toolkit slug, e.g. gmail, slack, github, googlecalendar' } }, ['toolkit']),
    activity: 'connecting_service',
    label: 'Using a connected app',
    impl: async (a) => ({ output: JSON.stringify(await listTriggerTypes(String(a.toolkit).toLowerCase())) }),
  },
  {
    name: 'create_event_routine',
    description: 'Create a routine that runs whenever an event happens in a connected app (instead of on a schedule). `trigger_slug` comes from list_event_triggers; `config_json` is a JSON object string with that trigger\'s config fields (use "{}" if none). `prompt` is what you will do each time, given the event payload.',
    parameters: obj({ name: { type: 'string' }, prompt: { type: 'string' }, trigger_slug: { type: 'string' }, config_json: { type: 'string' } }, ['name', 'prompt', 'trigger_slug']),
    activity: 'working',
    label: 'Setting up a routine',
    impl: async (a, ctx) => {
      let config: Record<string, unknown> = {};
      try { config = a.config_json ? JSON.parse(a.config_json) : {}; } catch { return { output: 'config_json must be a JSON object string.' }; }
      try {
        const r = await createEventRoutine(ctx.userId, ctx.botId, { name: a.name, prompt: a.prompt, trigger_slug: a.trigger_slug, config });
        appendRow(ctx.botId, 'event', { type: 'event', event: 'routine-created', text: `Routine created: ${a.name} · ${describeEvent(`event:${String(a.trigger_slug).toUpperCase()}`)}`, ref: r.id });
        hub.emit(ctx.userId, { type: 'routines', botId: ctx.botId });
        return { output: JSON.stringify({ ok: true, routine_id: r.id }), summary: `Created event routine ${a.name}` };
      } catch (e: any) {
        return { output: `Could not create the trigger: ${e?.message ?? e}. If the app isn't connected, call request_app_connection first.` };
      }
    },
  },
  {
    name: 'stay_silent',
    description: 'End this turn without sending the user anything. Use during check-ins, routines or bot-to-bot exchanges when there is nothing worth telling the user.',
    parameters: obj({ reason: { type: 'string' } }),
    activity: 'working',
    label: 'Finishing up',
    impl: async () => ({ output: 'OK, staying silent. End your turn now without writing a reply.', endTurn: true, summary: 'Stayed silent' }),
  },
  {
    name: 'set_checkins',
    description: "Turn proactive check-ins on or off and set when they happen (only the primary Bot does check-ins). times are local 24h 'HH:MM' strings; timezone is IANA (e.g. America/Los_Angeles). Ask the user for their timezone if you don't know it.",
    parameters: obj({ enabled: { type: 'boolean' }, times: { type: 'array', items: { type: 'string' } }, timezone: { type: 'string' } }, ['enabled']),
    activity: 'working',
    label: 'Updating check-ins',
    impl: async (a, ctx) => {
      try {
        const r = setCheckins(ctx.userId, { enabled: !!a.enabled, times: a.times, timezone: a.timezone });
        return { output: JSON.stringify({ ok: true, ...r }), summary: r.enabled ? `Check-ins at ${r.times.join(', ')} ${r.timezone}` : 'Check-ins off' };
      } catch (e: any) {
        return { output: `Could not update check-ins: ${e?.message ?? e}` };
      }
    },
  },
  {
    name: 'list_routines',
    description: 'List your routines.',
    parameters: obj({}),
    activity: 'working',
    label: 'Checking routines',
    impl: async (_a, ctx) => ({ output: JSON.stringify(listRoutines(ctx.botId)) }),
  },
  {
    name: 'update_routine',
    description: 'Change or pause one of your routines.',
    parameters: obj({ routine_id: { type: 'string' }, name: { type: 'string' }, prompt: { type: 'string' }, schedule: { type: 'string' }, timezone: { type: 'string' }, enabled: { type: 'boolean' } }, ['routine_id']),
    activity: 'working',
    label: 'Updating a routine',
    impl: async (a, ctx) => {
      const cur = db.prepare('SELECT * FROM routines WHERE id=? AND bot_id=?').get(a.routine_id, ctx.botId) as any;
      if (!cur) return { output: 'No such routine.' };
      const next = { ...cur, name: a.name ?? cur.name, prompt: a.prompt ?? cur.prompt, schedule: a.schedule ?? cur.schedule, timezone: a.timezone ?? cur.timezone, enabled: a.enabled === undefined ? cur.enabled : a.enabled ? 1 : 0 };
      if (!isOnceSchedule(next.schedule)) { try { new Cron(next.schedule, { paused: true, timezone: next.timezone }); } catch (e: any) { return { output: `Invalid schedule: ${e.message}` }; } }
      db.prepare('UPDATE routines SET name=?,prompt=?,schedule=?,timezone=?,enabled=? WHERE id=?').run(next.name, next.prompt, next.schedule, next.timezone, next.enabled, cur.id);
      const r = toRoutine(db.prepare('SELECT * FROM routines WHERE id=?').get(cur.id));
      r.enabled ? scheduleRoutine(r) : unscheduleRoutine(r.id);
      appendRow(ctx.botId, 'event', { type: 'event', event: 'routine-updated', text: `Routine updated: ${r.name} · ${r.enabled ? r.description : 'Paused'}`, ref: r.id });
      hub.emit(ctx.userId, { type: 'routines', botId: ctx.botId });
      return { output: JSON.stringify({ ok: true, routine: r }) };
    },
  },
  {
    name: 'delete_routine',
    description: 'Delete one of your routines.',
    parameters: obj({ routine_id: { type: 'string' } }, ['routine_id']),
    activity: 'working',
    label: 'Removing a routine',
    impl: async (a, ctx) => {
      unscheduleRoutine(a.routine_id);
      await deleteEventTrigger(a.routine_id);
      db.prepare('DELETE FROM routines WHERE id=? AND bot_id=?').run(a.routine_id, ctx.botId);
      hub.emit(ctx.userId, { type: 'routines', botId: ctx.botId });
      return { output: 'Deleted.' };
    },
  },
  {
    name: 'create_task',
    description: 'Track a piece of work the user asked for as a task (use one per request when asked for several things at once).',
    parameters: obj({ title: { type: 'string' } }, ['title']),
    activity: 'working',
    label: 'Making a task',
    impl: async (a, ctx) => {
      const id = newId('task');
      db.prepare("INSERT INTO tasks(id,bot_id,title,state,created_at,updated_at) VALUES (?,?,?,'working',?,?)").run(id, ctx.botId, a.title, now(), now());
      hub.emit(ctx.userId, { type: 'tasks', botId: ctx.botId });
      return { output: JSON.stringify({ task_id: id }) };
    },
  },
  {
    name: 'update_task',
    description: 'Update a task: state is working, needs_input, or done.',
    parameters: obj({ task_id: { type: 'string' }, state: { type: 'string', enum: ['working', 'needs_input', 'done'] }, note: { type: 'string' } }, ['task_id', 'state']),
    activity: 'working',
    label: 'Updating a task',
    impl: async (a, ctx) => {
      db.prepare('UPDATE tasks SET state=?, note=COALESCE(?, note), updated_at=? WHERE id=? AND bot_id=?').run(a.state, a.note ?? null, now(), a.task_id, ctx.botId);
      hub.emit(ctx.userId, { type: 'tasks', botId: ctx.botId });
      return { output: 'Updated.' };
    },
  },
  {
    name: 'send_to_bot',
    description: "Send a message to another Bot on the user's team (by name) to delegate work or ask a question. Their reply will arrive later as a new message to you.",
    parameters: obj({ bot_name: { type: 'string' }, message: { type: 'string' } }, ['bot_name', 'message']),
    activity: 'messaging_named',
    label: 'Messaging a Bot',
    impl: async (a, ctx) => {
      const target = botByName(ctx.userId, a.bot_name);
      if (!target) return { output: `No bot named "${a.bot_name}". Team: ${(db.prepare('SELECT name FROM bots WHERE user_id=?').all(ctx.userId) as any[]).map((b) => b.name).join(', ')}` };
      if (target.id === ctx.botId) return { output: 'That is you.' };
      if (target.kind === 'room') return { output: `"${target.name}" is a group chat; use post_to_group instead.` };
      if (ctx.depth >= 3) return { output: 'Too many hops between bots; answer the user directly instead.' };
      ctx.enqueueBotMessage(ctx.botId, target.id, String(a.message), ctx.depth + 1);
      return { output: `Sent to ${target.name}. Their reply will come back to you as a message.`, summary: `Messaged ${target.name}` };
    },
  },
  {
    name: 'create_group',
    description: "Create a group chat between the user and several Bots on the team (by name). It appears in the user's sidebar; when the user posts there, the relevant Bots answer.",
    parameters: obj({ name: { type: 'string' }, bot_names: { type: 'array', items: { type: 'string' } } }, ['name', 'bot_names']),
    activity: 'working',
    label: 'Setting up a group',
    impl: async (a, ctx) => {
      const ids: string[] = [];
      const missing: string[] = [];
      for (const n of (a.bot_names ?? []) as string[]) {
        const b = botByName(ctx.userId, n);
        if (b && b.kind !== 'room') ids.push(b.id); else missing.push(n);
      }
      if (ids.length < 2) return { output: `A group needs at least 2 Bots. Not found: ${missing.join(', ') || 'none'}.` };
      const id = createRoom(ctx.userId, String(a.name), [...new Set(ids)]);
      appendRow(id, 'event', { type: 'event', event: 'bot-message', text: `Group created with ${(a.bot_names as string[]).filter((n) => !missing.includes(n)).join(', ')}` });
      return { output: JSON.stringify({ ok: true, group_id: id, missing }), summary: `Created group ${a.name}` };
    },
  },
  {
    name: 'post_to_group',
    description: 'Post a message into a group chat you are a member of.',
    parameters: obj({ group_name: { type: 'string' }, text: { type: 'string' } }, ['group_name', 'text']),
    activity: 'messaging_named',
    label: 'Posting to the group',
    impl: async (a, ctx) => {
      const out = postToRoom(ctx.botId, String(a.group_name), String(a.text));
      return { output: out, summary: `Posted to ${a.group_name}`, endTurn: out === 'Posted to the group.' };
    },
  },
  {
    name: 'create_bot',
    description: "Create a new Bot on the user's team (it gets its own screen and browser). Only when the user asks for a new bot. First call it without confirmed: that shows the user a Yes/No card and ends your turn. Call it again with confirmed=true only after the user answered Yes.",
    parameters: obj({
      name: { type: 'string', description: 'Short first name, e.g. Mia' },
      job: { type: 'string', description: 'One-line role, e.g. Social media manager' },
      instructions: { type: 'string', description: 'How this bot should work, in the user\'s words where possible' },
      confirmed: { type: 'boolean', description: 'true only after the user said Yes on the card' },
    }, ['name', 'job', 'instructions', 'confirmed']),
    activity: 'working',
    label: 'Setting up a new Bot',
    impl: async (a, ctx) => {
      const name = String(a.name ?? '').trim().slice(0, 60);
      if (!name) return { output: 'A bot needs a name.' };
      if (botByName(ctx.userId, name)) return { output: `There is already a bot called ${name}. Pick another name.` };
      if (a.confirmed !== true) {
        appendRow(ctx.botId, 'card', { type: 'card', card: 'question', question: `Create a new bot "${name}" (${String(a.job ?? '').slice(0, 80)})?`, options: ['Yes, create it', 'No'], status: 'pending' });
        return { output: 'Asked the user to confirm. Stop here; if they answer Yes, call create_bot again with the same details and confirmed=true.', endTurn: true };
      }
      try {
        const { createBot } = await import('../routes.js');
        const b = createBot(ctx.userId, { name, label: String(a.job ?? '').slice(0, 60), description: String(a.job ?? ''), instructions: String(a.instructions ?? '') });
        return { output: `Created ${b.name}. It is starting its own agent and screen; you can message it with send_to_bot in a minute.`, summary: `Created ${b.name}` };
      } catch (e: any) {
        return { output: `Could not create the bot: ${e?.message ?? e}` };
      }
    },
  },
  {
    name: 'ask_user',
    description: 'Ask the user a multiple-choice question when you need a decision before continuing. Ends your turn; their answer arrives as their next message.',
    parameters: obj({ question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, ['question', 'options']),
    activity: 'waiting_for_you',
    label: 'Waiting on you',
    impl: async (a, ctx) => {
      appendRow(ctx.botId, 'card', { type: 'card', card: 'question', question: a.question, options: (a.options ?? []).slice(0, 6), status: 'pending' });
      return { output: 'Question shown to the user. Stop here and wait for their answer.', endTurn: true };
    },
  },
  {
    name: 'request_app_connection',
    description: 'Ask the user to connect an app (e.g. gmail, googlecalendar, slack, github, notion, linear) so you can use it. Use the Composio toolkit slug.',
    parameters: obj({ toolkit: { type: 'string' }, reason: { type: 'string' } }, ['toolkit', 'reason']),
    activity: 'connecting_service',
    label: 'Using a connected app',
    impl: async (a, ctx) => {
      const info = await toolkitInfo(String(a.toolkit).toLowerCase());
      if (!info) return { output: `Unknown toolkit "${a.toolkit}". Use COMPOSIO_SEARCH_TOOLS to find the right toolkit slug.` };
      appendRow(ctx.botId, 'card', { type: 'card', card: 'connect', toolkit: info.slug, toolkitName: info.name, logo: info.logo, reason: a.reason, status: 'pending' });
      return { output: `Asked the user to connect ${info.name}. Stop here; you'll be told when it's connected.`, endTurn: true };
    },
  },
];

/**
 * Put an image into the chat: copy it into the bot's Library and add an image card.
 * Refuses files that are not real images, so a bot cannot report a picture it never made.
 */
export async function postImage(botId: string, src: string, caption?: string): Promise<{ ok: boolean; message: string; name?: string }> {
  const ext = (src.split('.').pop() ?? '').toLowerCase();
  if (!['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return { ok: false, message: 'Only PNG, JPG, WEBP or GIF can be shown. Convert the image first.' };
  const data = await box.readFile(src);
  if (!data) return { ok: false, message: `No file at ${src}.` };
  const magic = data.subarray(0, 12);
  const isImage = (magic[0] === 0x89 && magic[1] === 0x50) || (magic[0] === 0xff && magic[1] === 0xd8) || magic.subarray(0, 4).toString() === 'RIFF' || magic.subarray(0, 3).toString() === 'GIF';
  const pngTiny = magic[0] === 0x89 && data.length >= 24 && (data.readUInt32BE(16) < 64 || data.readUInt32BE(20) < 64);
  if (!isImage || pngTiny) return { ok: false, message: `${src} is not a real image (${data.length} bytes). Do not claim it was made; generate it again.` };
  const name = (src.split('/').pop() ?? `image.${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const dest = `${LIBRARY_ROOT}/${botId}/${name}`;
  if (dest !== src) await box.writeFile(dest, data);
  appendRow(botId, 'card', { type: 'card', card: 'image', path: name, ...(caption ? { caption: caption.slice(0, 300) } : {}) });
  return { ok: true, message: `Shown in the chat and saved to the Library as ${name}.`, name };
}

/** Hermes marks files for the person with lines like "MEDIA:/path/to/file.png". Split those out of a reply. */
export function splitMedia(text: string): { text: string; paths: string[] } {
  const paths: string[] = [];
  const kept = text.split('\n').filter((line) => {
    const m = /^\s*MEDIA:\s*(\/\S+)\s*$/.exec(line);
    if (m) paths.push(m[1]);
    return !m;
  });
  return { text: kept.join('\n'), paths };
}

export const toolMap = new Map(TOOLS.map((t) => [t.name, t]));

// ---------- approvals policy ----------

export type Decision = 'allow' | 'ask' | 'block';

export function policyFor(userId: string, toolName: string, args: any): { decision: Decision; key: string; toolkit?: string; title: string } {
  if (toolMap.has(toolName)) return { decision: 'allow', key: toolName, title: toolName };
  const slugs = innerToolSlugs(toolName, args);
  if (!slugs.length) {
    // Composio's sandbox can run app actions from code, which would slip past the per-action
    // approvals below. Code that reaches for them is treated like a write to an app.
    if (/^COMPOSIO_REMOTE_(WORKBENCH|BASH_TOOL)$/.test(toolName) && /run_composio_tool|proxy_execute|execute_tool|composio/i.test(JSON.stringify(args ?? {}))) {
      const p = db.prepare('SELECT mode FROM policies WHERE user_id=? AND tool=?').get(userId, toolName) as any;
      const mode = p?.mode ?? 'needs_approval';
      return { decision: mode === 'blocked' ? 'block' : mode === 'always_allow' ? 'allow' : 'ask', key: toolName, title: 'Run code that uses your connected apps' };
    }
    return { decision: 'allow', key: toolName, title: toolName };
  }
  let decision: Decision = 'allow';
  let key = slugs[0];
  for (const slug of slugs) {
    const p = db.prepare('SELECT mode FROM policies WHERE user_id=? AND tool=?').get(userId, slug) as any;
    const mode = p?.mode ?? (isReadOnlySlug(slug) ? 'always_allow' : 'needs_approval');
    if (mode === 'blocked') return { decision: 'block', key: slug, title: humanizeSlug(slug) };
    if (mode === 'needs_approval') { decision = 'ask'; key = slug; }
  }
  return { decision, key, toolkit: key.split('_')[0].toLowerCase(), title: humanizeSlug(key) };
}

export function humanizeSlug(slug: string) {
  const parts = slug.split('_');
  const app = parts.shift() ?? '';
  return `${app.charAt(0) + app.slice(1).toLowerCase()}: ${parts.join(' ').toLowerCase()}`;
}

export async function runComposioTool(ctx: ToolCtx, name: string, args: any): Promise<ToolResult> {
  const r = await executeComposio(ctx.userId, name, args);
  const ok = r.resultType ? r.resultType === 'completed' : !r.error;
  const payload = ok ? r.data : { error: r.error, logId: r.logId };
  let out = JSON.stringify(payload ?? null);
  if (out.length > 60000) out = out.slice(0, 60000) + '…(truncated)';
  return { output: out, summary: ok ? 'done' : 'failed' };
}

/** A Hermes tool name as the app knows it: tools served by this app's MCP server lose their `mcp_hq_` prefix. */
export function appToolName(raw: string): { name: string; ours: boolean; server?: string } {
  const hq = /^mcp_+hq_+(.+)$/.exec(raw);
  if (hq) {
    // Hermes may fold names to lower case; ours are matched case-insensitively.
    const hit = [...toolMap.keys()].find((k) => k.toLowerCase() === hq[1].toLowerCase());
    return { name: hit ?? (/^composio_/i.test(hq[1]) ? hq[1].toUpperCase() : hq[1]), ours: true };
  }
  const other = /^mcp_+([a-zA-Z0-9-]+?)_+(.+)$/.exec(raw);
  if (other) return { name: other[2], ours: false, server: other[1] };
  return { name: raw, ours: false };
}

const words = (s: string) => s.replace(/[_-]+/g, ' ').trim();
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What to show while a tool runs. `raw` is the name Hermes reports. */
export function activityFor(raw: string): { kind: ActivityKind; label: string; detail?: string } {
  const { name, ours, server } = appToolName(raw);
  if (ours) {
    const t = toolMap.get(name);
    if (t) return { kind: t.activity, label: t.label, ...(name === 'x_search' ? { detail: 'X' } : {}) };
    return { kind: 'connecting_service', label: 'Using a connected app' };
  }
  if (server) return { kind: 'connecting_service', label: `Using ${words(server)}`, detail: sentence(words(server)) };
  if (name === 'terminal' || name === 'process' || name === 'execute_code') return { kind: 'running_commands', label: 'Running commands' };
  if (name === 'write_file' || name === 'patch') return { kind: 'drafting_file', label: 'Writing a file' };
  if (name === 'read_file' || name === 'search_files') return { kind: 'working', label: 'Reading files' };
  if (name === 'web_search') return { kind: 'searching_web', label: 'Searching the web' };
  if (name === 'web_extract') return { kind: 'reading_web', label: 'Reading a page' };
  if (name === 'x_search') return { kind: 'searching_web', label: 'Searching X', detail: 'X' };
  if (name.startsWith('browser_')) return { kind: 'browsing_web', label: 'Browsing a site' };
  if (name === 'computer_use') return { kind: 'on_its_computer', label: 'Using its computer' };
  if (name === 'vision_analyze') return { kind: 'working', label: 'Looking at an image' };
  if (name === 'memory') return { kind: 'remembering', label: 'Saving notes' };
  if (name === 'session_search') return { kind: 'remembering', label: 'Searching memory' };
  if (name === 'todo') return { kind: 'working', label: 'Planning' };
  if (name === 'delegate_task') return { kind: 'working', label: 'Handing off work' };
  if (name === 'send_message') return { kind: 'messaging_named', label: 'Sending a message' };
  if (name.startsWith('skill')) return { kind: 'working', label: 'Using a skill' };
  if (name === 'clarify') return { kind: 'waiting_for_you', label: 'Waiting on you' };
  if (name === 'cronjob') return { kind: 'working', label: 'Scheduling' };
  return { kind: 'working', label: sentence(words(name)) || 'Working' };
}

export function getBotName(botId: string) {
  return getBotRow(botId)?.name ?? 'Bot';
}
