import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Attachment, Bot, LiveState, MessageBody, Row, ToolCallBody } from '@shared/types';
import { BotAvatar, BotAvatarFor } from '../avatar/BotAvatar';
import { isWaitingForYou } from '../lib/phrases';
import { clock, dividerLabel, duration } from '../lib/time';
import { useStore } from '../store';
import { ThinkingBlock } from './ActivityLine';
import { CardRow } from './cards/Cards';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { openImage } from './Lightbox';
import { stepIcon } from '../lib/stepIcon';

type Item =
  | { kind: 'divider'; key: string; ts: number }
  | { kind: 'group'; key: string; side: 'left' | 'right'; from?: MessageBody['from']; rows: Row[] }
  | { kind: 'steps'; key: string; rows: Row[]; /** Row timestamps just before and just after the run of steps. */ startTs: number | null; endTs: number | null }
  | { kind: 'row'; key: string; row: Row };

const DIVIDER_GAP = 60 * 60 * 1000;
const GROUP_GAP = 5 * 60 * 1000;

/** Turns rows into render items: date dividers, grouped bubbles, collapsed tool-call steps, cards, events. */
function buildItems(rows: Row[]): Item[] {
  const items: Item[] = [];
  let prevTs = 0;
  for (const row of rows) {
    if (!prevTs || row.createdAt - prevTs > DIVIDER_GAP) items.push({ kind: 'divider', key: `d${row.seq}`, ts: row.createdAt });
    const before = prevTs;
    prevTs = row.createdAt;
    const last = items[items.length - 1];
    const b = row.body;
    if (b.type === 'tool-call') {
      if (last?.kind === 'steps') last.rows.push(row);
      else items.push({ kind: 'steps', key: `s${row.seq}`, rows: [row], startTs: before || null, endTs: null });
      continue;
    }
    if (last?.kind === 'steps' && last.endTs === null) last.endTs = row.createdAt;
    if (b.type === 'message') {
      if (!b.text && !b.streaming && !b.attachments?.length) continue;
      const side = b.role === 'user' && (!b.from || b.from.kind === 'voice') ? 'right' : 'left';
      const sender = b.from ? `${b.from.kind}:${b.from.id}` : b.role;
      const lastRow = last?.kind === 'group' ? last.rows[last.rows.length - 1] : null;
      const lastBody = lastRow?.body as MessageBody | undefined;
      const lastSender = lastBody ? (lastBody.from ? `${lastBody.from.kind}:${lastBody.from.id}` : lastBody.role) : null;
      if (last?.kind === 'group' && lastSender === sender && row.createdAt - lastRow!.createdAt < GROUP_GAP) last.rows.push(row);
      else items.push({ kind: 'group', key: `g${row.seq}`, side, from: b.from, rows: [row] });
      continue;
    }
    items.push({ kind: 'row', key: `r${row.seq}`, row });
  }
  return items;
}

function cornerClass(i: number, n: number) {
  if (n < 2) return '';
  if (i === 0) return ' is-first';
  if (i === n - 1) return ' is-last';
  return ' is-mid';
}

/** Photos, videos and files the user sent, shown above their message. */
function Attachments({ botId, items, side }: { botId: string; items: Attachment[]; side: 'left' | 'right' }) {
  const url = (p: string, inline = true) => `/api/bots/${botId}/files/raw?path=${encodeURIComponent(p)}${inline ? '&inline=1' : ''}`;
  const media = items.filter((a) => a.kind === 'image' || a.kind === 'video');
  const other = items.filter((a) => a.kind !== 'image' && a.kind !== 'video');
  return (
    <div className={`attachments is-${side}`}>
      {media.length > 0 && (
        <div className={`attachments__grid is-${Math.min(media.length, 3)}`}>
          {media.map((a) => a.kind === 'video'
            ? <video key={a.path} className="attachments__media" src={url(a.path)} controls playsInline preload="metadata" />
            : <button key={a.path} type="button" className="attachments__open" onClick={() => openImage(url(a.path), a.name, url(a.path, false))} aria-label={`View ${a.name}`}><img className="attachments__media" src={url(a.path)} alt={a.name} loading="lazy" /></button>)}
        </div>
      )}
      {other.map((a) => a.kind === 'audio'
        ? <audio key={a.path} className="attachments__audio" src={url(a.path)} controls preload="metadata" />
        : <a key={a.path} className="attachments__file" href={url(a.path, false)} download><Icon name="paperclip" size={13} opacity={0.6} /> {a.name}{a.size ? <span> · {a.size < 1e6 ? `${Math.max(1, Math.round(a.size / 1e3))} KB` : `${(a.size / 1e6).toFixed(1)} MB`}</span> : null}</a>)}
    </div>
  );
}

