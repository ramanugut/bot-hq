import { lazy, Suspense, useEffect } from 'react';
import { startEvents } from './lib/events';
import { useStore } from './store';
import { ChatView } from './components/ChatView';
import { ComputerViewer } from './components/ComputerViewer';
import { DetailsPanel } from './components/DetailsPanel';
import { Sidebar } from './components/Sidebar';
import { SignIn } from './components/SignIn';
import { ConfigLayer } from './components/config/ConfigLayer';
import { TasksView } from './components/config/TasksView';
import { useConfigUI } from './configStore';
import { startPresence } from './lib/push';
import { Lightbox } from './components/Lightbox';

// Dialogs load on first use, so the first screen arrives sooner. They are fetched quietly once the app is idle,
// so opening one still feels instant.
const loaders = {
  apps: () => import('./components/modals/ConnectAppsModal').then((m) => ({ default: m.ConnectAppsModal })),
  create: () => import('./components/modals/CreateBotModal').then((m) => ({ default: m.CreateBotModal })),
  group: () => import('./components/modals/CreateGroupModal').then((m) => ({ default: m.CreateGroupModal })),
  search: () => import('./components/modals/SearchModal').then((m) => ({ default: m.SearchModal })),
};
const ConnectAppsModal = lazy(loaders.apps);
const CreateBotModal = lazy(loaders.create);
const CreateGroupModal = lazy(loaders.group);
const SearchModal = lazy(loaders.search);

function prefetchWhenIdle() {
  const run = () => { for (const load of Object.values(loaders)) void load().catch(() => {}); void import('./components/config/ConfigLayer'); };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 4000 }); else setTimeout(run, 2500);
}

/** The browser tab says when a bot needs you or is working, so it shows from another tab. */
function useTabTitle() {
  const label = useStore((s) => {
    const waiting = s.bots.find((b) => s.live[b.id]?.awaiting);
    if (waiting) return `${waiting.name} needs you`;
    const sel = s.bots.find((b) => b.id === s.selectedBotId);
    if (sel && s.live[sel.id]?.isRunning) return `${sel.name} is working`;
    return null;
  });
  useEffect(() => { document.title = label ? `${label} · Botly` : 'Botly'; }, [label]);
}

function Shell() {
  useTabTitle();
  const detailsOpen = useStore((s) => s.detailsOpen);
  const modal = useStore((s) => s.modal);
  const viewerOpen = useStore((s) => s.viewerOpen);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const hasBot = useStore((s) => !!s.selectedBotId);
  const view = useConfigUI((s) => s.view);
  const notice = useStore((s) => s.notice);

  useEffect(() => {
    const st = useStore.getState();
    st.loadBots().catch(console.error);
    st.loadComputer().catch(console.error);
    const stop = startEvents();
    const stopPresence = startPresence();
    // Opened from a notification: go straight to that bot.
    const want = new URLSearchParams(location.search).get('bot');
    if (want) { st.selectBot(want); history.replaceState(null, '', '/'); }
    // OAuth popups post back here; refresh connection-dependent views and the open transcript.
    const onMsg = (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type !== 'botly-connected') return;
      const s = useStore.getState();
      s.set({ connectionsVersion: s.connectionsVersion + 1 });
      if (s.selectedBotId) s.loadRows(s.selectedBotId).catch(() => {});
    };
    window.addEventListener('message', onMsg);
    prefetchWhenIdle();
    return () => { stop(); stopPresence(); window.removeEventListener('message', onMsg); };
  }, []);

  // Global shortcuts: ⌘K search, ⌘B sidebar, ⇧⌘, details, ⌘N new bot.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const st = useStore.getState();
      const key = e.key.toLowerCase();
      if (key === 'k') { e.preventDefault(); st.setModal(st.modal === 'search' ? null : 'search'); }
      else if (key === 'b') { e.preventDefault(); st.set({ sidebarCollapsed: !st.sidebarCollapsed }); }
      else if (e.shiftKey && (key === ',' || key === '<')) { e.preventDefault(); st.set({ detailsOpen: !st.detailsOpen }); }
      else if (key === ',') { e.preventDefault(); useConfigUI.getState().openAppSettings(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  return (
    <div className={`app${collapsed ? ' is-sidebar-collapsed' : ''}${detailsOpen && hasBot && view === 'chat' ? ' has-details' : ''}`}>
      <Sidebar />
      {!collapsed && <div className="drawer-scrim" onClick={() => useStore.getState().set({ sidebarCollapsed: true })} aria-hidden />}
      {view === 'tasks' ? <TasksView /> : <ChatView />}
      {detailsOpen && hasBot && view === 'chat' && <DetailsPanel />}
      <Suspense fallback={null}>
        {modal === 'create' && <CreateBotModal />}
        {modal === 'group' && <CreateGroupModal />}
        {modal === 'search' && <SearchModal />}
        {modal === 'apps' && <ConnectAppsModal />}
      </Suspense>
      {viewerOpen && <ComputerViewer />}
      <ConfigLayer />
      {notice && <div className="app-notice" role="status">{notice}</div>}
      <Lightbox />
    </div>
  );
}

export function App() {
  const authChecked = useStore((s) => s.authChecked);
  const user = useStore((s) => s.user);
  useEffect(() => { useStore.getState().checkAuth(); }, []);
  // Same mark as the splash in index.html, so the hand-over from loading to checking sign-in does not flicker.
  if (!authChecked) return <div className="splash" aria-label="Loading Botly"><img src="/icon.svg" alt="" /></div>;
  return user ? <Shell /> : <SignIn />;
}
