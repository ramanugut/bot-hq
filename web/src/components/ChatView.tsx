import { useMemo, useState } from 'react';
import { BotAvatarFor } from '../avatar/BotAvatar';
import { api } from '../lib/api';
import { botVars } from '../lib/colors';
import { displayName, sortedRows, useSelectedBot, useStore } from '../store';
import { useConfigUI } from '../configStore';
import { ChatsPanel } from './ChatsPanel';
import { Composer } from './Composer';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { Transcript } from './Transcript';
import { VoiceCallBar } from './VoiceCallBar';

export function ChatView() {
  const bot = useSelectedBot();
  const transcript = useStore((s) => (bot ? s.transcripts[bot.id] : undefined));
  const live = useStore((s) => (bot ? s.live[bot.id] : undefined));
  const detailsOpen = useStore((s) => s.detailsOpen);
  const chatsOpen = useStore((s) => s.chatsOpen);
  const set = useStore((s) => s.set);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const rows = useMemo(() => sortedRows(transcript), [transcript]);

  if (!bot) {
    return (
      <main className="chat chat--empty">
        <div className="empty-chat"><div className="empty-chat__sub">No Bot selected.</div></div>
      </main>
    );
  }

  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(null), 2000); };

  return (
    <main className="chat" style={botVars(bot.avatarColor)}>
      <Transcript bot={bot} rows={rows} live={live} loaded={!!transcript?.loaded} />
      <VoiceCallBar />
      <Composer bot={bot} running={!!live?.isRunning} />
      <header className="chat__header">
        <button type="button" className="icon-btn icon-btn--bordered chat__menu-btn" onClick={() => set({ sidebarCollapsed: false })} aria-label="Show bots">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden><path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
        <span className="chat__pill-anchor">
          <button type="button" className="chat__pill" onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
            <BotAvatarFor bot={bot} size={24} />
            <span className="chat__pill-name">{displayName(bot)}</span>
          </button>
          {menu && (
            <Menu
              align="center"
              onClose={() => setMenu(false)}
              items={[
                { label: detailsOpen ? 'Hide details' : 'Show details', hint: '⇧⌘,', onSelect: () => set({ detailsOpen: !detailsOpen }) },
                { label: 'Open computer', onSelect: () => set({ viewerOpen: true, viewerMode: 'watch', viewerHint: null }) },
                { label: 'All chats', onSelect: () => set({ chatsOpen: true }) },
                { label: 'New chat', onSelect: () => api.fresh(bot.id).then(() => flash('Started a new chat')).catch((e) => flash(e.message)) },
                { label: 'Bot settings', onSelect: () => useConfigUI.getState().openBotSettings(bot.id) },
              ]}
            />
          )}
        </span>
        <div className="chat__header-right">
          <button type="button" className="icon-btn icon-btn--bordered chat__chats-btn" onClick={() => set({ chatsOpen: !chatsOpen })} aria-label="Chats" title="All chats with this Bot">
            <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden><path d="M3.5 4.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-3 2.5V12.5H3.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M6 8h6M6 10h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            <span>Chats</span>
          </button>
          {!detailsOpen && (
            <button type="button" className="icon-btn icon-btn--bordered" onClick={() => set({ detailsOpen: true })} aria-label="Show details" title="Show details">
              <Icon name="sidebar" opacity={0.66} style={{ transform: 'scaleX(-1)' }} />
            </button>
          )}
        </div>
      </header>
      {chatsOpen && <ChatsPanel bot={bot} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
