import { useEffect, useRef, useState } from 'react';
import { BrainCircuit, Code2, FileText, Globe2, Hourglass, Network, Orbit, ScanSearch, Sparkles, Waves } from 'lucide-react';
import type { Bot, LiveState, Row } from '@shared/types';
import { activityPhrase, activityStatus, isWaitingForYou } from '../lib/phrases';
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

const glyphs = {
  think: BrainCircuit, search: ScanSearch, read: FileText, browse: Globe2, write: Waves,
  code: Code2, create: Sparkles, connect: Network, wait: Hourglass, work: Orbit,
} satisfies Record<SignalMode, typeof BrainCircuit>;

function Signal({ mode }: { mode: SignalMode }) {
  const Glyph = glyphs[mode];
  return (
    <span className={`thinking__signal is-${mode}`} aria-hidden="true">
      <span className="thinking__ring thinking__ring--outer" />
      <span className="thinking__ring thinking__ring--inner" />
      <span className="thinking__sweep" />
      <Glyph className="thinking__glyph" size={18} strokeWidth={1.55} />
      <span className="thinking__satellite" />
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
  const tick = Math.max(0, Math.floor((now - (live.activity?.since ?? since)) / 6000));
  const caption = waiting
    ? live.awaiting?.reason || 'Waiting for your answer'
    : live.caption?.trim() || activityPhrase(live, rows, tick);
  const timer = waiting
    ? live.awaiting && now - live.awaiting.since >= 1000 ? `Waiting for ${duration(now - live.awaiting.since)}` : null
    : now - since >= 1000 ? `Working for ${duration(now - since)}` : null;

  return (
    <div className={`thinking thinking--signal is-${mode}`}>
      <Signal mode={mode} />
      <div className="thinking__content">
        <div className="thinking__heading">
          <span className="thinking__name">{bot.name}</span>
          <span className="thinking__separator" aria-hidden="true" />
          <span className="thinking__status" role="status" aria-live="polite">{status}</span>
        </div>
        <Caption text={caption} />
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
