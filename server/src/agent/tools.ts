import { db, now } from '../db.js';
import { newId } from '../lib/ids.js';
import { hub } from '../lib/hub.js';
import { box } from '../box.js';
import { env } from '../env.js';
import { notifyBot } from '../push.js';
import { appendRow, getBotRow, listRoutines, toRoutine, describeCron, isOnceSchedule, userTimezone } from '../store.js';
import { executeComposio, innerToolSlugs, isReadOnlySlug, toolkitInfo } from '../composio.js';
import { scheduleRoutine, unscheduleRoutine } from '../routines.js';
import { createEventRoutine, deleteEventTrigger, describeEvent, listTriggerTypes } from '../triggers.js';
import { setCheckins } from '../proactive.js';
import { createRoom, postToRoom } from './rooms.js';
import type { ActivityKind } from '../types.js';
import { Cron } from 'croner';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** Bots with a video rendering right now (one at a time each). */
const rendering = new Set<string>();

const hyperframesBin = () => (fs.existsSync('/usr/local/bin/hyperframes') ? '/usr/local/bin/hyperframes' : '/opt/hq/node/bin/hyperframes');

/** Run a video render in the background; post the video to the chat (or say why it failed) when it ends. */
function startRender(botId: string, cmd: string, args: string[], out: string, caption: string, cleanup?: () => void) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `/opt/hq/node/bin:${process.env.PATH ?? ''}`,
    HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_SKIP_SKILLS: '1',
    ...(fs.existsSync('/usr/local/bin/chromium') && !process.env.HYPERFRAMES_BROWSER_PATH ? { HYPERFRAMES_BROWSER_PATH: '/usr/local/bin/chromium' } : {}),
  };
  const p = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  rendering.add(botId);
  let log = '';
  p.stdout.on('data', (d) => { log = (log + d).slice(-20000); });
  p.stderr.on('data', (d) => { log = (log + d).slice(-20000); });
  const started = Date.now();
  const done = async (code: number | null) => {
    rendering.delete(botId);
    cleanup?.();
    const secs = Math.round((Date.now() - started) / 1000);
    if (code === 0 && fs.existsSync(out)) {
      const r = await postImage(botId, out, `${caption} · ${secs}s to render`);
      if (!r.ok) appendRow(botId, 'notice', { type: 'notice', text: r.message, tone: 'error' });
      const note = /no voice-over|voice-over skipped/.test(log) ? ' (without voice-over: the voice service did not answer)' : '';
      notifyBot(botId, `Your video is ready${note}`);
    } else {
      console.warn('[video] render failed', log.slice(-2000));
      appendRow(botId, 'notice', { type: 'notice', text: `The video could not be made: ${log.trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 400)}`, tone: 'error' });
    }
  };
  p.on('close', (code) => { void done(code); });
  p.on('error', (e) => { log += String(e); void done(1); });
}

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

// Extra fields a model adds (a 'title', a 'description') are ignored rather than failing the call.
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: true });

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

