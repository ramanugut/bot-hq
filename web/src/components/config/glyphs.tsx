import type { CSSProperties } from 'react';
import { ArrowLeft, CheckCircle2, Download, FileText, Folder, ListTodo, Play, Settings2, Sparkles, Trash2 } from 'lucide-react';

/** One consistent, light-stroke icon language across Botly settings and tasks. */
const icons = {
  trash: Trash2, download: Download, folder: Folder, doc: FileText,
  gear: Settings2, play: Play, check_circle: CheckCircle2,
  spark: Sparkles, arrow_left: ArrowLeft, tasks: ListTodo,
} as const;

export type GlyphName = keyof typeof icons;

export function Glyph({ name, size = 16, opacity, style, className }: {
  name: GlyphName; size?: number; opacity?: number; style?: CSSProperties; className?: string;
}) {
  const Mark = icons[name];
  return <Mark aria-hidden size={size} strokeWidth={1.55} strokeLinecap="round" strokeLinejoin="round"
    className={className} style={{ opacity, flexShrink: 0, ...style }} />;
}
