import { useEffect, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
/** Shortcut hints are written Mac-style (⇧⌘,); other computers press Ctrl. */
export const shortcut = (hint: string) => (MAC ? hint : hint.replace('⇧', 'Shift+').replace('⌘', 'Ctrl+').replace('Shift+Ctrl+', 'Ctrl+Shift+'));

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean; hint?: string; icon?: IconName }

/** Small popover menu anchored by its parent (position: relative). Closes on outside click / Escape. */
export function Menu({ items, onClose, align = 'left', placement = 'below', children }: { items: MenuItem[]; onClose: () => void; align?: 'left' | 'right' | 'center'; placement?: 'below' | 'above'; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const t = setTimeout(() => document.addEventListener('mousedown', down));
    document.addEventListener('keydown', key, true);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true); };
  }, [onClose]);
  return (
    <div ref={ref} className={`menu is-${align} is-${placement}`} role="menu">
      {children}
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" className={`menu__item${it.danger ? ' is-danger' : ''}`} onClick={() => { onClose(); it.onSelect(); }}>
          {it.icon && <Icon name={it.icon} size={15} opacity={0.7} />}
          <span>{it.label}</span>
          {it.hint && <span className="menu__hint">{shortcut(it.hint)}</span>}
        </button>
      ))}
    </div>
  );
}