/** Resolve a source only inside the calling bot's Library; symlink escapes are denied. */
export function libraryReadPath(botId: string, requested: string): string {
  const root = fs.realpathSync(path.join(LIBRARY_ROOT, botId));
  const full = fs.realpathSync(path.isAbsolute(requested) ? requested : path.join(root, requested));
  const rel = path.relative(root, full);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error('Only files in your own Library may be read.');
  }
  if (!fs.statSync(full).isFile()) throw new Error('The source is not a file.');
  return full;
}

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
      let asPath: Buffer | null = null;
      if (/^\/\S+$/.test(content.trim())) {
        try { asPath = await box.readFile(libraryReadPath(ctx.botId, content.trim())); }
        catch { return { output: 'Only files in your own Library can be copied.' }; }
      }
      if (asPath && /\.(png|jpe?g|webp|gif)$/i.test(name)) {
        const r = await postImage(ctx.botId, content.trim());
        return { output: r.message, ...(r.ok ? { summary: `Saved ${r.name}` } : {}) };
      }
      await box.writeFile(file, asPath ?? content);
      return { output: JSON.stringify({ ok: true, path: file }), summary: `Saved ${name}` };
    },
  },
  {
    name: 'read_document',
    description: "Read a PDF, Word, PowerPoint, Excel, HTML or other document from this bot\u0027s Library into Markdown. Only Library files are supported. To read an online document, first download an authorised public file into the Library through your browser.",
    parameters: obj({ source: { type: 'string', description: 'Absolute path, a path inside your Library (e.g. uploads/contract.pdf), or an http(s) link.' } }, ['source']),
    activity: 'reading_web',
    label: 'Reading a document',
    impl: async (a, ctx) => {
      const src = String(a.source ?? '').trim();
      if (!src) return { output: 'Give the path or link of the document.' };
      if (/^[a-z][a-z\d+.-]*:\/\//i.test(src)) return { output: 'For security, download the public file to your Library first.' };
      let target: string;
      try {
        target = libraryReadPath(ctx.botId, src);
        if (fs.statSync(target).size > 25 * 1024 * 1024) return { output: 'This file is larger than the 25 MB document limit.' };
      } catch { return { output: 'Document not found in your Library, or access denied.' }; }
      const r = await box.bash(`command -v markitdown >/dev/null || { echo HQ_NO_MARKITDOWN; exit 3; }; markitdown ${box.quote(target)} 2>&1`, 180);
      if (r.output.includes('HQ_NO_MARKITDOWN')) return { output: 'Document reading is not installed on this server yet (run scripts/update.sh on the server). Try pdftotext or pandoc in the terminal meanwhile.' };
      if (r.exit_code !== 0) return { output: `Could not read ${src}: ${r.output.trim().slice(-600)}` };
      const text = r.output.trim();
      if (!text) return { output: `${src} has no text in it (a scanned PDF needs OCR; say so to the user).` };
      const LIMIT = 40_000;
      if (text.length <= LIMIT) return { output: text, summary: `Read ${src.split('/').pop()}` };
      // Long documents: keep the whole text in the Library and hand back the start.
      const name = `docs/${(src.split('/').pop() ?? 'document').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '')}.md`;
      await box.writeFile(`${LIBRARY_ROOT}/${ctx.botId}/${name}`, text);
      return {
        output: `${text.slice(0, LIMIT)}\n\n[…cut here: the document is ${Math.round(text.length / 1000)}k characters. The full text is saved at ${LIBRARY_ROOT}/${ctx.botId}/${name}; read the rest from there with your file tools, or search it with grep.]`,
        summary: `Read ${src.split('/').pop()} (long)`,
      };
    },
  },
  {
    name: 'free_search',
    description: "Search the web for free (no limits, private). Returns titles, links and short snippets from several search engines. Use it first for anything current: news, prices, people, companies, how-tos. Open the best links with your browser or web tools to read them in full.",
    parameters: obj({
      query: { type: 'string' },
      category: { type: 'string', enum: ['general', 'news', 'images', 'videos', 'it', 'science'], description: 'Default general.' },
      time_range: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Only recent results.' },
      count: { type: 'number', description: 'How many results, 1 to 20 (default 8).' },
    }, ['query']),
    activity: 'searching_web',
    label: 'Searching the web',
    impl: async (a) => {
      const q = String(a.query ?? '').trim();
      if (!q) return { output: 'Say what to search for.' };
      const url = new URL(`${process.env.HQ_SEARXNG_URL ?? 'http://127.0.0.1:8888'}/search`);
      url.searchParams.set('q', q);
      url.searchParams.set('format', 'json');
      if (a.category) url.searchParams.set('categories', String(a.category));
      if (a.time_range) url.searchParams.set('time_range', String(a.time_range));
      let data: any;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`search answered ${res.status}`);
        data = await res.json();
      } catch (e: any) {
        return { output: `Free web search is not available right now (${e?.message ?? e}). Use your other web search tool instead.` };
      }
      const n = Math.max(1, Math.min(20, Number(a.count) || 8));
      const results = (data.results ?? []).slice(0, n).map((r: any, i: number) =>
        `${i + 1}. ${r.title ?? '(no title)'}\n   ${r.url}${r.publishedDate ? ` · ${String(r.publishedDate).slice(0, 10)}` : ''}\n   ${String(r.content ?? '').replace(/\s+/g, ' ').slice(0, 300)}`);
      const extra = [
        data.answers?.length ? `Direct answer: ${data.answers.map((x: any) => (typeof x === 'string' ? x : x.answer)).join(' | ')}` : '',
        data.infoboxes?.length ? `Info: ${String(data.infoboxes[0].content ?? '').slice(0, 500)}` : '',
      ].filter(Boolean);
      if (!results.length) return { output: `No results for "${q}". Try other words.${data.unresponsive_engines?.length ? ' (Some search engines did not answer; try again in a minute.)' : ''}` };
      return { output: [...extra, ...results].join('\n'), summary: `${results.length} results for “${q.slice(0, 40)}”` };
    },
  },
  {
    name: 'set_heartbeat',
    description: "Turn your heartbeat on or off. With a heartbeat you check in on your own every N minutes (30 at least), go through your checklist, and only message the user when something needs them. Use it when the user asks you to keep an eye on something (inbox, a website, orders, deadlines). The checklist is what you look at each time, as short lines. Nights (22:00 to 07:00 their time) are skipped unless quiet_at_night is false. Every check-in uses some of the user's ChatGPT allowance, so pick the longest interval that still works.",
    parameters: obj({
      minutes: { type: 'number', description: '0 turns it off; otherwise 30 or more, e.g. 60 or 120.' },
      checklist: { type: 'string', description: 'What to check each time, one item per line. Leave out to keep the current one.' },
      quiet_at_night: { type: 'boolean' },
    }, ['minutes']),
    activity: 'working',
    label: 'Setting the heartbeat',
    impl: async (a, ctx) => {
      const m = Math.round(Number(a.minutes) || 0);
      if (m !== 0 && m < 30) return { output: 'The shortest heartbeat is every 30 minutes. Ask again with 30 or more, or 0 to turn it off.' };
      const mins = Math.min(m, 24 * 60);
      db.prepare('UPDATE bots SET heartbeat_min=?, updated_at=? WHERE id=?').run(mins, now(), ctx.botId);
      if (typeof a.checklist === 'string') db.prepare('UPDATE bots SET heartbeat_checklist=? WHERE id=?').run(a.checklist.slice(0, 4000), ctx.botId);
      if (typeof a.quiet_at_night === 'boolean') db.prepare('UPDATE bots SET heartbeat_quiet=? WHERE id=?').run(a.quiet_at_night ? 1 : 0, ctx.botId);
      // Start counting from now, so the first check-in is one interval away.
      if (mins) db.prepare('UPDATE bots SET heartbeat_last_at=? WHERE id=?').run(now(), ctx.botId);
      const r = getBotRow(ctx.botId);
      hub.emit(ctx.userId, { type: 'bot', bot: (await import('../store.js')).toBot(r) });
      const every = mins >= 60 && mins % 60 === 0 ? `${mins / 60} hour${mins === 60 ? '' : 's'}` : `${mins} minutes`;
      return {
        output: mins ? `Heartbeat on: every ${every}${r.heartbeat_quiet ? ', not at night' : ''}. Checklist:\n${r.heartbeat_checklist || '(empty: add one so you know what to check)'}` : 'Heartbeat off.',
        summary: mins ? `Heartbeat every ${every}` : 'Heartbeat off',
      };
    },
  },
  {
    name: 'make_promo_video',
    description: "Make a polished promo video from a short brief: animated titles that always fit, cinematic camera moves, transitions, word-by-word captions timed to a free South African voice-over, and a call-to-action ending. Renders in the background (2 to 6 minutes); the video appears in the chat by itself. Brief: {style?, format?, brand:{name,url,logo?,accent?,accent2?}, voice?:'en-ZA-LeahNeural'|'en-ZA-LukeNeural'|'', music?:path, captions?:bool, scenes:[...]}. style: neon (bold dark, glowing), minimal (clean white, framed photos), editorial (magazine serif, cream paper), playful (bright, bouncy, rounded), luxury (black and gold, slow and elegant); leave it out to rotate styles so videos don't look alike. format: portrait 1080x1920 (Reels/TikTok/Shorts/Status, default), square 1080x1080 (Facebook/Instagram feed), landscape 1920x1080 (YouTube/website). Scene types: hero {image|video,kicker?,title,sub?}, points {title,points:[3-4 short lines]}, prices {title,plans:[{name,price:'R49',per:'/mo',features:[..],popular?:true}]}, quote {quote,author,role?,avatar?,stars?:5} (testimonial), compare {title,before:{label?,text,image?},after:{...}}, steps {title,steps:[3-4]}, stats {title?,stats:[{value:'99.9%',label:'uptime'}]} (numbers count up), phone {title,sub?,screenshot} (a tall website screenshot scrolling in a phone; make it with: chromium --headless --no-sandbox --hide-scrollbars --window-size=430,2400 --screenshot=/path.png URL), cta {title,button,url?}. Every scene takes 'say' (its voice-over line, one sentence of 6-16 words; the scene lasts as long as the line), optional 'video' (an mp4 as moving background) and 'transition' (zoom, whip, wipe, flash, rise, slide, fade). *Stars* around 1-2 words colour them. Titles under 6 words. 4-6 scenes = 15-30 seconds. Images in the video's shape work best.",
    parameters: obj({
      brief: { type: 'object', description: 'The video brief described above.' },
      filename: { type: 'string', description: 'e.g. hosting-promo.mp4' },
      quality: { type: 'string', enum: ['draft', 'standard'], description: 'draft is faster, for a first look. Default standard.' },
      caption: { type: 'string', description: 'Short line shown under the video in the chat.' },
    }, ['brief']),
    activity: 'drafting_file',
    label: 'Making a video',
    impl: async (a, ctx) => {
      if (!box.local) return { output: 'Video rendering runs only on the self-hosted server.' };
      const brief = typeof a.brief === 'string' ? (() => { try { return JSON.parse(a.brief); } catch { return null; } })() : a.brief;
      if (!brief || !Array.isArray(brief.scenes) || !brief.scenes.length) return { output: 'The brief needs a scenes list (see the tool description).' };
      const files = [brief.brand?.logo, brief.music, ...brief.scenes.flatMap((s: any) => [s?.image, s?.video, s?.avatar, s?.screenshot, s?.before?.image, s?.after?.image])].filter(Boolean);
      const missing = files.filter((f: string) => !fs.existsSync(f));
      if (missing.length) return { output: `These files do not exist: ${missing.join(', ')}. Make or find them first.` };
      if (rendering.has(ctx.botId)) return { output: 'A video is already rendering for you; it will appear in the chat when done. Wait for it.' };
      const dir = `${LIBRARY_ROOT}/${ctx.botId}`;
      fs.mkdirSync(dir, { recursive: true });
      // No style chosen: take the next one, so a run of videos doesn't all look alike.
      if (!brief.style || brief.style === 'auto') {
        const order = ['neon', 'minimal', 'playful', 'editorial', 'luxury'];
        const mark = `${dir}/.promo-style`;
        let k = 0;
        try { k = (Number(fs.readFileSync(mark, 'utf8')) || 0) + 1; } catch { /* first video */ }
        brief.style = order[k % order.length];
        fs.writeFileSync(mark, String(k));
      }
      const name = (String(a.filename || 'promo.mp4').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]*$/, '') || 'promo') + '.mp4';
      const out = `${dir}/${name}`;
      const specFile = `${dir}/.promo-${Date.now()}.json`;
      fs.writeFileSync(specFile, JSON.stringify(brief));
      const script = new URL('../../../scripts/tools/promo/make-promo.py', import.meta.url).pathname;
      startRender(ctx.botId, 'python3', [script, '--spec', specFile, '--out', out, '--quality', a.quality === 'draft' ? 'draft' : 'standard'], out, a.caption ? String(a.caption) : `${name} · ${brief.style}, ${brief.format || 'portrait'}`, () => fs.rmSync(specFile, { force: true }));
      return {
        output: `Rendering started: ${brief.scenes.length} scenes, ${brief.style} style, ${brief.format || 'portrait'}. It takes 2 to 6 minutes and appears in the chat by itself, saved as ${out}. Tell the user it is on its way; do not wait, poll or render it again.`,
        summary: `Rendering a ${brief.style} video`,
      };
    },
  },
  {
    name: 'render_video_project',
    description: "Render a free-form HyperFrames video project you wrote yourself (for ideas the promo templates can't do). The folder must be inside your Library and hold an index.html composition. Run 'hyperframes lint FOLDER' first. Renders in the background (a few minutes); the video appears in the chat by itself.",
    parameters: obj({
      folder: { type: 'string', description: 'Project folder inside your Library, e.g. /root/grokbot/files/<you>/videos/launch' },
      filename: { type: 'string', description: 'e.g. launch.mp4' },
      quality: { type: 'string', enum: ['draft', 'standard'], description: 'Default standard.' },
      caption: { type: 'string' },
    }, ['folder']),
    activity: 'drafting_file',
    label: 'Rendering a video',
    impl: async (a, ctx) => {
      if (!box.local) return { output: 'Video rendering runs only on the self-hosted server.' };
      const root = `${LIBRARY_ROOT}/${ctx.botId}`;
      let folder: string;
      try { folder = fs.realpathSync(String(a.folder || '')); } catch { return { output: `No folder at ${a.folder}.` }; }
      if (!folder.startsWith(fs.realpathSync(root) + '/')) return { output: `The project must be inside your Library (${root}/...).` };
      if (!fs.existsSync(`${folder}/index.html`)) return { output: `${folder} has no index.html. Start one with: hyperframes init ${folder} --example blank --non-interactive --skip-skills --resolution portrait` };
      if (rendering.has(ctx.botId)) return { output: 'A video is already rendering for you; wait for it.' };
      const name = (String(a.filename || 'video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]*$/, '') || 'video') + '.mp4';
      const out = `${root}/${name}`;
      const args = ['render', folder, '-o', out, '--quality', a.quality === 'draft' ? 'draft' : 'looks', '--low-memory-mode', '--quiet'];
      if (a.quality !== 'draft') args.push('--crf', '21', '--max-bitrate', '7M');
      startRender(ctx.botId, hyperframesBin(), args, out, a.caption ? String(a.caption) : name);
      return { output: `Rendering started; it appears in the chat by itself when done (saved as ${out}). Do not wait or render it again.`, summary: 'Rendering the video' };
    },
  },
  {
    name: 'show_image',
    description: "Show an image, video or audio file in the chat: images (PNG, JPG, WEBP, GIF) appear in the conversation, videos (MP4, WEBM) and audio (MP3, M4A, WAV, OGG) play right there. Give the path of a file you made; it is copied into your Library. Call it every time you make an image, video or voice-over for the user, instead of only writing the file's path.",
    parameters: obj({ path: { type: 'string', description: 'Absolute path of the file on your computer' }, caption: { type: 'string' } }, ['path']),
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
        notifyBot(ctx.botId, `Wants to create a new bot "${name}"`, 'question');
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
      notifyBot(ctx.botId, `Needs your answer: ${a.question}`, 'question');
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
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const VIDEO_EXT = ['mp4', 'webm', 'm4v'];
const AUDIO_EXT = ['mp3', 'm4a', 'wav', 'ogg', 'oga'];

/** Recognise a real image, video or audio file by its first bytes (a bot sometimes writes a path or an error instead). */
function sniffMedia(data: Buffer): 'image' | 'video' | 'audio' | null {
  const m = data.subarray(0, 16);
  const ascii = (a: number, b: number) => m.subarray(a, b).toString('latin1');
  if ((m[0] === 0x89 && m[1] === 0x50) || (m[0] === 0xff && m[1] === 0xd8) || ascii(0, 3) === 'GIF' || (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')) return 'image';
  if (ascii(4, 8) === 'ftyp') return /^(M4A |M4B )/.test(ascii(8, 12)) ? 'audio' : 'video';
  if (m[0] === 0x1a && m[1] === 0x45 && m[2] === 0xdf && m[3] === 0xa3) return 'video'; // WebM
  if (ascii(0, 3) === 'ID3' || (m[0] === 0xff && (m[1] & 0xe0) === 0xe0) || ascii(0, 4) === 'OggS' || (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')) return 'audio';
  return null;
}

/** Copy an image, video or audio file into the bot's Library and show it in the chat (playable for video/audio). */
export async function postImage(botId: string, src: string, caption?: string): Promise<{ ok: boolean; message: string; name?: string }> {
  const ext = (src.split('.').pop() ?? '').toLowerCase();
  const want = IMAGE_EXT.includes(ext) ? 'image' : VIDEO_EXT.includes(ext) ? 'video' : AUDIO_EXT.includes(ext) ? 'audio' : null;
  if (!want) return { ok: false, message: 'Only images (PNG, JPG, WEBP, GIF), videos (MP4, WEBM) and audio (MP3, M4A, WAV, OGG) can be shown. Convert the file first (ffmpeg).' };
  const data = await box.readFile(src);
  if (!data) return { ok: false, message: `No file at ${src}.` };
  const kind = sniffMedia(data);
  const pngTiny = kind === 'image' && data[0] === 0x89 && data.length >= 24 && (data.readUInt32BE(16) < 64 || data.readUInt32BE(20) < 64);
  if (!kind || pngTiny || (kind !== 'image') !== (want !== 'image')) {
    return { ok: false, message: `${src} is not a real ${want} (${data.length} bytes). Do not claim it was made; make it again.` };
  }
  const name = (src.split('/').pop() ?? `file.${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const dest = `${LIBRARY_ROOT}/${botId}/${name}`;
  if (dest !== src) await box.writeFile(dest, data);
  appendRow(botId, 'card', { type: 'card', card: 'image', path: name, ...(kind !== 'image' ? { media: kind } : {}), ...(caption ? { caption: caption.slice(0, 300) } : {}) });
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
