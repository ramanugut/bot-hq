import type { ActivityKind, LiveState, Row } from '@shared/types';

const nice = (s?: string) => !!s && !/[_]/.test(s) && !/^[a-z0-9-]+$/.test(s);

/** Name of the bot being messaged: the running call's `bot_name` argument, else a readable `detail`. */
function messagedName(live: LiveState, rows: Row[]): string | null {
  const running = [...rows].reverse().find((r) => r.body.type === 'tool-call' && r.body.status === 'running');
  const args = running?.body.type === 'tool-call' ? (running.body.args as Record<string, unknown> | undefined) : undefined;
  if (typeof args?.bot_name === 'string') return args.bot_name;
  return nice(live.activity?.detail) ? live.activity!.detail! : null;
}

const FILLER = new Set(['a', 'an', 'the', 'few', 'some', 'it', 'its', 'your', 'on', 'over', 'up', 'down', 'through', 'around', 'bit', 'little']);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !FILLER.has(w));

/** True when a caption only restates the status ("Running a few commands" under "Running commands"). */
export function repeatsStatus(caption: string, status: string): boolean {
  const c = words(caption);
  const s = words(status);
  if (!c.length) return true;
  if (!s.length) return false;
  const stem = (w: string) => w.replace(/(ing|ed|s)$/, '');
  const sStems = new Set(s.map(stem));
  const shared = c.filter((w) => sStems.has(stem(w))).length;
  return shared === c.length || (shared >= s.length && c.length <= s.length + 1);
}

/** One or two words for the status pill under the bot's name. */
const STATUS: Record<ActivityKind, string> = {
  thinking: 'Thinking',
  working: 'Working',
  searching_web: 'Searching',
  reading_web: 'Reading',
  browsing_web: 'Browsing',
  on_its_computer: 'On its computer',
  running_commands: 'Running commands',
  waiting_on_command: 'Waiting on results',
  messaging_named: 'Checking in',
  connecting_service: 'Using an app',
  waiting_for_you: 'Needs you',
  drafting_file: 'Writing',
  remembering: 'Remembering',
};

/** True when the bot has stopped to wait for the person (approval, question, connect). */
export function isWaitingForYou(live: LiveState | undefined): boolean {
  return !!live && (!!live.awaiting || live.activity?.kind === 'waiting_for_you');
}

/** Short status word for the pill: "Thinking", "Browsing", "Working in Gmail", "Needs you". */
export function activityStatus(live: LiveState, rows: Row[]): string {
  if (isWaitingForYou(live)) return 'Needs you';
  const a = live.activity;
  if (!a) return 'Thinking';
  if (a.kind === 'messaging_named') {
    const name = messagedName(live, rows);
    return name ? `Checking with ${name}` : STATUS.messaging_named;
  }
  if (a.kind === 'connecting_service') return nice(a.detail) ? `Working in ${a.detail}` : STATUS.connecting_service;
  return STATUS[a.kind] ?? 'Working';
}
