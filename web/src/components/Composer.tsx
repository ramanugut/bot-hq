import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Bot } from '@shared/types';
import { api } from '../lib/api';
import { displayName, useStore } from '../store';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { endCall, isCallActive, startCall, useVoice } from '../voice/call';
import { useDictation } from '../voice/dictation';
import { browserDictationSupported, useBrowserDictation } from '../voice/browserDictation';

const MAX_H = 200;

/** Ready-made jobs: the text goes into the message box so you can adjust it before sending. */
const RECIPES = [
  { label: '✨ Social media autopilot', prompt: 'Set up a social media autopilot for my business [name, what we sell, prices, website]. Every Monday at 8am: plan 3 posts for the week (Facebook and Instagram), make an image for each with your image tool, write the captions, and show me the drafts here. Only post after I say yes, using the browser on your screen where I am logged in. Use create_routine for the weekly schedule.' },
  { label: '✨ Job search assistant', prompt: 'Help me find jobs. Profile: [role, years of experience, skills, location or remote, minimum salary]. My CV is attached. Every weekday at 7am: search the job sites (PNet, LinkedIn, Careers24, Indeed SA) for new matching jobs and send me the best 5 with links and why they fit. For any I approve, write a tailored CV and cover letter as PDFs in your Library. Never apply without my yes. Use create_routine for the daily search.' },
  { label: '✨ Support desk helper', prompt: 'Every morning at 8am, check [my support inbox or ticket system] in the browser on your screen, list the new tickets by urgency, and draft a reply for each. Show me the drafts here and only send the ones I approve. Use create_routine for the daily check.' },
  { label: '✨ Daily briefing', prompt: 'Every weekday at 7:30am send me a short briefing: the weather in [city], important new emails in my Gmail (open it in your browser), anything on my calendar today, and [anything else]. Keep it to 8 lines. Use create_routine for the schedule.' },
  { label: '✨ Promo video', prompt: 'Make a 15-second vertical promo video for [product/offer and price]: create 4 images with your image tool, then use make-video.py with short captions and a South African voice-over. Save it to the Library and show me.' },
];
const drafts = new Map<string, string>();

interface PickedFile { id: string; name: string; size: number; type: string; preview?: string; rel?: string; error?: string }

const fileIcon = (type: string, name: string) =>
  type.startsWith('audio/') ? '🎵' : /\.pdf$/i.test(name) ? '📄' : /\.(xlsx?|csv)$/i.test(name) ? '📊' : /\.(docx?|txt|md)$/i.test(name) ? '📝' : '📎';

