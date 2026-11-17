// Free dictation with the browser's own speech recognition (Chrome, Edge, Safari). No server, no key.
// Tap the mic to start, tap again (or pause) to stop; the words go into the message box.
import { useCallback, useRef, useState } from 'react';

type Rec = { start(): void; stop(): void; abort(): void; lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null };

export const browserDictationSupported = () => typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

export function useBrowserDictation(onText: (t: string) => void, onError: (m: string) => void, language?: string) {
  const [recording, setRecording] = useState(false);
  const rec = useRef<Rec | null>(null);
  const toggle = useCallback(() => {
    if (rec.current) { rec.current.stop(); return; }
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) { onError('Dictation isn’t supported in this browser. Use your keyboard’s mic instead.'); return; }
    const r: Rec = new Ctor();
    r.lang = language && language !== 'auto' ? language : navigator.language || 'en-ZA';
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e: any) => {
      let t = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript;
      if (t.trim()) onText(t.trim());
    };
    r.onerror = (e: any) => { if (e?.error && e.error !== 'no-speech' && e.error !== 'aborted') onError(e.error === 'not-allowed' ? 'Allow the microphone for this site to dictate.' : `Dictation stopped: ${e.error}`); };
    r.onend = () => { rec.current = null; setRecording(false); };
    rec.current = r;
    setRecording(true);
    try { r.start(); } catch { rec.current = null; setRecording(false); }
  }, [onText, onError, language]);
  return { recording, toggle };
}