const Bubble = memo(function Bubble({ row, side, pos, fresh }: { row: Row; side: 'left' | 'right'; pos: string; fresh?: boolean }) {
  const b = row.body as MessageBody;
  return (
    <div className={`bubble-wrap is-${side}${fresh ? ' is-fresh' : ''}`}>
      {b.attachments && b.attachments.length > 0 && <Attachments botId={row.botId} items={b.attachments} side={side} />}
      {(b.text || b.streaming || !b.attachments?.length) && (
      <div className={`bubble is-${side === 'right' ? 'user' : 'agent'}${pos}${b.streaming ? ' is-streaming' : ''}`}>
        {side === 'right' ? <div className="bubble__plain">{b.text}</div> : <Markdown text={b.text || ' '} />}
        {b.citations && b.citations.length > 0 && (
          <div className="bubble__cites">
            {b.citations.slice(0, 6).map((c, i) => {
              let host = c.url;
              try { host = new URL(c.url).hostname.replace(/^www\./, ''); } catch { /* keep */ }
              return <a key={i} className="cite-chip" href={c.url} target="_blank" rel="noreferrer noopener" title={c.title ?? c.url}>{host}</a>;
            })}
          </div>
        )}
      </div>
      )}
      <span className="bubble__time">
        {clock(row.createdAt)}
        {side === 'left' && !b.streaming && b.text && <CopyButton text={b.text} />}
        {side === 'left' && !b.streaming && b.text && typeof speechSynthesis !== 'undefined' && (
          <button type="button" className="bubble__speak" onClick={() => speak(b.text)} aria-label="Read aloud" title="Read aloud"><Icon name="speaker" size={13} /></button>
        )}
      </span>
    </div>
  );
});

/** Copies a reply as plain text (without the MEDIA: lines Hermes uses for files) and confirms with a tick. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.replace(/^\s*MEDIA:\S+\s*$/gm, '').trim());
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch { /* clipboard blocked: nothing to confirm */ }
  };
  return (
    <button type="button" className="bubble__speak" onClick={() => void copy()} aria-label={done ? 'Copied' : 'Copy'} title={done ? 'Copied' : 'Copy'}>
      <Icon name={done ? 'check' : 'copy'} size={13} />
    </button>
  );
}

