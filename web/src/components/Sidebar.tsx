import { memo, useCallback, useEffect, useState } from 'react';
import { disablePush, enablePush, pushEnabled } from '../lib/push';
import { useConfigUI } from '../configStore';
import { TasksIsland } from './config/TasksView';
import type { Bot, LiveState } from '@shared/types';
import { activityStatus } from '../lib/phrases';
import { BotAvatarFor } from '../avatar/BotAvatar';
import { displayName, isPhone, useStore } from '../store';
import { api } from '../lib/api';
import { Icon } from './Icon';
import { Menu, shortcut } from './Menu';

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

const alertNote = (m: string) => { useStore.getState().set({ notice: m }); setTimeout(() => useStore.getState().set({ notice: null }), 5000); };
const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' } as const;
const NEXT_THEME = { system: 'light', light: 'dark', dark: 'system' } as const;

export function TrafficLights() {
  return (
    <div className="traffic-lights" aria-hidden>
      <span style={{ background: '#FF5F57' }} />
      <span style={{ background: '#FEBC2E' }} />
      <span style={{ background: '#28C840' }} />
    </div>
  );
}

/** What a working bot is doing, in the same words as its status line in the chat. */
const runningStatus = (l: LiveState | undefined) => (l?.isRunning ? activityStatus(l, []) : null);

function previewFor(bot: Bot, running: string | null, awaiting: string | null) {
  if (awaiting) return /^(waiting|needs you)\b/i.test(awaiting) ? awaiting : `Waiting for you: ${awaiting}`;
  if (running) return `${running}…`;
  return bot.lastPreview ?? 'No messages yet';
}

const BotRow = memo(function BotRow({ bot, selected, running, awaiting, onSelect, star }: { bot: Bot; selected: boolean; running: string | null; awaiting: string | null; onSelect: (id: string) => void; star?: boolean }) {
  return (
    <button type="button" className={`bot-row${selected ? ' is-selected' : ''}`} onClick={() => onSelect(bot.id)} aria-current={selected || undefined}>
      <span className="bot-row__avatar">
        <BotAvatarFor bot={bot} size={36} star={star} />
        {(running || awaiting || bot.unread > 0) && (
          <span className={`status-dot ${awaiting ? 'is-attention' : running ? 'is-working' : 'is-unread'}`} aria-label={awaiting ? 'Needs attention' : running ? 'Working' : 'Unread activity'} />
        )}
      </span>
      <span className="bot-row__text">
        <span className="bot-row__name">{displayName(bot)}</span>
        <span className="bot-row__preview">{previewFor(bot, running, awaiting)}</span>
      </span>
    </button>
  );
});

