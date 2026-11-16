import type { CSSProperties } from 'react';
import {
  AppWindow, ArrowDown, ArrowUp, AudioLines, Camera, Check, ChevronDown, ChevronRight, Circle, Clock, Image, Sparkles, Volume2,
  Copy, Ellipsis, Eye, File, Headphones, Maximize2, MessageCircle, MessageSquareText, Mic, Minimize2, Monitor,
  MousePointer2, PanelLeft, Paperclip, Pencil, Plus, RefreshCw, Save, Search, Share2, Square, Star, X,
} from 'lucide-react';

const icons = {
  apps: AppWindow, arrow_down: ArrowDown, chat_filled: MessageCircle, chats: MessageSquareText, check: Check,
  chev_down: ChevronDown, chev_right: ChevronRight, clock: Clock, close: X,
  composer_plus: Plus, copy: Copy, edit: Pencil, file: File, mic: Mic, paperclip: Paperclip,
  plus: Plus, record: Circle, save: Save, search: Search, share: Share2, sidebar: PanelLeft,
  slack: MessageCircle, star: Star, voice_a: AudioLines, voice_b: Headphones, arrow_up: ArrowUp,
  stop: Square, more: Ellipsis, monitor: Monitor, refresh: RefreshCw, eye: Eye,
  pointer: MousePointer2, expand: Maximize2, shrink: Minimize2,
  sparkles: Sparkles, image: Image, camera: Camera, speaker: Volume2,
};

export type IconName = keyof typeof icons;
interface Props { name: IconName; size?: number; opacity?: number; className?: string; style?: CSSProperties; color?: string }

export function Icon({ name, size = 16, opacity, className, style, color }: Props) {
  const Glyph = icons[name];
  return <Glyph aria-hidden className={className} size={size} color={color} strokeWidth={1.55} strokeLinecap="round" strokeLinejoin="round"
    fill={name === 'chat_filled' || name === 'record' || name === 'stop' || name === 'star' ? 'currentColor' : 'none'}
    style={{ opacity, flexShrink: 0, ...style }} />;
}
