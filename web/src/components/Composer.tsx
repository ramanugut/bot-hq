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

export function Composer({ bot, running }: { bot: Bot; running: boolean }) {
  const [text, setText] = useState(() => drafts.get(bot.id) ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const setModal = useStore((s) => s.setModal);
  const features = useStore((s) => s.features);
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<{ name: string; path: string }[]>([]);
  const [uploading, setUploading] = useState(0);
  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    for (const f of Array.from(list)) {
      setUploading((n) => n + 1);
      try { const r = await api.upload(bot.id, f); setFiles((cur) => [...cur, { name: r.name, path: r.path }]); }
      catch (e) { setError(`${f.name}: ${(e as Error).message}`); }
      finally { setUploading((n) => n - 1); }
    }
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
    let t = text.trim();
    if ((!t && !files.length) || sending || uploading) return;
    if (files.length) t = `${t || 'Here are some files.'}\n\nAttached files (saved on your computer):\n${files.map((f) => `- ${f.path}`).join('\n')}`;
    setSending(true); setError(null);
    try {
      await api.send(bot.id, t);
      setText('');
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

  const hasText = text.trim().length > 0 || files.length > 0;
  const multiline = text.includes('\n') || (ref.current?.scrollHeight ?? 0) > 30;

  return (
    <div className="composer-area">
      {error && <div className="composer__error">{error} <button type="button" className="link-btn" onClick={() => setError(null)}>Dismiss</button></div>}
      {(files.length > 0 || uploading > 0) && (
        <div className="composer__files">
          {files.map((f) => (
            <span key={f.path} className="composer__file">
              {f.name}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((x) => x.path !== f.path))}>×</button>
            </span>
          ))}
          {uploading > 0 && <span className="composer__file is-busy">Uploading…</span>}
        </div>
      )}
      <div className={`composer${multiline ? ' is-multiline' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void attach(e.dataTransfer.files); }}>
        <div className="composer__left">
          <span className="composer__plus-anchor">
            <button type="button" className="composer__btn" onClick={() => setMenu(!menu)} aria-label="More actions" aria-expanded={menu}>
              <Icon name="composer_plus" opacity={0.56} />
            </button>
            {menu && (
              <Menu
                placement="above"
                onClose={() => setMenu(false)}
                items={[
                  { label: 'Attach files', onSelect: () => fileRef.current?.click() },
                  ...RECIPES.map((r) => ({ label: r.label, onSelect: () => { setText(r.prompt); requestAnimationFrame(() => ref.current?.focus()); } })),
                  { label: 'New conversation', onSelect: fresh },
                  ...(features.apps ? [{ label: 'Connect apps', onSelect: () => setModal('apps') }] : []),
                ]}
              />
            )}
          </span>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { void attach(e.target.files); e.target.value = ''; }} />
          <textarea
            ref={ref}
            className="composer__input"
            rows={1}
            value={text}
            placeholder={`Message ${displayName(bot)}`}
            onChange={(e) => setText(e.target.value)}
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
