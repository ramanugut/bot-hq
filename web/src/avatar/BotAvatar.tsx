import { useId } from 'react';
import type { AvatarColor, AvatarShape, Bot } from '@shared/types';
import { palette } from '../lib/colors';
import { Icon } from '../components/Icon';
import { useStore } from '../store';

/**
 * Robot avatars. Each bot is a little robot head in its own colour, with a dark visor and two
 * glowing eyes that blink and glance around on their own. Every animation is a CSS transform on a
 * few SVG nodes (no JavaScript timers), so dozens of avatars on screen cost next to nothing.
 * Each bot gets its own rhythm from its name, so a sidebar full of bots never blinks in unison.
 */

type Part = (fill: string, dark: string) => JSX.Element;
interface Robot {
  /** Head and anything bolted to it, drawn in the bot's colour. viewBox is 0 0 100 100. */
  head: Part;
  /** Visor rectangle the eyes sit in. */
  visor: { x: number; y: number; w: number; h: number; r: number };
}

const antenna = (fill: string, x = 50, top = 6, h = 14): JSX.Element => (
  <g className="robot__antenna">
    <rect x={x - 2} y={top + 5} width={4} height={h} rx={2} fill={fill} />
    <circle className="robot__antenna-tip" cx={x} cy={top + 4} r={5} fill={fill} />
  </g>
);

const ROBOTS: Record<string, Robot> = {
  // Round head with one antenna: the classic.
  blob: {
    head: (f) => <>{antenna(f)}<circle cx={50} cy={56} r={36} fill={f} /><rect x={8} y={48} width={8} height={18} rx={4} fill={f} /><rect x={84} y={48} width={8} height={18} rx={4} fill={f} /></>,
    visor: { x: 24, y: 40, w: 52, h: 30, r: 15 },
  },
  // Wide TV set with two antennas.
  cloud: {
    head: (f) => <><path d="M34 22 L24 8 M66 22 L76 8" stroke={f} strokeWidth={4} strokeLinecap="round" /><circle cx={24} cy={8} r={4} fill={f} /><circle cx={76} cy={8} r={4} fill={f} /><rect x={6} y={24} width={88} height={64} rx={18} fill={f} /></>,
    visor: { x: 16, y: 34, w: 68, h: 36, r: 12 },
  },
  // Boxy head with bolts on the sides.
  square: {
    head: (f, d) => <>{antenna(f)}<rect x={12} y={24} width={76} height={66} rx={14} fill={f} /><circle cx={9} cy={57} r={6} fill={f} /><circle cx={91} cy={57} r={6} fill={f} /><circle cx={9} cy={57} r={2.4} fill={d} /><circle cx={91} cy={57} r={2.4} fill={d} /></>,
    visor: { x: 22, y: 40, w: 56, h: 30, r: 9 },
  },
  // Head with two tall antennas.
  sparkle: {
    head: (f) => <>{antenna(f, 34, 2, 18)}{antenna(f, 66, 2, 18)}<rect x={12} y={26} width={76} height={64} rx={32} fill={f} /></>,
    visor: { x: 22, y: 42, w: 56, h: 28, r: 14 },
  },
  // Round head with big ear pods (headphones).
  clover: {
    head: (f) => <><path d="M18 50 A32 32 0 0 1 82 50" stroke={f} strokeWidth={5} fill="none" opacity={0.7} /><circle cx={50} cy={58} r={32} fill={f} /><rect x={4} y={44} width={16} height={30} rx={8} fill={f} /><rect x={80} y={44} width={16} height={30} rx={8} fill={f} /></>,
    visor: { x: 28, y: 44, w: 44, h: 28, r: 14 },
  },
  // Helmet with a wide visor.
  heart: {
    head: (f) => <><path d="M10 64 C10 30 30 14 50 14 C70 14 90 30 90 64 L90 76 C90 84 84 90 76 90 L24 90 C16 90 10 84 10 76 Z" fill={f} /><rect x={46} y={6} width={8} height={12} rx={4} fill={f} /></>,
    visor: { x: 18, y: 42, w: 64, h: 28, r: 14 },
  },
  // Dome with a little propeller.
  flower: {
    head: (f) => <><g className="robot__prop"><ellipse cx={50} cy={8} rx={18} ry={4} fill={f} /></g><rect x={47} y={8} width={6} height={12} rx={3} fill={f} /><path d="M12 62 A38 38 0 0 1 88 62 L88 80 C88 86 84 90 78 90 L22 90 C16 90 12 86 12 80 Z" fill={f} /></>,
    visor: { x: 22, y: 46, w: 56, h: 28, r: 14 },
  },
  // Tall capsule.
  teardrop: {
    head: (f) => <>{antenna(f)}<rect x={20} y={20} width={60} height={74} rx={30} fill={f} /></>,
    visor: { x: 28, y: 42, w: 44, h: 28, r: 14 },
  },
  // Screen face, like a tablet on a neck.
  tablet: {
    head: (f) => <><rect x={8} y={14} width={84} height={66} rx={12} fill={f} /><rect x={40} y={80} width={20} height={10} rx={3} fill={f} /><rect x={28} y={88} width={44} height={6} rx={3} fill={f} /></>,
    visor: { x: 16, y: 22, w: 68, h: 50, r: 6 },
  },
  // Angular head.
  wedge: {
    head: (f) => <>{antenna(f, 70, 4, 14)}<path d="M18 24 L82 24 L92 58 L80 90 L20 90 L8 58 Z" fill={f} strokeLinejoin="round" /></>,
    visor: { x: 20, y: 42, w: 60, h: 26, r: 8 },
  },
  // Rounded square with a ball antenna.
  house: {
    head: (f) => <>{antenna(f, 50, 2, 16)}<rect x={14} y={24} width={72} height={68} rx={24} fill={f} /></>,
    visor: { x: 24, y: 42, w: 52, h: 30, r: 15 },
  },
  // Orb with a halo ring.
  star: {
    head: (f) => <><g className="robot__halo"><ellipse cx={50} cy={58} rx={46} ry={11} fill="none" stroke={f} strokeWidth={4} opacity={0.55} /></g><circle cx={50} cy={54} r={34} fill={f} /></>,
    visor: { x: 26, y: 40, w: 48, h: 28, r: 14 },
  },
  // Hexagon head.
  hex: {
    head: (f) => <>{antenna(f)}<path d="M50 20 L84 38 L84 76 L50 94 L16 76 L16 38 Z" fill={f} strokeLinejoin="round" /></>,
    visor: { x: 24, y: 44, w: 52, h: 28, r: 12 },
  },
};

