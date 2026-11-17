import { useEffect, useRef, useState } from 'react';
import { BotAvatar } from '../avatar/BotAvatar';
import type { Bot, LiveState, Row } from '@shared/types';
import { activityStatus, isWaitingForYou, repeatsStatus } from '../lib/phrases';
import { duration } from '../lib/time';

type SignalMode = 'think' | 'search' | 'read' | 'browse' | 'write' | 'code' | 'create' | 'connect' | 'wait' | 'work';
const CAPTION_FADE_MS = 280;

/** Each mode is tied to real Hermes activity or a running tool, not a random animation. */
export function activitySignalMode(live: LiveState, rows: Row[]): SignalMode {
  if (isWaitingForYou(live)) return 'wait';
  const running = [...rows].reverse().find((r) => r.body.type === 'tool-call' && r.body.status === 'running');
  const tool = running?.body.type === 'tool-call' ? running.body.name.toLowerCase() : '';
  const kind = live.activity?.kind;
  if (kind === 'searching_web' || /(?:tavily_search|free_search|x_search|web_search)/.test(tool)) return 'search';
  if (kind === 'reading_web' || /(?:tavily_extract|tavily_crawl|tavily_map|read_document|read_file)/.test(tool)) return 'read';
  if (kind === 'browsing_web' || kind === 'on_its_computer' || /(?:browser|computer|screenshot|navigate)/.test(tool)) return 'browse';
  if (kind === 'running_commands' || kind === 'waiting_on_command' || /(?:terminal|shell|bash|exec_command)/.test(tool)) return 'code';
  if (kind === 'drafting_file' || /(?:save_file|write_file|edit_file)/.test(tool)) return 'write';
  if (/(?:image_gen|generate_image|make_promo_video|render_video)/.test(tool)) return 'create';
  if (kind === 'messaging_named' || kind === 'connecting_service' || /(?:send_to_bot|connect_app)/.test(tool)) return 'connect';
  if (kind === 'thinking' || kind === 'remembering') return 'think';
  return 'work';
}

/** The bot itself, bouncing while it works, with a little thought bubble: soft dots, or a "?" when it waits for you. */
function Puff({ bot, waiting }: { bot: Bot; waiting: boolean }) {
  return (
    <span className={`thinking__puff${waiting ? ' is-waiting' : ''}`} aria-hidden="true">
      <BotAvatar shape={bot.avatarShape} color={bot.avatarColor} size={40} title={bot.name} working={!waiting} />
      <span className="thinking__bubble">
        {waiting ? <span className="thinking__ask">?</span> : <><i /><i /><i /></>}
      </span>
    </span>
  );
}

/** Keeps changing captions legible without shifting the chat layout. */
function Caption({ text }: { text: string }) {
  const last = useRef(text);
  const [leaving, setLeaving] = useState<string | null>(null);
  useEffect(() => {
    const old = last.current;
    last.current = text;
    if (old === text) return;
    setLeaving(old);
    const t = setTimeout(() => setLeaving(null), CAPTION_FADE_MS);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <span className="thinking__caption">
      <span key={text} className="thinking__caption-line is-in">{text}</span>
      {leaving !== null && leaving !== text && <span key={`out:${leaving}`} className="thinking__caption-line is-out" aria-hidden="true">{leaving}</span>}
    </span>
  );
}

interface Props {
  bot: Bot;
  live: LiveState;
  rows: Row[];
  /** Step count beside the timer. Omitted when the steps chip above already shows it. */
  steps?: number;
}

/** A live, context-aware activity signal. No floating box, mascot badge or fake progress. */
export function ThinkingBlock({ bot, live, rows, steps = 0 }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const waiting = isWaitingForYou(live);
  const mode = activitySignalMode(live, rows);
  const status = activityStatus(live, rows);
  const since = live.startedAt ?? live.activity?.since ?? live.awaiting?.since ?? now;
  // The status beside the name already says what is happening; a caption only adds what the bot is actually
  // thinking or why it waits, never the same idea in other words.
  const raw = waiting ? live.awaiting?.reason?.trim() : live.caption?.trim();
  const caption = raw && !repeatsStatus(raw, status) ? raw : null;
  const from = waiting && live.awaiting ? live.awaiting.since : since;
  const timer = now - from >= 1000 ? duration(now - from) : null;

  return (
    <div className={`thinking thinking--signal is-${mode}`}>
      <Puff bot={bot} waiting={waiting} />
      <div className="thinking__content">
        <div className="thinking__heading">
          <span className="thinking__name">{bot.name}</span>
          <span className="thinking__separator" aria-hidden="true" />
          <span className="thinking__status" role="status" aria-live="polite">{status}</span>
        </div>
        {caption && <Caption text={caption} />}
        {(timer || steps > 0) && (
          <span className="thinking__meta">
            {timer}
            {timer && steps > 0 && ' · '}
            {steps > 0 && `${steps} ${steps === 1 ? 'step' : 'steps'}`}
          </span>
        )}
      </div>
    </div>
  );
}

export const ActivityLine = ThinkingBlock;
