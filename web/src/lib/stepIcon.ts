import { Bot, Clapperboard, Code2, FileText, Globe2, ImageIcon, MessageSquare, PenLine, Plug, Search, Sparkles, Wrench, type LucideIcon } from 'lucide-react';

/** A small icon for one tool step, from the tool's name: what kind of work it was, at a glance. */
export function stepIcon(toolName: string): LucideIcon {
  const t = toolName.toLowerCase();
  if (/(search|tavily_search|free_search|x_search)/.test(t)) return Search;
  if (/(extract|crawl|map|read|document|pdf)/.test(t)) return FileText;
  if (/(browser|navigate|click|screenshot|computer|scroll|type_text)/.test(t)) return Globe2;
  if (/(video|promo|render|preview_video)/.test(t)) return Clapperboard;
  if (/(image|photo|show_image)/.test(t)) return ImageIcon;
  if (/(terminal|shell|bash|exec|process|code|python)/.test(t)) return Code2;
  if (/(write|save|edit|patch|file|note|memory)/.test(t)) return PenLine;
  if (/(send_to_bot|message_bot|create_bot|room|group)/.test(t)) return Bot;
  if (/(send|reply|email|slack|message)/.test(t)) return MessageSquare;
  if (/(composio|connect|app|calendar|gmail|drive|sheet)/.test(t)) return Plug;
  if (/(think|plan|todo|routine|schedule)/.test(t)) return Sparkles;
  return Wrench;
}