/** Free read-aloud with the device's own voices (no server, no key). Tap again to stop. */
function speak(text: string) {
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
  const plain = text.replace(/```[\s\S]*?```/g, ' ').replace(/[*_#>`|]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/MEDIA:\S+/g, '');
  const u = new SpeechSynthesisUtterance(plain.slice(0, 4000));
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find((v) => /en-ZA/i.test(v.lang)) ?? voices.find((v) => /^en/i.test(v.lang) && /natural|neural|google/i.test(v.name)) ?? voices.find((v) => /^en/i.test(v.lang)) ?? null;
  u.rate = 1.02;
  speechSynthesis.speak(u);
}

function SenderLabel({ from }: { from: NonNullable<MessageBody['from']> }) {
  const bot = useStore((s) => (from.kind === 'bot' ? s.bots.find((b) => b.id === from.id) : undefined));
  return (
    <div className="sender-label">
      {bot ? <BotAvatarFor bot={bot} size={16} /> : from.kind === 'routine' ? <Icon name="clock" size={12} opacity={0.56} /> : from.kind === 'voice' ? <Icon name="voice_a" size={12} opacity={0.56} /> : <BotAvatar shape="blob" color="gray" size={16} />}
      <span>{from.kind === 'routine' ? `Routine · ${from.name}` : from.kind === 'voice' ? 'Asked on a voice call' : `From ${from.name}`}</span>
    </div>
  );
}

const MAX_WORK_MS = 12 * 60 * 60 * 1000;

/** How long a finished run of steps took, from the row before it to the row after it. */
function workedMs(item: Extract<Item, { kind: 'steps' }>): number | null {
  const end = item.endTs ?? item.rows[item.rows.length - 1].createdAt;
  if (!item.startTs) return null;
  const ms = end - item.startTs;
  return ms >= 1000 && ms < MAX_WORK_MS ? ms : null;
}

function argsText(args: unknown): string | null {
  if (args === undefined || args === null) return null;
  if (typeof args === 'string') return args.trim() ? args.slice(0, 2000) : null;
  if (typeof args === 'object' && Object.keys(args as object).length === 0) return null;
  try {
    const text = JSON.stringify(args, null, 2);
    return text.length > 2000 ? `${text.slice(0, 2000)}\n…` : text;
  } catch { return null; }
}

const STEP_NOTE: Partial<Record<ToolCallBody['status'], string>> = {
  error: 'Failed', denied: 'Not allowed', 'awaiting-approval': 'Waiting for your OK',
};

function StepRow({ call }: { call: ToolCallBody }) {
  const [open, setOpen] = useState(false);
  const args = argsText(call.args);
  const note = STEP_NOTE[call.status];
  const Glyph = stepIcon(call.name);
  const body = (
    <>
      <span className="step__mark" aria-hidden>
        {call.status === 'running' ? <span className="step__spin" /> : call.status === 'done' ? <Glyph className="step__glyph" size={13} strokeWidth={1.6} /> : <span className="step__dot" />}
      </span>
      <span className="step__label">{call.label || call.name}</span>
      {call.summary && <span className="step__summary">{call.summary}</span>}
      {note && <span className="step__note">{note}</span>}
    </>
  );
  return (
    <li className={`step is-${call.status}`}>
      {args ? (
        <button type="button" className="step__row is-clickable" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? 'Hide details' : 'Show details'}>{body}</button>
      ) : <div className="step__row">{body}</div>}
      {open && args && <pre className="step__args">{args}</pre>}
      {call.screenshot && <img className="step__shot" src={call.screenshot} alt="" />}
    </li>
  );
}

/**
 * A run of tool calls, folded into one chip. While the turn runs it shows what the bot is doing right
 * now and the step count; afterwards it reads "Worked for 2m 10s · 7 steps". Click to see every step.
 */
function Steps({ item, active, open: unfinished, extra, fresh }: {
  item: Extract<Item, { kind: 'steps' }>;
  /** The bot is working on this run of steps right now. */
  active: boolean;
  /** The turn this run belongs to has not ended (it may be paused, waiting for the person). */
  open: boolean;
  /** Steps the server has counted that have no row yet. */
  extra: number;
  /** Arrived after the chat loaded: it slides in. */
  fresh?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const calls = item.rows.map((r) => r.body as ToolCallBody);
  const n = calls.length + (unfinished ? extra : 0);
  const count = `${n} ${n === 1 ? 'step' : 'steps'}`;
  const current = [...calls].reverse().find((c) => c.status === 'running') ?? calls[calls.length - 1];
  const worked = unfinished ? null : workedMs(item);
  const flag = calls.some((c) => c.status === 'awaiting-approval') ? 'waiting' : calls.some((c) => c.status === 'error' || c.status === 'denied') ? 'problem' : null;
  return (
    <div className={`steps${open ? ' is-open' : ''}${active ? ' is-active' : ''}${fresh ? ' is-fresh' : ''}`}>
      <button type="button" className="steps__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {active ? (
          // What the bot is doing right now is shown once, in the status line below; the chip only counts.
          <span className="step__spin" aria-hidden title={current.label || current.name} />
        ) : (
          <>
            {flag && <span className={`steps__flag is-${flag}`} title={flag === 'waiting' ? 'A step is waiting for your OK' : 'A step did not finish'} />}
            {worked !== null && <><span className="steps__worked">Worked for {duration(worked)}</span><span className="steps__sep" aria-hidden>·</span></>}
          </>
        )}
        <span className="steps__count">{count}</span>
        <Icon name="chev_right" size={10} opacity={0.66} className="steps__chev" />
      </button>
      {open && <ul className="steps__list">{calls.map((c) => <StepRow key={c.callId} call={c} />)}</ul>}
    </div>
  );
}

function SystemRow({ row, fresh }: { row: Row; fresh?: boolean }) {
  const b = row.body;
  const f = fresh ? ' is-fresh' : '';
  if (b.type === 'event') return <div className={`system-event${f}`}>{b.text}</div>;
  if (b.type === 'notice') return <div className={`notice is-${b.tone ?? 'info'}${f}`}>{b.text}</div>;
  if (b.type === 'card') return <div className={`card-row${f}`}><CardRow row={row} /></div>;
  return null;
}

interface Props { bot: Bot; rows: Row[]; live: LiveState | undefined; loaded: boolean }

