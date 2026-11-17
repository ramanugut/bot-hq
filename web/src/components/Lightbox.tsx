import { useEffect } from 'react';
import { create } from 'zustand';
import { Icon } from './Icon';

/**
 * Full-screen image viewer inside Botly. Images used to open as raw files in a new tab, which in the installed
 * phone app is a bare picture with no way back. This one always closes: the X, a tap outside the picture, Esc,
 * or the phone's back gesture (opening it adds a history entry that Back removes).
 */
interface LightboxState { src: string | null; alt: string; download?: string; open(src: string, alt?: string, download?: string): void; close(): void }

export const useLightbox = create<LightboxState>((set) => ({
  src: null,
  alt: '',
  open: (src, alt = '', download) => set({ src, alt, download }),
  close: () => set({ src: null }),
}));

/** Open an image in the viewer. */
export const openImage = (src: string, alt?: string, download?: string) => useLightbox.getState().open(src, alt, download);

export function Lightbox() {
  const { src, alt, download, close } = useLightbox();

  useEffect(() => {
    if (!src) return;
    // Back closes the viewer instead of leaving the app.
    history.pushState({ botlyLightbox: true }, '');
    const onPop = () => useLightbox.getState().close();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); history.back(); } };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [src]);

  if (!src) return null;
  // Closing by button or tap goes through history too, so the extra entry is removed.
  const dismiss = () => { if (history.state?.botlyLightbox) history.back(); else close(); };
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt || 'Image'} onClick={dismiss}>
      <img className="lightbox__img" src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
      <div className="lightbox__bar" onClick={(e) => e.stopPropagation()}>
        {download && <a className="lightbox__btn" href={download} download aria-label="Download"><Icon name="save" size={18} /></a>}
        <button type="button" className="lightbox__btn" onClick={dismiss} aria-label="Close" autoFocus><Icon name="close" size={20} /></button>
      </div>
      {alt && <div className="lightbox__caption" onClick={(e) => e.stopPropagation()}>{alt}</div>}
    </div>
  );
}
