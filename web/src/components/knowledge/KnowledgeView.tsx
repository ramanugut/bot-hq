import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ArrowLeft, BookOpen, FileText, History, ImageIcon, Link2, PanelLeft, Plus, Search, Upload, X } from 'lucide-react';
import { useStore } from '../../store';
import { ACCEPT, knowledgeApi, SecretWarning, type KnowledgeEntry, type KnowledgeEntrySummary, type KnowledgeSpace } from '../../lib/knowledgeApi';
import { relativeShort } from '../../lib/time';
import { formatBytes, shortDate } from '../config/ui';
import { Menu } from '../Menu';
import '../../styles/knowledge.css';

/** The Knowledge page: what the business knows, in spaces that Teammate bots can search. */
export function KnowledgeView() {
  const [spaces, setSpaces] = useState<KnowledgeSpace[] | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [entries, setEntries] = useState<KnowledgeEntrySummary[] | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone?: 'error' } | null>(null);
  const [pendingSecret, setPendingSecret] = useState<{ file: File; message: string } | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const space = spaces?.find((s) => s.id === spaceId) ?? null;
  const flash = useCallback((text: string, tone?: 'error') => { setNotice({ text, tone }); setTimeout(() => setNotice(null), 3500); }, []);

  const loadSpaces = useCallback(async () => {
    const s = await knowledgeApi.spaces();
    setSpaces(s);
    setSpaceId((cur) => cur ?? s[0]?.id ?? null);
  }, []);
  useEffect(() => { loadSpaces().catch((e) => flash(e.message, 'error')); }, [loadSpaces, flash]);

  const loadEntries = useCallback(async () => {
    if (!spaceId) return;
    setEntries(await knowledgeApi.entries(spaceId, q.trim()));
  }, [spaceId, q]);
  useEffect(() => {
    const t = setTimeout(() => { loadEntries().catch((e) => flash(e.message, 'error')); }, q ? 180 : 0);
    return () => clearTimeout(t);
  }, [loadEntries, q, flash]);

  const refresh = useCallback(() => { void loadEntries(); void loadSpaces(); }, [loadEntries, loadSpaces]);

  const uploadFiles = useCallback(async (files: File[], confirmed = false) => {
    if (!spaceId || !files.length) return;
    let last: KnowledgeEntry | null = null;
    for (const file of files) {
      setUploading((n) => n + 1);
      try {
        const r = await knowledgeApi.upload(spaceId, file, confirmed);
        last = r.entry;
        if (r.extracted === false) flash(`${file.name} was added, but no text could be read from it. Add a short description so bots can find it.`);
      } catch (e) {
        if (e instanceof SecretWarning) setPendingSecret({ file, message: e.message });
        else flash(`${file.name}: ${(e as Error).message}`, 'error');
      } finally { setUploading((n) => n - 1); }
    }
    refresh();
    if (last && files.length === 1) setOpen(last.id);
  }, [spaceId, flash, refresh]);

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); void uploadFiles([...e.dataTransfer.files]); };

  return (
    <main className={`chat kn${open ? ' has-entry' : ''}${dragging ? ' is-dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }} onDrop={onDrop}>
      <header className="kn__header">
        <button type="button" className="icon-btn kn__menu" onClick={() => useStore.getState().set({ sidebarCollapsed: false })} aria-label="Show bots"><PanelLeft size={18} strokeWidth={1.55} /></button>
        <div className="kn__title"><BookOpen size={18} strokeWidth={1.6} /> Knowledge</div>
        <label className="kn__search">
          <Search size={15} strokeWidth={1.6} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={space ? `Search ${space.name}` : 'Search'} aria-label="Search knowledge" />
          {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search"><X size={14} /></button>}
        </label>
        <span className="kn__add">
          <button type="button" className="btn btn--sm btn--primary" onClick={() => setAddMenu(!addMenu)} aria-expanded={addMenu} disabled={!space}>
            <Plus size={15} strokeWidth={1.8} /> <span className="kn__add-label">Add</span>
          </button>
          {addMenu && (
            <Menu align="right" onClose={() => setAddMenu(false)} items={[
              { label: 'Write an entry', icon: 'edit', onSelect: () => setOpen('new') },
              { label: 'Upload files', icon: 'paperclip', onSelect: () => fileRef.current?.click() },
            ]} />
          )}
        </span>
        <input ref={fileRef} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { void uploadFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </header>

      <nav className="kn__spaces" aria-label="Knowledge spaces">
        {spaces?.map((s) => (
          <button key={s.id} type="button" className={`kn__space${s.id === spaceId ? ' is-active' : ''}`} onClick={() => { setSpaceId(s.id); setOpen(null); }} aria-pressed={s.id === spaceId}>
            {s.name}{s.entries > 0 && <span className="kn__count">{s.entries}</span>}
          </button>
        ))}
      </nav>
      {space && <p className="kn__about">{space.description} Only Teammate bots use knowledge.</p>}

      {pendingSecret && (
        <div className="kn__warn" role="alert">
          <span>{pendingSecret.message}</span>
          <button type="button" className="btn btn--sm btn--secondary" onClick={() => setPendingSecret(null)}>Skip it</button>
          <button type="button" className="btn btn--sm btn--secondary" onClick={() => { const f = pendingSecret.file; setPendingSecret(null); void uploadFiles([f], true); }}>Add anyway</button>
        </div>
      )}

      <div className="kn__body">
        <section className="kn__list" aria-label="Entries">
          {uploading > 0 && <div className="kn__uploading">Adding {uploading} file{uploading === 1 ? '' : 's'}…</div>}
          {entries === null ? <div className="kn__empty-note">Loading…</div> : entries.length === 0 ? (
            q ? <div className="kn__empty-note">Nothing in {space?.name} matches “{q}”.</div> : (
              <div className="kn__empty">
                <span className="kn__empty-icon"><BookOpen size={26} strokeWidth={1.4} /></span>
                <div className="kn__empty-title">Teach your bots about your business</div>
                <div className="kn__empty-sub">Add your plans, prices, policies, how-tos and brand files. Teammate bots search here before they answer.</div>
                <div className="kn__empty-actions">
                  <button type="button" className="btn btn--sm btn--secondary" onClick={() => setOpen('new')}>Write an entry</button>
                  <button type="button" className="btn btn--sm btn--secondary" onClick={() => fileRef.current?.click()}><Upload size={14} /> Upload files</button>
                </div>
                <div className="kn__empty-hint">Logos, photos, PDF, Word and text files. You can also drop files here.</div>
              </div>
            )
          ) : entries.map((e) => (
            <button key={e.id} type="button" className={`kn__row${open === e.id ? ' is-open' : ''}`} onClick={() => setOpen(e.id)}>
              <span className="kn__thumb">{e.kind === 'image' ? <img src={knowledgeApi.fileUrl(e.id)} alt="" loading="lazy" /> : <FileText size={16} strokeWidth={1.5} />}</span>
              <span className="kn__row-text">
                <span className="kn__row-title">{e.title}</span>
                {e.snippet ? <span className="kn__row-snippet">{renderSnippet(e.snippet)}</span>
                  : <span className="kn__row-meta">{e.fileName ? `${e.fileName}${e.size ? ` · ${formatBytes(e.size)}` : ''} · ` : ''}{relativeShort(e.updatedAt)}{e.updatedBy !== 'you' ? ` · by ${e.updatedBy}` : ''}</span>}
              </span>
            </button>
          ))}
        </section>

        {open && spaceId && spaces && (
          <EntryPane key={open} id={open === 'new' ? null : open} spaceId={spaceId} spaces={spaces}
            onClose={() => setOpen(null)} onOpen={(id) => setOpen(id)}
            onSaved={(e) => { refresh(); setOpen(e.id); if (e.spaceId !== spaceId) setSpaceId(e.spaceId); }}
            onDeleted={() => { setOpen(null); refresh(); flash('Deleted'); }} flash={flash} />
        )}
      </div>

      {dragging && <div className="kn__drop">Drop files to add them to {space?.name}</div>}
      {notice && <div className={`kn__toast${notice.tone === 'error' ? ' is-error' : ''}`} role="status">{notice.text}</div>}
    </main>
  );
}

/** Search snippets mark matches with « »; show them highlighted. */
function renderSnippet(s: string) {
  return s.split(/(«[^»]*»)/g).map((part, i) => part.startsWith('«') ? <mark key={i}>{part.slice(1, -1)}</mark> : part);
}

function EntryPane({ id, spaceId, spaces, onClose, onOpen, onSaved, onDeleted, flash }: {
  id: string | null; spaceId: string; spaces: KnowledgeSpace[];
  onClose: () => void; onOpen: (id: string) => void; onSaved: (e: KnowledgeEntry) => void; onDeleted: () => void;
  flash: (t: string, tone?: 'error') => void;
}) {
  const [entry, setEntry] = useState<KnowledgeEntry | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [space, setSpace] = useState(spaceId);
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) { requestAnimationFrame(() => titleRef.current?.focus()); return; }
    knowledgeApi.entry(id).then((e) => { setEntry(e); setTitle(e.title); setBody(e.body); setSpace(e.spaceId); }).catch((e) => flash(e.message, 'error'));
  }, [id, flash]);

  const dirty = id ? !!entry && (title !== entry.title || body !== entry.body || space !== entry.spaceId) : title.trim() !== '' || body.trim() !== '';
  const canSave = dirty && title.trim() !== '' && !saving;

  const save = async (confirmed = false) => {
    setSaving(true);
    try {
      const e = id ? await knowledgeApi.update(id, { title, body, spaceId: space, confirmed }) : await knowledgeApi.create({ spaceId: space, title, body, confirmed });
      setSecret(null);
      setEntry(e);
      onSaved(e);
      flash('Saved');
    } catch (e) {
      if (e instanceof SecretWarning) setSecret(e.message);
      else flash((e as Error).message, 'error');
    } finally { setSaving(false); }
  };

  const restore = async (rev: number) => {
    if (!id) return;
    try {
      const e = await knowledgeApi.restore(id, rev);
      setEntry(e); setTitle(e.title); setBody(e.body); onSaved(e); flash('Restored. The version before is in the history too.');
    } catch (e) { flash((e as Error).message, 'error'); }
  };

  const spaceName = useMemo(() => new Map(spaces.map((s) => [s.id, s.name])), [spaces]);

  return (
    <section className="kn__pane" aria-label={id ? 'Entry' : 'New entry'}>
      <div className="kn__pane-bar">
        <button type="button" className="icon-btn kn__back" onClick={onClose} aria-label="Back to the list"><ArrowLeft size={17} strokeWidth={1.6} /></button>
        <select className="kn__space-pick" value={space} onChange={(e) => setSpace(e.target.value)} aria-label="Space">
          {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="kn__pane-spacer" />
        {id && entry && entry.revisions.length > 0 && (
          <button type="button" className={`link-btn${showHistory ? ' is-on' : ''}`} onClick={() => setShowHistory(!showHistory)}><History size={14} /> History</button>
        )}
        <button type="button" className="btn btn--sm btn--primary" disabled={!canSave} onClick={() => void save()}>{saving ? 'Saving…' : id ? 'Save' : 'Add'}</button>
      </div>

      {secret && (
        <div className="kn__warn" role="alert">
          <span>{secret}</span>
          <button type="button" className="btn btn--sm btn--secondary" onClick={() => void save(true)}>Save anyway</button>
        </div>
      )}

      <div className="kn__pane-scroll">
        <input ref={titleRef} className="kn__title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Business plan" maxLength={160} aria-label="Title" />
        {entry?.fileName && (
          entry.kind === 'image' ? (
            <a className="kn__image" href={knowledgeApi.fileUrl(entry.id)} target="_blank" rel="noreferrer"><img src={knowledgeApi.fileUrl(entry.id)} alt={entry.title} /></a>
          ) : (
            <a className="kn__file" href={knowledgeApi.fileUrl(entry.id, !/\.pdf$/i.test(entry.fileName))} target="_blank" rel="noreferrer">
              <FileText size={16} strokeWidth={1.5} /> <span>{entry.fileName}</span>{entry.size ? <span className="kn__file-size">{formatBytes(entry.size)}</span> : null}
            </a>
          )
        )}
        <textarea className="kn__body-input" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Text"
          placeholder={entry?.kind === 'image' ? 'Describe it, so bots can find and use it: e.g. "Main logo, white on transparent, for dark backgrounds."' : 'Write it as you would explain it to a new colleague. Link other entries with [[Their title]].'} />
        {entry && entry.links.length > 0 && (
          <div className="kn__links"><Link2 size={13} strokeWidth={1.6} />
            {entry.links.map((l) => l.id
              ? <button key={l.title} type="button" className="kn__link" onClick={() => onOpen(l.id!)}>{l.title}</button>
              : <span key={l.title} className="kn__link is-missing" title="No entry with this title yet">{l.title}</span>)}
          </div>
        )}
        {entry && (
          <div className="kn__meta">
            {entry.kind === 'image' ? <ImageIcon size={12} /> : <FileText size={12} />} Updated {shortDate(entry.updatedAt)} by {entry.updatedBy} · in {spaceName.get(entry.spaceId)}
          </div>
        )}
        {showHistory && entry && (
          <div className="kn__history">
            {entry.revisions.map((r) => (
              <div key={r.id} className="kn__rev">
                <span>{shortDate(r.at)} · {r.by}{r.title !== entry.title ? ` · “${r.title}”` : ''}</span>
                <button type="button" className="link-btn link-btn--small" onClick={() => void restore(r.id)}>Restore</button>
              </div>
            ))}
          </div>
        )}
        {id && (
          <div className="kn__danger">
            {confirmDelete ? (
              <>
                <span>Delete “{entry?.title}” for every bot?</span>
                <button type="button" className="btn btn--sm btn--secondary" onClick={() => setConfirmDelete(false)}>Keep</button>
                <button type="button" className="btn btn--sm kn__delete" onClick={() => knowledgeApi.remove(id).then(onDeleted).catch((e) => flash(e.message, 'error'))}>Delete</button>
              </>
            ) : <button type="button" className="link-btn link-btn--small" onClick={() => setConfirmDelete(true)}>Delete entry</button>}
          </div>
        )}
      </div>
    </section>
  );
}
