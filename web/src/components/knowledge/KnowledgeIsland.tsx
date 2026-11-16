import { BookOpen } from 'lucide-react';
import { useConfigUI } from '../../configStore';

/** Sidebar entry for the Knowledge page, under Tasks. Kept tiny: the page itself loads on first use. */
export function KnowledgeIsland() {
  const view = useConfigUI((s) => s.view);
  const on = view === 'knowledge';
  return (
    <button type="button" className={`sidebar-island${on ? ' is-active' : ''}`} onClick={() => useConfigUI.getState().setView(on ? 'chat' : 'knowledge')} title="Knowledge" aria-pressed={on}>
      <span className="sidebar-island__icon"><BookOpen size={18} strokeWidth={1.55} /></span>
      <span className="sidebar-island__label">Knowledge</span>
    </button>
  );
}