/** Older shape names (from bots made before these robots) map onto the closest robot. */
const ALIAS: Record<string, string> = {
  pebble: 'blob', bean: 'teardrop', egg: 'teardrop', squircle: 'house', capsule: 'teardrop', cylinder: 'tablet',
  gem: 'hex', crystal: 'hex', shield: 'heart', dome: 'flower', arch: 'heart', leaf: 'wedge',
};

export const robotFor = (shape: string): Robot => ROBOTS[shape] ?? ROBOTS[ALIAS[shape] ?? 'blob'] ?? ROBOTS.blob;

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
  /** Busy: eyes scan quickly and the antenna glows. */
  working?: boolean;
  /** Still: no blinking or glancing (e.g. tiny icons). */
  still?: boolean;
}

export function BotAvatar({ shape, color, size, star, ring, className, title, working, still }: Props) {
  const robot = robotFor(String(shape));
  // Pure black reads as a hole on a dark screen: black robots are graphite instead.
  const base = palette(color).fill.toUpperCase() === '#000000' ? '#262A32' : palette(color).fill;
  const darkBody = isDark(base);
  const visorFill = darkBody ? '#0E1014' : '#14161B';
  const eye = '#8FF3CF';
  // Soft top light: a lighter crown fading to a slightly deeper chin, the same for every part of the head.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const bodyId = `rb${uid}`;
  const glowId = `rg${uid}`;
  const fill = `url(#${bodyId})`;
  const r = seed(`${title ?? ''}${shape}${color}`);
  // Negative delays start each bot part-way through its loop; durations differ a little per bot.
  const timing = {
    ['--blink-dur' as string]: `${4.2 + r * 3}s`, ['--blink-delay' as string]: `-${(r * 7).toFixed(2)}s`,
    ['--look-dur' as string]: `${8 + r * 6}s`, ['--look-delay' as string]: `-${(r * 13).toFixed(2)}s`,
  } as React.CSSProperties;
  const v = robot.visor;
  const eyeW = v.w * 0.17;
  const eyeH = v.h * 0.52;
  const cy = v.y + v.h / 2;
  return (
    <span
      className={`bot-avatar robot${working ? ' is-working' : ''}${still || size < 18 ? ' is-still' : ''} ${className ?? ''}`}
      style={{ width: size, height: size, ...timing }}
      title={title}
      role="img"
      aria-label={title}
    >
      <svg width={size} height={size} viewBox="-4 -4 108 108" style={{ overflow: 'visible' }} aria-hidden>
        <defs>
          <linearGradient id={bodyId} gradientUnits="userSpaceOnUse" x1="0" y1="4" x2="0" y2="96">
            <stop offset="0" stopColor={shade(base, darkBody ? 0.16 : 0.22)} />
            <stop offset="0.55" stopColor={base} />
            <stop offset="1" stopColor={shade(base, -0.16)} />
          </linearGradient>
          <radialGradient id={glowId}>
            <stop offset="0" stopColor={eye} stopOpacity="0.5" />
            <stop offset="1" stopColor={eye} stopOpacity="0" />
          </radialGradient>
        </defs>
        {ring && <circle cx={50} cy={52} r={54} fill="none" stroke="#1C1C1C3D" strokeWidth={4} />}
        <g className="robot__body">
          {/* A hairline rim keeps every colour, dark ones included, distinct from the page. */}
          <g className="robot__head">{robot.head(fill, visorFill)}</g>
          <rect x={v.x} y={v.y} width={v.w} height={v.h} rx={v.r} fill={visorFill} />
          <ellipse className="robot__glow" cx={v.x + v.w / 2} cy={cy} rx={v.w * 0.46} ry={v.h * 0.5} fill={`url(#${glowId})`} />
          <g className="robot__eyes">
            <rect className="robot__eye" x={v.x + v.w * 0.3 - eyeW / 2} y={cy - eyeH / 2} width={eyeW} height={eyeH} rx={eyeW / 2} fill={eye} />
            <rect className="robot__eye" x={v.x + v.w * 0.7 - eyeW / 2} y={cy - eyeH / 2} width={eyeW} height={eyeH} rx={eyeW / 2} fill={eye} />
          </g>
          <rect x={v.x + v.w * 0.08} y={v.y + v.h * 0.12} width={v.w * 0.22} height={v.h * 0.14} rx={v.h * 0.07} fill="#FFFFFF" opacity={0.18} />
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

function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 70;
}

export function BotAvatarFor({ bot, size, star, className }: { bot: Pick<Bot, 'avatarShape' | 'avatarColor' | 'name'> & { isPrimary?: boolean; id?: string }; size: number; star?: boolean; className?: string }) {
  const working = useStore((s) => !!(bot.id && s.live[bot.id]?.isRunning));
  return <BotAvatar shape={bot.avatarShape} color={bot.avatarColor} size={size} star={star} className={className} title={bot.name} working={working} />;
}