export function Transcript({ bot, rows, live, loaded }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);
  // Messages and cards that arrived while the person was scrolled up, counted for the jump button.
  const [unseen, setUnseen] = useState(0);
  const seenCount = useRef(0);
  const items = useMemo(() => buildItems(rows), [rows]);
  // Rows already there when a chat opens appear at once; only rows that arrive afterwards slide in.
  const settledSeq = useRef<number | null>(null);
  const settledBot = useRef(bot.id);
  if (settledBot.current !== bot.id) { settledBot.current = bot.id; settledSeq.current = null; }
  const isFresh = (seq: number) => settledSeq.current !== null && seq > settledSeq.current;
  useLayoutEffect(() => {
    if (loaded && settledSeq.current === null) settledSeq.current = rows.reduce((m, r) => Math.max(m, r.seq), 0);
  }, [loaded, rows, bot.id]);

  const running = !!live?.isRunning;
  const waiting = isWaitingForYou(live);
  const last = rows[rows.length - 1];
  const streamingNow = last?.body.type === 'message' && last.body.role === 'assistant' && !!last.body.streaming;
  const showActivity = (running && !streamingNow) || waiting;

  // The chip that is still growing: the last thing in the transcript while the turn runs.
  const lastItem = items[items.length - 1];
  const openKey = (running || waiting) && lastItem?.kind === 'steps' ? lastItem.key : null;
  const activeKey = running && !waiting ? openKey : null;
  // `live.steps` counts the whole turn; anything beyond the rows we hold for this turn has no row yet.
  const turnSteps = useMemo(() => {
    let n = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const b = rows[i].body;
      if (b.type === 'message' && b.role === 'user') break;
      if (b.type === 'tool-call') n++;
    }
    return n;
  }, [rows]);
  const serverSteps = running ? live?.steps ?? 0 : 0;
  const extraSteps = Math.max(0, serverSteps - turnSteps);

  // Keep pinned to the bottom while new content arrives, unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  const visibleCount = useMemo(() => rows.filter((r) => r.body.type === 'message' || r.body.type === 'card').length, [rows]);
  useLayoutEffect(() => {
    if (stick.current) { seenCount.current = visibleCount; setUnseen(0); }
    else if (visibleCount > seenCount.current) setUnseen(visibleCount - seenCount.current);
  }, [visibleCount]);
  // Jump to bottom when switching bots.
  useLayoutEffect(() => {
    stick.current = true;
    seenCount.current = visibleCount;
    setUnseen(0);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bot.id]);

  const onScroll = () => {
    const el = scrollRef.current!;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = dist < 40;
    setShowJump(dist > 200);
    if (stick.current) { seenCount.current = visibleCount; setUnseen(0); }
  };

  const jump = () => {
    const el = scrollRef.current!;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div className="transcript-wrap">
    <div className="transcript" ref={scrollRef} onScroll={onScroll}>
      <div className="transcript__col" key={bot.id}>
        {loaded && rows.length === 0 && <EmptyChat bot={bot} />}
        {items.map((it) => {
          switch (it.kind) {
            case 'divider':
              return <div key={it.key} className="divider">{dividerLabel(it.ts)}</div>;
            case 'steps':
              return <Steps key={it.key} item={it} active={it.key === activeKey} open={it.key === openKey} extra={extraSteps} fresh={isFresh(it.rows[0].seq)} />;
            case 'row':
              return <SystemRow key={it.key} row={it.row} fresh={isFresh(it.row.seq)} />;
            case 'group':
              return (
                <div key={it.key} className={`group is-${it.side}`}>
                  {it.from && <SenderLabel from={it.from} />}
                  {it.rows.map((r, i) => (
                    <Fragment key={r.seq}><Bubble row={r} side={it.side} pos={cornerClass(i, it.rows.length)} fresh={isFresh(r.seq)} /></Fragment>
                  ))}
                </div>
              );
          }
        })}
        {showActivity && live && <ThinkingBlock bot={bot} live={live} rows={rows} steps={openKey ? 0 : serverSteps} />}
      </div>
    </div>
      {(showJump || unseen > 0) && (
        <button type="button" className={`jump-btn${unseen > 0 ? ' has-new' : ''}`} onClick={jump} aria-label={unseen > 0 ? `${unseen} new, scroll to the latest` : 'Scroll to the latest'}>
          <Icon name="arrow_down" size={15} />
          <span>{unseen > 0 ? `${unseen} new` : 'Latest'}</span>
        </button>
      )}
    </div>
  );
}

function EmptyChat({ bot }: { bot: Bot }) {
  return (
    <div className="empty-chat">
      <BotAvatarFor bot={bot} size={72} />
      <div className="empty-chat__title">{bot.name}</div>
      <div className="empty-chat__sub">{bot.description || (bot.mode === 'teammate' ? 'A Bot for the whole team. Hand it a task and it will see it through.' : 'Your personal assistant. Hand it a task and it will see it through.')}</div>
    </div>
  );
}