export function Sidebar() {
  const bots = useStore((s) => s.bots);
  const live = useStore((s) => s.live);
  const storeSelectedBotId = useStore((s) => s.selectedBotId);
  const inTasks = useConfigUI((s) => s.view === 'tasks');
  const selectedBotId = inTasks ? null : storeSelectedBotId; // nothing highlighted while the Tasks view is open
  const user = useStore((s) => s.user);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const set = useStore((s) => s.set);
  const features = useStore((s) => s.features);
  const theme = useConfigUI((s) => s.theme);
  const [notifOn, setNotifOn] = useState(false);
  useEffect(() => { void pushEnabled().then(setNotifOn).catch(() => {}); }, []);
  const storeSelectBot = useStore((s) => s.selectBot);
  // Picking a bot (even the one already selected) leaves the Tasks view.
  const selectBot = useCallback((id: string) => {
    const st = useStore.getState();
    const inChat = useConfigUI.getState().view === 'chat';
    useConfigUI.getState().setView('chat');
    // Clicking the bot that is already open shows its other chats.
    if (inChat && st.selectedBotId === id) st.set({ chatsOpen: isPhone() ? true : !st.chatsOpen });
    else storeSelectBot(id);
    if (isPhone()) useStore.getState().set({ sidebarCollapsed: true });
  }, [storeSelectBot]);
  const setModal = useStore((s) => s.setModal);
  const [accountMenu, setAccountMenu] = useState(false);
  const logout = async () => { await api.logout().catch(() => {}); location.reload(); };
  const downloadBackup = async () => {
    const password = window.prompt('This backup contains account sign-ins. Confirm your Botly password to download it:');
    if (!password) return;
    try {
      const res = await fetch('/api/backups/latest', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      if (!res.ok) {
        const error = await res.text();
        let message = error;
        try { message = (JSON.parse(error) as { error?: string }).error ?? error; } catch { /* plain text */ }
        throw new Error(message);
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'botly-backup.tar.gz';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = name;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      alertNote('Backup downloaded. Keep this sensitive archive secure.');
    } catch (e: any) { alertNote(`Backup failed: ${e?.message ?? e}`); }
  };

  const primary = bots.find((b) => b.isPrimary);
  const others = bots.filter((b) => !b.isPrimary).sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  return (
    <aside className={`sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <div className="sidebar__titlebar">
        <div className="sidebar__controls">
          <button type="button" className="icon-btn icon-btn--plain" onClick={() => set({ sidebarCollapsed: !collapsed })} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title="Toggle sidebar (⌘B)">
            <Icon name="sidebar" opacity={0.66} />
          </button>
          {!collapsed && (
            <>
              <span className="sidebar__brand"><img src="/icon.svg" alt="" />Botly</span>
              <button type="button" className="icon-btn" onClick={() => setModal('search')} aria-label="Search" title={`Search (${shortcut('⌘K')})`}>
                <Icon name="search" opacity={0.66} />
              </button>
              <button type="button" className="icon-btn" onClick={() => setModal('create')} aria-label="New Bot" title="New Bot">
                <Icon name="plus" opacity={0.66} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="sidebar__scroll">
        <TasksIsland />
        {primary && collapsed && (
          <div className="pinned">
            <button type="button" className={`pinned__tile${selectedBotId === primary.id ? ' is-selected' : ''}`} onClick={() => selectBot(primary.id)} title={displayName(primary)}>
              <span className="pinned__avatar">
                <BotAvatarFor bot={primary} size={collapsed ? 44 : 60} star />
                {live[primary.id]?.isRunning && <span className="status-dot is-working pinned__dot" />}
              </span>
              {!collapsed && <span className="pinned__label">{displayName(primary)}</span>}
            </button>
          </div>
        )}
        <div className="bot-list">
          {primary && !collapsed && (
            <BotRow bot={primary} star selected={selectedBotId === primary.id} running={runningStatus(live[primary.id])} awaiting={live[primary.id]?.awaiting?.reason ?? null} onSelect={selectBot} />
          )}
          {others.map((b) =>
            collapsed ? (
              <button key={b.id} type="button" className={`bot-rail-item${selectedBotId === b.id ? ' is-selected' : ''}`} onClick={() => selectBot(b.id)} title={displayName(b)}>
                <BotAvatarFor bot={b} size={36} />
              </button>
            ) : (
              <BotRow key={b.id} bot={b} selected={selectedBotId === b.id} running={runningStatus(live[b.id])} awaiting={live[b.id]?.awaiting?.reason ?? null} onSelect={selectBot} />
            ),
          )}
          {!collapsed && others.length === 0 && (
            <button type="button" className="bot-list__empty" onClick={() => setModal('create')}>
              <span className="bot-list__empty-plus"><Icon name="plus" size={14} opacity={0.66} /></span>
              <span>
                <span className="bot-row__name">Create a Bot</span>
                <span className="bot-row__preview">Give it a job, like research or inbox triage</span>
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="sidebar__footer">
        <div className="sidebar__fade" />
        {!collapsed && (
          <div className="account">
            <button type="button" className="account__btn" onClick={() => setAccountMenu(!accountMenu)} aria-haspopup="menu" aria-expanded={accountMenu} title={user?.email}>
              <span className="account__initials">{initials(user?.name ?? user?.email ?? '')}</span>
              <span className="account__name">{user?.name ?? user?.email}</span>
            </button>
            {accountMenu && (
              <Menu
                placement="above"
                onClose={() => setAccountMenu(false)}
                items={[
                  { label: 'Settings', hint: '⌘,', onSelect: () => useConfigUI.getState().openAppSettings() },
                  { label: notifOn ? 'Notifications: on' : 'Turn on notifications', onSelect: () => { (notifOn ? disablePush() : enablePush()).then((m) => { alertNote(m); void pushEnabled().then(setNotifOn); }).catch((e) => alertNote(String(e?.message ?? e))); } },
                  { label: 'Download backup', onSelect: () => { void downloadBackup(); } },
                  { label: `Appearance: ${THEME_LABEL[theme]}`, onSelect: () => useConfigUI.getState().setTheme(NEXT_THEME[theme]) },
                  ...(features.apps ? [{ label: 'Connect apps', onSelect: () => setModal('apps') }] : []),
                  { label: 'Log out', danger: true, onSelect: logout },
                ]}
              >
                <div className="menu__header">{user?.email}</div>
              </Menu>
            )}
          </div>
        )}
        {features.apps && (
          <button type="button" className="icon-btn icon-btn--bordered" onClick={() => setModal('apps')} aria-label="Connect apps" title="Connect apps">
            <Icon name="apps" />
          </button>
        )}
      </div>
    </aside>
  );
}
