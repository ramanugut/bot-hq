import type { AvatarColor } from '@shared/types';

/**
 * Bot colors. `fill` is the avatar/swatch color, `bubble` the user message bubble, `action` the
 * accent for toggles and the send button, and `hover` its hover state.
 */
export interface BotPalette { fill: string; bubble: string; action: string; hover: string; /** Text on the action colour when white would be hard to read. */ onAction?: string }

export const BOT_COLORS: Record<AvatarColor, BotPalette> = {
  // Black follows the theme (ink on light, light ink on dark), so it uses tokens instead of hex.
  black: { fill: '#000000', bubble: 'var(--color-bubble-user)', action: 'var(--color-primary)', hover: 'var(--color-bg-primary-hover)' },
  brown: { fill: '#A06B39', bubble: '#86592E', action: '#9D6937', hover: '#86592E' },
  red: { fill: '#FB2B3E', bubble: '#C82532', action: '#E72E3B', hover: '#C82532' },
  orange: { fill: '#FD690F', bubble: '#D2550A', action: '#EE620D', hover: '#D2550A' },
  yellow: { fill: '#F59312', bubble: '#C2730B', action: '#DA830E', hover: '#C2730B' },
  green: { fill: '#14C16F', bubble: '#0D9655', action: '#10AB61', hover: '#0D9655' },
  cyan: { fill: '#13B7A2', bubble: '#0D9381', action: '#10A693', hover: '#0D9381' },
  blue: { fill: '#1E86FC', bubble: '#126FD4', action: '#1680F3', hover: '#126FD4' },
  violet: { fill: '#8F59F9', bubble: '#7442D1', action: '#8351E4', hover: '#7442D1' },
  magenta: { fill: '#F93498', bubble: '#C82779', action: '#E52F8B', hover: '#C82779' },
  gray: { fill: '#959595', bubble: '#6E6E6E', action: '#7A7A7A', hover: '#6E6E6E' },
  // Softer, sweeter colours for the puffs. Light ones get dark text on their buttons.
  peach: { fill: '#FFAE85', bubble: '#C9724A', action: '#F2955F', hover: '#C9724A', onAction: '#2A1A12' },
  coral: { fill: '#FF6F61', bubble: '#D14E42', action: '#F25F52', hover: '#D14E42' },
  blush: { fill: '#F9A8C9', bubble: '#C46A90', action: '#EE8DB6', hover: '#C46A90', onAction: '#2E1520' },
  lilac: { fill: '#C3A6F7', bubble: '#8566C4', action: '#AE8CF0', hover: '#8566C4', onAction: '#1F1530' },
  sky: { fill: '#6CCBF5', bubble: '#2E8DBA', action: '#4FB8E8', hover: '#2E8DBA', onAction: '#0E2230' },
  mint: { fill: '#7CE3C0', bubble: '#2F9C7A', action: '#5CD3AC', hover: '#2F9C7A', onAction: '#0B2219' },
  lemon: { fill: '#F5D85A', bubble: '#B08F14', action: '#EBC93A', hover: '#B08F14', onAction: '#2A2205' },
  lime: { fill: '#A8DC5C', bubble: '#5F9A1E', action: '#93CC42', hover: '#5F9A1E', onAction: '#16220A' },
  sage: { fill: '#9DBFA3', bubble: '#5C8063', action: '#86AE8D', hover: '#5C8063', onAction: '#12201A' },
  caramel: { fill: '#D9A066', bubble: '#A06A33', action: '#CC8E4E', hover: '#A06A33', onAction: '#2A1A0A' },
  berry: { fill: '#B4387A', bubble: '#8E2A5F', action: '#A4316E', hover: '#8E2A5F' },
  navy: { fill: '#4361C2', bubble: '#2F4A9E', action: '#3D58B5', hover: '#2F4A9E' },
  cream: { fill: '#EBDDBF', bubble: '#9C8A64', action: '#DCCBA6', hover: '#9C8A64', onAction: '#2A2414' },
};

/** Swatch order in the Create New Bot picker. */
export const COLOR_ORDER: AvatarColor[] = [
  'black', 'gray', 'cream', 'caramel', 'brown', 'peach', 'coral', 'red',
  'berry', 'magenta', 'blush', 'lilac', 'violet', 'navy', 'blue', 'sky',
  'cyan', 'mint', 'green', 'sage', 'lime', 'lemon', 'yellow', 'orange',
];

export const palette = (c: AvatarColor | string | undefined): BotPalette => BOT_COLORS[(c as AvatarColor) ?? 'black'] ?? BOT_COLORS.black;

/** CSS custom properties that theme a subtree with a bot's color. */
export function botVars(c: AvatarColor | string | undefined): React.CSSProperties {
  const p = palette(c);
  return {
    ['--bot-fill' as string]: p.fill, ['--bot-bubble' as string]: p.bubble, ['--bot-action' as string]: p.action, ['--bot-action-hover' as string]: p.hover,
    ['--bot-on-action' as string]: p === BOT_COLORS.black ? 'var(--color-on-primary)' : p.onAction ?? '#FFFFFF',
    ['--bot-action-soft' as string]: `color-mix(in srgb, ${p.action} 13%, transparent)`,
    ['--bot-action-text' as string]: p === BOT_COLORS.black ? 'var(--color-text-secondary)' : p.action,
  };
}
