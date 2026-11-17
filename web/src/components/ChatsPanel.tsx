import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bot, ChatInfo } from '@shared/types';
import { api } from '../lib/api';
import { relativeShort } from '../lib/time';
import { displayName, useStore } from '../store';
import { Menu } from './Menu';

/**
 * A bot's chats: open an older one, start a new one, rename, merge two into one, archive, delete.
 * Slides over the chat; full screen on a phone.
 */
export function ChatsPanel({ bot }: { bot: Bot }) {
  const set = useStore((s) => s.set);
  const version = useStore((s) => s.chatsVersion[bot.id] ?? 0);
  const running = useStore((s) => !!s.live[bot.id]?.isRunning);
  const [chats, setChats] = useState<ChatInfo[] | null>(null);
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [mode, setMode] = useState<{ kind: 'rename' | 'merge' | 'delete'; gen: number } | null>(null);
  const close = () => set({ chatsOpen: false });

  useEffect(() => {
    let alive = true;
    api.chats(bot.id).then((r) => alive && setChats(r.chats)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [bot.id, version]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !mode && menuFor === null) close(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (gen: number, action: Parameters<typeof api.chatAction>[2], body?: { title?: string; into?: number }) => {
    setError(null);
    try {
      const r = await api.chatAction(bot.id, gen, action, body);
      setChats(r.chats);
      setMode(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  const openChat = async (c: ChatInfo) => {
    if (c.current) { close(); return; }
    if (await act(c.generation, 'open')) close();
  };

  const newChat = async () => {
    setError(null);
    try { await api.fresh(bot.id); close(); } catch (e) { setError((e as Error).message); }
  };

  const archivedCount = chats?.filter((c) => c.archived).length ?? 0;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (chats ?? [])
      .filter((c) => (tab === 'archived' ? c.archived : !c.archived))
      .filter((c) => !q || c.title.toLowerCase().includes(q) || (c.preview ?? '').toLowerCase().includes(q));
  }, [chats, tab, query]);

  return (
    <>
      <div className="chats-scrim" onClick={close} aria-hidden />
      <aside className="chats" aria-label={`${displayName(bot)} chats`}>
        <div className="chats__top">
          <div className="chats__title">Chats with {bot.name}</div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close chats">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="chats__bar">
          <button type="button" className="cfg-btn cfg-btn--primary chats__new" onClick={newChat}>+ New chat</button>
          <input className="text-input chats__search" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search chats" />
        </div>
        <div className="segmented chats__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'is-active' : ''} onClick={() => setTab('active')}>Chats</button>
          <button type="button" role="tab" aria-selected={tab === 'archived'} className={tab === 'archived' ? 'is-active' : ''} onClick={() => setTab('archived')}>Archived{archivedCount ? ` (${archivedCount})` : ''}</button>
        </div>
        {error && <div className="cfg-error chats__error" role="alert">{error}</div>}
        <div className="chats__list">
          {chats === null && !error && <div className="chats__empty">Loading…</div>}
          {chats !== null && shown.length === 0 && (
            <div className="chats__empty">{query ? 'No chats match.' : tab === 'archived' ? 'Nothing archived.' : 'No chats yet.'}</div>
          )}
          {shown.map((c) => (
            <ChatItem
              key={c.generation}
              chat={c}
              others={(chats ?? []).filter((o) => o.generation !== c.generation)}
              running={running && c.current}
              menuOpen={menuFor === c.generation}
              mode={mode?.gen === c.generation ? mode.kind : null}
              onOpen={() => openChat(c)}
              onMenu={(v) => setMenuFor(v ? c.generation : null)}
              onMode={(k) => setMode(k ? { kind: k, gen: c.generation } : null)}
              onAct={(action, body) => act(c.generation, action, body)}
            />
          ))}
        </div>
        <div className="chats__foot">Merging adds one chat's messages to the end of another, and {bot.name} reads them on its next reply.</div>
      </aside>
    </>
  );
}

interface ItemProps {
  chat: ChatInfo;
  others: ChatInfo[];
  running: boolean;
  menuOpen: boolean;
  mode: 'rename' | 'merge' | 'delete' | null;
  onOpen: () => void;
  onMenu: (open: boolean) => void;
  onMode: (m: 'rename' | 'merge' | 'delete' | null) => void;
  onAct: (action: Parameters<typeof api.chatAction>[2], body?: { title?: string; into?: number }) => Promise<boolean>;
}

function ChatItem({ chat: c, others, running, menuOpen, mode, onOpen, onMenu, onMode, onAct }: ItemProps) {
  const [title, setTitle] = useState(c.title);
  const [into, setInto] = useState<number | ''>(() => others.find((o) => o.current)?.generation ?? others[0]?.generation ?? '');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (mode === 'rename') { setTitle(c.title); setTimeout(() => input.current?.select()); } }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const when = relativeShort(c.updatedAt);

  return (
    <div className={`chat-item${c.current ? ' is-current' : ''}`}>
      {mode === 'rename' ? (
        <form className="chat-item__edit" onSubmit={(e) => { e.preventDefault(); void onAct('rename', { title }); }}>
          <input ref={input} className="text-input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} aria-label="Chat name" />
          <button type="submit" className="cfg-btn cfg-btn--primary">Save</button>
          <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => onMode(null)}>Cancel</button>
        </form>
      ) : (
        <div className="chat-item__row">
          <button type="button" className="chat-item__main" onClick={onOpen}>
            <span className="chat-item__head">
              {c.current && <span className="chat-item__dot" aria-label="Open now" />}
              <span className="chat-item__title">{c.title}</span>
              <span className="chat-item__when">{when === 'now' ? 'now' : when}</span>
            </span>
            <span className="chat-item__preview">{c.preview ?? 'No messages yet'}</span>
            <span className="chat-item__meta">{c.messages} message{c.messages === 1 ? '' : 's'}{c.current ? ' · open now' : ''}{running ? ' · working' : ''}</span>
          </button>
          <span className="chat-item__more">
            <button type="button" className="icon-btn" aria-label={`More for ${c.title}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => onMenu(!menuOpen)}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><circle cx="3.5" cy="8" r="1.3" fill="currentColor" /><circle cx="8" cy="8" r="1.3" fill="currentColor" /><circle cx="12.5" cy="8" r="1.3" fill="currentColor" /></svg>
            </button>
            {menuOpen && (
              <Menu
                align="right"
                onClose={() => onMenu(false)}
                items={[
                  ...(!c.current ? [{ label: 'Open', onSelect: onOpen }] : []),
                  { label: 'Rename', onSelect: () => onMode('rename') },
                  ...(others.length && c.messages ? [{ label: 'Merge into another chat…', onSelect: () => onMode('merge') }] : []),
                  c.archived ? { label: 'Unarchive', onSelect: () => void onAct('unarchive') } : { label: 'Archive', onSelect: () => void onAct('archive') },
                  { label: 'Delete…', danger: true, onSelect: () => onMode('delete') },
                ]}
              />
            )}
          </span>
        </div>
      )}
      {mode === 'merge' && (
        <div className="chat-item__confirm">
          <label className="chat-item__label" htmlFor={`merge-${c.generation}`}>Add this chat's messages to:</label>
          <select id={`merge-${c.generation}`} className="text-input" value={into} onChange={(e) => setInto(Number(e.target.value))}>
            {others.map((o) => <option key={o.generation} value={o.generation}>{o.title}{o.current ? ' (open now)' : ''}{o.archived ? ' (archived)' : ''}</option>)}
          </select>
          <div className="chat-item__actions">
            <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => onMode(null)}>Cancel</button>
            <button type="button" className="cfg-btn cfg-btn--primary" disabled={into === ''} onClick={() => into !== '' && void onAct('merge', { into })}>Merge</button>
          </div>
        </div>
      )}
      {mode === 'delete' && (
        <div className="chat-item__confirm">
          <div className="chat-item__label">Delete “{c.title}” for good? Its messages can't be brought back.{c.current ? ' The bot moves to your most recent other chat.' : ''}</div>
          <div className="chat-item__actions">
            <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => onMode(null)}>Cancel</button>
            <button type="button" className="cfg-btn cfg-btn--danger" onClick={() => void onAct('delete')}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}