export function Composer({ bot, running }: { bot: Bot; running: boolean }) {
  const [text, setText] = useState(() => drafts.get(bot.id) ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const setModal = useStore((s) => s.setModal);
  const features = useStore((s) => s.features);
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  /** Files picked for the next message: uploaded straight away, previewed from the device while they upload. */
  const [files, setFiles] = useState<PickedFile[]>([]);
  const uploading = files.filter((f) => !f.rel && !f.error).length;
  const attach = async (list: FileList | File[] | null) => {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    const items: PickedFile[] = picked.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: f.name || 'file', size: f.size, type: f.type,
      preview: /^(image|video)\//.test(f.type) ? URL.createObjectURL(f) : undefined,
    }));
    setFiles((cur) => [...cur, ...items]);
    await Promise.all(picked.map(async (f, i) => {
      const id = items[i].id;
      try {
        const r = await api.upload(bot.id, f);
        setFiles((cur) => cur.map((x) => (x.id === id ? { ...x, rel: r.rel, name: r.name } : x)));
      } catch (e) {
        setFiles((cur) => cur.map((x) => (x.id === id ? { ...x, error: (e as Error).message } : x)));
      }
    }));
  };
  const removeFile = (id: string) => setFiles((cur) => {
    const f = cur.find((x) => x.id === id);
    if (f?.preview) URL.revokeObjectURL(f.preview);
    return cur.filter((x) => x.id !== id);
  });
  // Pasting a screenshot or photo attaches it.
  const onPaste = (e: React.ClipboardEvent) => {
    const pasted = Array.from(e.clipboardData.files ?? []);
    if (pasted.length) { e.preventDefault(); void attach(pasted); }
  };

  // Per-bot drafts.
  useEffect(() => { setText(drafts.get(bot.id) ?? ''); setError(null); ref.current?.focus(); }, [bot.id]);
  useEffect(() => { drafts.set(bot.id, text); }, [bot.id, text]);

  // Auto-grow.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, MAX_H)}px`;
    el.style.overflowY = el.scrollHeight > MAX_H ? 'auto' : 'hidden';
  }, [text]);

  // ⌘I focuses the prompt.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const send = async () => {
    const t = text.trim();
    const ready = files.filter((f) => f.rel);
    if ((!t && !ready.length) || sending || uploading) return;
    setSending(true); setError(null);
    try {
      await api.send(bot.id, t, ready.map((f) => ({ name: f.name, path: f.rel!, size: f.size })));
      setText('');
      files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      setFiles([]);
      drafts.delete(bot.id);
    } catch (e) {
      setError((e as Error).message || 'Message failed to send');
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  };

  const stop = () => api.interrupt(bot.id).catch((e) => setError(e.message));
  const fresh = () => api.fresh(bot.id).catch((e) => setError(e.message));

  // Dictation: insert the transcript at the cursor.
  const insertText = (t: string) => {
    const el = ref.current;
    setText((cur) => {
      const start = el && document.activeElement === el ? el.selectionStart : cur.length;
      const end = el && document.activeElement === el ? el.selectionEnd : cur.length;
      const before = cur.slice(0, start);
      const after = cur.slice(end);
      const pre = before && !/\s$/.test(before) ? ' ' : '';
      const post = after && !/^\s/.test(after) ? ' ' : '';
      requestAnimationFrame(() => { if (el) { const pos = before.length + pre.length + t.length; el.focus(); el.setSelectionRange(pos, pos); } });
      return before + pre + t + post + after;
    });
  };
  const dictation = useDictation(insertText, setError, bot.voiceLanguage);
  const freeDictation = useBrowserDictation(insertText, setError, bot.voiceLanguage);
  const inCall = useVoice((s) => isCallActive(s) && s.botId === bot.id);

  const hasText = text.trim().length > 0 || files.some((f) => f.rel);
  const multiline = text.includes('\n') || (ref.current?.scrollHeight ?? 0) > 30;

  return (
    <div className="composer-area">
      {error && <div className="composer__error">{error} <button type="button" className="link-btn" onClick={() => setError(null)}>Dismiss</button></div>}
      {files.length > 0 && (
        <div className="composer__files">
          {files.map((f) => (
            <span key={f.id} className={`composer__file${f.preview ? ' has-thumb' : ''}${f.error ? ' is-error' : ''}${!f.rel && !f.error ? ' is-busy' : ''}`} title={f.error ?? f.name}>
              {f.preview && (f.type.startsWith('video/')
                ? <video className="composer__thumb" src={f.preview} muted playsInline preload="metadata" />
                : <img className="composer__thumb" src={f.preview} alt="" />)}
              {!f.preview && <span className="composer__file-name">{fileIcon(f.type, f.name)} {f.name}</span>}
              {!f.rel && !f.error && <span className="composer__spinner" aria-label="Uploading" />}
              {f.error && <span className="composer__file-err">Failed</span>}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => removeFile(f.id)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className={`composer${multiline ? ' is-multiline' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void attach(e.dataTransfer.files); }}>
        <div className="composer__left">
          <span className="composer__plus-anchor">
            <button type="button" className="composer__btn" onClick={() => setAttachOpen(!attachOpen)} aria-label="Attach" aria-expanded={attachOpen} title="Attach photos, videos or files">
              <svg width="19" height="19" viewBox="0 0 20 20" aria-hidden style={{ opacity: 0.6 }}><path d="M14.5 9.5 9.6 14.4a3.2 3.2 0 0 1-4.5-4.5l5.6-5.6a2.1 2.1 0 0 1 3 3l-5.6 5.6a1 1 0 0 1-1.5-1.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {attachOpen && (
              <Menu
                placement="above"
                onClose={() => setAttachOpen(false)}
                items={[
                  { label: '🖼️  Photos & videos', onSelect: () => galleryRef.current?.click() },
                  { label: '📷  Take a photo', onSelect: () => cameraRef.current?.click() },
                  { label: '📎  Files', onSelect: () => fileRef.current?.click() },
                ]}
              />
            )}
          </span>
          <span className="composer__plus-anchor">
            <button type="button" className="composer__btn" onClick={() => setMenu(!menu)} aria-label="More actions" aria-expanded={menu}>
              <Icon name="composer_plus" opacity={0.56} />
            </button>
            {menu && (
              <Menu
                placement="above"
                onClose={() => setMenu(false)}
                items={[
                  ...RECIPES.map((r) => ({ label: r.label, onSelect: () => { setText(r.prompt); requestAnimationFrame(() => ref.current?.focus()); } })),
                  { label: 'New conversation', onSelect: fresh },
                  ...(features.apps ? [{ label: 'Connect apps', onSelect: () => setModal('apps') }] : []),
                ]}
              />
            )}
          </span>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { void attach(e.target.files); e.target.value = ''; }} />
          <input ref={galleryRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void attach(e.target.files); e.target.value = ''; }} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void attach(e.target.files); e.target.value = ''; }} />
          <textarea
            ref={ref}
            className="composer__input"
            rows={1}
            value={text}
            placeholder={`Message ${displayName(bot)}`}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
            }}
            aria-label={`Message ${bot.name}`}
          />
        </div>
        <div className="composer__right">
          {features.voice ? (
          <button
            type="button"
            className={`composer__btn${dictation.state === 'recording' ? ' is-recording' : dictation.state === 'transcribing' ? ' is-transcribing' : ''}`}
            aria-label={dictation.state === 'recording' ? 'Stop dictation' : 'Dictate'}
            aria-pressed={dictation.state === 'recording'}
            title={dictation.state === 'recording' ? 'Release or click to stop · Esc cancels' : dictation.state === 'transcribing' ? 'Transcribing…' : 'Hold to dictate, or click to start'}
            disabled={dictation.state === 'transcribing'}
            onPointerDown={dictation.onPointerDown}
            onPointerUp={dictation.onPointerUp}
            onKeyDown={dictation.onKeyDown}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Icon name="mic" opacity={0.56} />
          </button>
          ) : browserDictationSupported() ? (
            <button type="button" className={`composer__btn${freeDictation.recording ? ' is-recording' : ''}`} onClick={freeDictation.toggle} aria-label={freeDictation.recording ? 'Stop dictation' : 'Dictate'} aria-pressed={freeDictation.recording} title={freeDictation.recording ? 'Tap to stop' : 'Tap to dictate'}>
              <Icon name="mic" opacity={0.56} />
            </button>
          ) : null}
          {inCall && !hasText ? (
            <button type="button" className="composer__cta is-in-call" onClick={endCall} aria-label="End voice call" title="End voice call">
              <Icon name="voice_a" size={16} />
            </button>
          ) : running && !hasText ? (
            <button type="button" className="composer__cta" onClick={stop} aria-label="Stop" title="Stop">
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button
              type="button"
              className="composer__cta"
              onClick={hasText ? send : features.voice ? () => startCall(bot.id) : () => ref.current?.focus()}
              disabled={(hasText && sending) || uploading > 0}
              aria-label={hasText ? 'Send' : `Start voice chat with ${bot.name}`}
              title={hasText ? 'Send (Enter)' : 'Start voice chat'}
            >
              <Icon name={hasText || !features.voice ? 'arrow_up' : 'voice_a'} size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
