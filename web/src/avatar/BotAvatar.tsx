import { useId } from 'react';
import type { AvatarColor, AvatarShape, Bot } from '@shared/types';
import { palette } from '../lib/colors';
import { Icon } from '../components/Icon';
import { useStore } from '../store';

/**
 * Bot avatars: soft little creatures ("puffs"). Each bot is a squishy, pastel body in its own colour with shiny eyes,
 * rosy cheeks and a tiny mouth. They breathe (a slow squish), blink and glance around on their own rhythm, and do a
 * happy squash-and-bounce while they work. Every animation is a CSS transform on a few SVG groups (no JavaScript
 * timers), so a screen full of them costs next to nothing. Each bot's rhythm comes from its name, so a sidebar of
 * puffs never breathes in unison. The shape names are kept from the old robots, so existing bots keep their slot.
 */

type Paint = { body: string; deep: string; light: string; cheek: string };
interface Creature {
  /** The body and anything attached to it (ears, tufts), in the bot's colour. viewBox is 0 0 100 100, feet at y≈94. */
  body: (p: Paint) => JSX.Element;
  /** Where the face sits and how big it is. */
  face: { x: number; y: number; s: number };
  /** Something that sways on its own (a sprout, a curl, a flower), drawn above the body. */
  tuft?: (p: Paint) => JSX.Element;
  /** A cat's "w" mouth instead of a smile. */
  catMouth?: boolean;
}

/** A soft star with rounded points, centred on (cx, cy). */
function softStar(cx: number, cy: number, outer: number, inner: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? inner : outer;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  // Curve through the midpoints, using each point as the control: every tip and notch comes out round.
  const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[9], pts[0]);
  let d = `M${start[0].toFixed(1)} ${start[1].toFixed(1)}`;
  for (let i = 0; i < 10; i++) {
    const m = mid(pts[i], pts[(i + 1) % 10]);
    d += ` Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  }
  return `${d} Z`;
}

const CREATURES: Record<string, Creature> = {
  // Mochi: a round, squashed puff with a little sprout.
  blob: {
    body: (p) => <ellipse cx={50} cy={62} rx={40} ry={32} fill={p.body} />,
    tuft: (p) => <g className="puff__tuft"><path d="M50 31 C50 24 50 21 50 18" stroke={p.deep} strokeWidth={3} strokeLinecap="round" fill="none" /><path d="M50 22 C43 14 35 17 36 22 C40 26 47 25 50 22Z" fill={p.light} /><path d="M50 20 C56 11 65 13 64 19 C60 24 53 23 50 20Z" fill={p.light} /></g>,
    face: { x: 50, y: 62, s: 1 },
  },
  // Cloud puff.
  cloud: {
    body: (p) => <path d="M22 90 C10 90 6 80 9 72 C4 64 9 52 20 52 C20 38 34 30 45 36 C51 26 68 26 73 39 C85 38 94 48 90 59 C98 64 97 78 88 84 C86 88 82 90 78 90 Z" fill={p.body} />,
    face: { x: 50, y: 66, s: 1 },
  },
  // Marshmallow: a soft square with tiny round ears.
  square: {
    body: (p) => <><circle cx={27} cy={30} r={8} fill={p.body} /><circle cx={73} cy={30} r={8} fill={p.body} /><rect x={13} y={28} width={74} height={64} rx={28} fill={p.body} /></>,
    face: { x: 50, y: 60, s: 1 },
  },
  // Bunny with long, floppy ears.
  sparkle: {
    body: (p) => <>
      <g className="puff__ear puff__ear--l"><ellipse cx={35} cy={24} rx={8.5} ry={20} transform="rotate(-14 35 24)" fill={p.body} /><ellipse cx={35} cy={26} rx={4} ry={13} transform="rotate(-14 35 26)" fill={p.cheek} opacity={0.55} /></g>
      <g className="puff__ear puff__ear--r"><ellipse cx={65} cy={24} rx={8.5} ry={20} transform="rotate(14 65 24)" fill={p.body} /><ellipse cx={65} cy={26} rx={4} ry={13} transform="rotate(14 65 26)" fill={p.cheek} opacity={0.55} /></g>
      <ellipse cx={50} cy={64} rx={36} ry={30} fill={p.body} />
    </>,
    face: { x: 50, y: 64, s: 0.95 },
  },
  // Little bear: round, with round ears.
  clover: {
    body: (p) => <><circle cx={23} cy={33} r={11} fill={p.body} /><circle cx={77} cy={33} r={11} fill={p.body} /><circle cx={23} cy={33} r={5.5} fill={p.cheek} opacity={0.5} /><circle cx={77} cy={33} r={5.5} fill={p.cheek} opacity={0.5} /><ellipse cx={50} cy={60} rx={38} ry={34} fill={p.body} /></>,
    face: { x: 50, y: 62, s: 1 },
  },
  // A plump heart.
  heart: {
    body: (p) => <path d="M50 92 C24 80 7 62 10 43 C12 27 30 20 42 28 C46 30 48 33 50 36 C52 33 54 30 58 28 C70 20 88 27 90 43 C93 62 76 80 50 92 Z" fill={p.body} />,
    face: { x: 50, y: 56, s: 0.92 },
  },
  // A bud with a little flower on its head.
  flower: {
    body: (p) => <ellipse cx={50} cy={64} rx={37} ry={30} fill={p.body} />,
    tuft: (p) => <g className="puff__tuft">
      <path d="M50 35 C50 30 50 28 50 26" stroke={p.deep} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} className="puff__petal" cx={50} cy={13} rx={4.6} ry={6.4} transform={`rotate(${a} 50 20)`} />)}
      <circle cx={50} cy={20} r={4} fill="#FFD66B" />
    </g>,
    face: { x: 50, y: 64, s: 0.95 },
  },
  // Bean: a tall, soft egg with a single curl.
  teardrop: {
    body: (p) => <path d="M50 18 C72 18 84 44 84 64 C84 82 70 93 50 93 C30 93 16 82 16 64 C16 44 28 18 50 18 Z" fill={p.body} />,
    tuft: (p) => <g className="puff__tuft"><path d="M50 19 C46 12 52 7 56 10 C59 13 55 17 52 14" stroke={p.deep} strokeWidth={2.8} strokeLinecap="round" fill="none" /></g>,
    face: { x: 50, y: 60, s: 0.95 },
  },
  // Pudding with a caramel top.
  tablet: {
    body: (p) => <>
      <path d="M22 92 C15 92 12 88 13 82 L22 38 C23 31 28 27 35 27 L65 27 C72 27 77 31 78 38 L87 82 C88 88 85 92 78 92 Z" fill={p.body} />
      <path d="M35 27 L65 27 C72 27 77 31 78 38 L79 43 C74 47 70 41 66 46 C62 50 58 43 53 47 C48 51 45 44 40 47 C35 50 31 44 26 46 C24 47 22 46 21 44 L22 38 C23 31 28 27 35 27 Z" fill={p.deep} opacity={0.85} />
    </>,
    face: { x: 50, y: 66, s: 0.95 },
  },
  // Kitten with soft pointed ears.
  wedge: {
    body: (p) => <>
      <path d="M17 46 C14 32 15 20 19 15 C23 13 32 21 39 29 Z" fill={p.body} strokeLinejoin="round" />
      <path d="M83 46 C86 32 85 20 81 15 C77 13 68 21 61 29 Z" fill={p.body} strokeLinejoin="round" />
      <path d="M21 36 C20 28 21 22 23 20 C26 21 30 25 33 29 Z" fill={p.cheek} opacity={0.5} />
      <path d="M79 36 C80 28 79 22 77 20 C74 21 70 25 67 29 Z" fill={p.cheek} opacity={0.5} />
      <ellipse cx={50} cy={60} rx={38} ry={33} fill={p.body} />
    </>,
    face: { x: 50, y: 61, s: 1 },
    catMouth: true,
  },
  // A round bun with a little knot on top.
  house: {
    body: (p) => <>
      <path d="M10 76 C10 54 28 40 50 40 C72 40 90 54 90 76 C90 88 82 93 72 93 L28 93 C18 93 10 88 10 76 Z" fill={p.body} />
      <path d="M50 41 L40 48 M50 41 L60 48 M50 41 L50 50" stroke={p.deep} strokeWidth={1.8} strokeLinecap="round" fill="none" opacity={0.45} />
      <circle cx={50} cy={39} r={6} fill={p.body} />
    </>,
    face: { x: 50, y: 70, s: 0.95 },
  },
  // A chubby star.
  star: {
    body: (p) => <path d={softStar(50, 56, 46, 28)} fill={p.body} />,
    face: { x: 50, y: 60, s: 0.82 },
  },
  // A little ghost with a wavy hem.
  hex: {
    body: (p) => <path d="M16 52 C16 30 31 16 50 16 C69 16 84 30 84 52 L84 84 C84 90 79 93 74 89 C70 86 66 86 62 90 C58 94 54 94 50 90 C46 86 42 86 38 90 C34 94 30 94 26 90 C22 86 16 92 16 84 Z" fill={p.body} />,
    face: { x: 50, y: 52, s: 0.98 },
  },
};

/** Older shape names (from bots made before these) map onto the closest creature. */
const ALIAS: Record<string, string> = {
  pebble: 'blob', bean: 'teardrop', egg: 'teardrop', squircle: 'house', capsule: 'teardrop', cylinder: 'tablet',
  gem: 'hex', crystal: 'hex', shield: 'heart', dome: 'flower', arch: 'heart', leaf: 'wedge',
};

const creatureFor = (shape: string): Creature => CREATURES[shape] ?? CREATURES[ALIAS[shape] ?? 'blob'] ?? CREATURES.blob;

/** Shapes offered in the Create New Bot picker. */
export const PICKER_SHAPES: AvatarShape[] = ['blob', 'cloud', 'square', 'sparkle', 'clover', 'heart', 'flower', 'teardrop', 'tablet', 'wedge', 'house', 'star', 'hex'];

/** A stable number from a string, for per-bot animation timing. */
function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

interface Props {
  shape: AvatarShape | string;
  color: AvatarColor | string;
  size: number;
  star?: boolean;
  /** Selected-shape ring. */
  ring?: boolean;
  className?: string;
  title?: string;
  /** Busy: a happy squash-and-bounce. */
  working?: boolean;
  /** Still: no breathing, blinking or glancing (e.g. tiny icons). */
  still?: boolean;
}

export function BotAvatar({ shape, color, size, star, ring, className, title, working, still }: Props) {
  const c = creatureFor(String(shape));
  // Pure black would read as a hole: black puffs are a soft charcoal plush instead. Everything is a touch pastel.
  const raw = palette(color).fill.toUpperCase() === '#000000' ? '#3E4350' : palette(color).fill;
  const darkBody = isDark(raw);
  // Already-pale colours (cream, lemon, blush) stay as they are, or they would fade into a light page.
  const base = darkBody || luminance(raw) > 185 ? raw : shade(raw, 0.1);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const bodyId = `pb${uid}`;
  const glossId = `pg${uid}`;
  const paint: Paint = {
    body: `url(#${bodyId})`,
    deep: shade(raw, darkBody ? 0.35 : -0.28),
    light: shade(raw, darkBody ? 0.45 : 0.42),
    // Rosy cheeks; on pink and red bodies they turn a pale rose so they still show.
    cheek: isRosy(raw) ? '#FFD6DE' : '#FF8FA8',
  };
  const tiny = size < 22;
  const eye = darkBody ? '#FFF6EE' : '#2A2230';
  const shine = darkBody ? '#2A2230' : '#FFFFFF';
  const r = seed(`${title ?? ''}${shape}${color}`);
  // Negative delays start each puff part-way through its loop; durations differ a little per bot.
  const timing = {
    ['--blink-dur' as string]: `${4.4 + r * 3}s`, ['--blink-delay' as string]: `-${(r * 7).toFixed(2)}s`,
    ['--look-dur' as string]: `${8 + r * 6}s`, ['--look-delay' as string]: `-${(r * 13).toFixed(2)}s`,
    ['--breathe-dur' as string]: `${3.2 + r * 1.4}s`, ['--breathe-delay' as string]: `-${(r * 5).toFixed(2)}s`,
  } as React.CSSProperties;
  const { x, y, s } = c.face;
  const ex = 11.5 * s;
  return (
    <span
      className={`bot-avatar puff${working ? ' is-working' : ''}${still || tiny ? ' is-still' : ''} ${className ?? ''}`}
      style={{ width: size, height: size, ...timing }}
      title={title}
      role="img"
      aria-label={title}
    >
      <svg width={size} height={size} viewBox="-4 -4 108 108" style={{ overflow: 'visible' }} aria-hidden>
        <defs>
          <linearGradient id={bodyId} gradientUnits="userSpaceOnUse" x1="0" y1="10" x2="0" y2="96">
            <stop offset="0" stopColor={shade(base, darkBody ? 0.2 : 0.32)} />
            <stop offset="0.6" stopColor={base} />
            <stop offset="1" stopColor={shade(base, darkBody ? -0.1 : -0.1)} />
          </linearGradient>
          <radialGradient id={glossId} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity={darkBody ? 0.28 : 0.55} />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>
        {ring && <circle cx={50} cy={54} r={54} fill="none" stroke="#1C1C1C3D" strokeWidth={4} />}
        {!tiny && <ellipse className="puff__shadow" cx={50} cy={97} rx={30} ry={3.6} fill="#000000" opacity={0.16} />}
        <g className="puff__body">
          {c.body(paint)}
          {c.tuft?.(paint)}
          {/* A soft glossy spot, top left: the squishy look. */}
          {!tiny && <ellipse cx={34} cy={44} rx={13} ry={9} fill={`url(#${glossId})`} transform="rotate(-24 34 44)" />}
          {!tiny && <>
            <ellipse cx={x - ex - 7.5 * s} cy={y + 8 * s} rx={6 * s} ry={3.6 * s} fill={paint.cheek} opacity={0.6} />
            <ellipse cx={x + ex + 7.5 * s} cy={y + 8 * s} rx={6 * s} ry={3.6 * s} fill={paint.cheek} opacity={0.6} />
          </>}
          <g className="puff__eyes">
            {[-1, 1].map((side) => (
              <g key={side} className="puff__eye">
                <ellipse cx={x + side * ex} cy={y} rx={4.6 * s} ry={5.8 * s} fill={eye} />
                {!tiny && <circle cx={x + side * ex + 1.5 * s} cy={y - 2.2 * s} r={1.7 * s} fill={shine} />}
              </g>
            ))}
          </g>
          {!tiny && (c.catMouth
            ? <path d={`M${x - 5 * s} ${y + 7 * s} q${2.5 * s} ${3 * s} ${5 * s} 0 q${2.5 * s} ${3 * s} ${5 * s} 0`} stroke={eye} strokeWidth={2 * s} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            : <path className="puff__mouth" d={`M${x - 4 * s} ${y + 7.5 * s} Q${x} ${y + 11 * s} ${x + 4 * s} ${y + 7.5 * s}`} stroke={eye} strokeWidth={2 * s} strokeLinecap="round" fill="none" />)}
        </g>
      </svg>
      {star && (
        <span className="bot-avatar__star" style={{ width: size * 0.2667, height: size * 0.2667 }}>
          <Icon name="star" size={size * 0.1333} color="#FFFFFF" />
        </span>
      )}
    </span>
  );
}

/** Mix a #rrggbb colour towards white (amount > 0) or black (amount < 0). */
function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const to = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  const ch = (c: number) => Math.round(c + (to - c) * a).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

const rgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function luminance(hex: string): number {
  const c = rgb(hex);
  return c ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : 0;
}

const isDark = (hex: string) => luminance(hex) < 70;

/** Pinks and reds, where pink cheeks would vanish. */
function isRosy(hex: string): boolean {
  const c = rgb(hex);
  if (!c) return false;
  const [r, g, b] = c.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.2 || max !== r) return false;
  const hue = ((g - b) / (max - min) + 6) % 6 * 60;
  return hue < 18 || hue > 300;
}

export function BotAvatarFor({ bot, size, star, className }: { bot: Pick<Bot, 'avatarShape' | 'avatarColor' | 'name'> & { isPrimary?: boolean; id?: string }; size: number; star?: boolean; className?: string }) {
  const working = useStore((s) => !!(bot.id && s.live[bot.id]?.isRunning));
  return <BotAvatar shape={bot.avatarShape} color={bot.avatarColor} size={size} star={star} className={className} title={bot.name} working={working} />;
}
