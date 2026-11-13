import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import type { Member } from './lib/money';
import { isNative } from './lib/platform';

// ---- tiny helpers -------------------------------------------------------
export function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const AVATAR = ['#ff6b6b', '#f59f00', '#12b886', '#4c6ef5', '#be4bdb', '#15aabf', '#e64980', '#7950f2', '#fd7e14', '#2f9e44'];
const PASS = [['#1e3a8a', '#6d28d9'], ['#0f766e', '#1d4ed8'], ['#9d174d', '#7c2d12'], ['#3730a3', '#be185d'], ['#065f46', '#0e7490'], ['#b45309', '#be123c']];
export const passStyle = (id: string) => {
  const [a, b] = PASS[hash(id) % PASS.length];
  return { background: `linear-gradient(135deg, ${a}, ${b})` };
};

export function Avatar({ m, size = 40 }: { m: Pick<Member, 'id' | 'name'>; size?: number }) {
  const initials = m.name.trim().split(/\s+/).slice(0, 2).map((w) => [...w][0]?.toUpperCase()).join('');
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: AVATAR[hash(m.id) % AVATAR.length] }}>
      {initials}
    </span>
  );
}

/** A light tap by default; pass a pattern (array) for the "it worked" buzz. */
export const haptic = (pattern: number | number[] = 10) => {
  try {
    if (!isNative) navigator.vibrate?.(pattern);
    else if (Array.isArray(pattern)) Haptics.notification({ type: NotificationType.Success });
    else Haptics.impact({ style: ImpactStyle.Light });
  } catch { /* unsupported */ }
};

export const Icon = {
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>,
  close: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  share: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3m0 0L8 7m4-4l4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  checkCur: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  copy: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6a2 2 0 012-2h9" /></svg>,
  bell: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9a6 6 0 1112 0c0 6 2.5 7 2.5 7h-17S6 15 6 9zM10 20a2 2 0 004 0" /></svg>,
  link: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1" /></svg>,
  plus: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
};

export function CheckBurst() {
  return (
    <svg className="check-burst" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="46" />
      <path d="M30 52l14 14 27-30" />
    </svg>
  );
}

// ---- toast --------------------------------------------------------------
let pushToast: (msg: string) => void = () => {};
export const toast = (msg: string) => pushToast(msg);
export function Toaster() {
  const [t, setT] = useState<{ msg: string; key: number } | null>(null);
  useEffect(() => {
    pushToast = (msg) => setT({ msg, key: Date.now() });
  }, []);
  return t ? <div className="toast" key={t.key} role="status" onAnimationEnd={() => setT(null)}>{t.msg}</div> : null;
}

export async function shareOrCopy(data: { title?: string; text: string; url?: string }) {
  if (navigator.share) {
    try { await navigator.share(data); } catch { /* user cancelled */ }
    return;
  }
  await copy([data.text, data.url].filter(Boolean).join(' '), 'Copied — paste it in your group chat');
}
export async function copy(text: string, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    // Clipboard API needs HTTPS; fall back for plain-http testing on a local network.
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    toast(ok ? done : 'Couldn’t copy');
  }
}

// ---- bottom sheet -------------------------------------------------------
const SheetCtx = createContext<() => void>(() => {});
/** Animated close for anything rendered inside a <Sheet>. */
export const useSheetClose = () => useContext(SheetCtx);

export function Sheet({ title, onClose, children, action }: { title?: string; onClose: () => void; children: ReactNode; action?: ReactNode }) {
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const close = useCallback(() => setClosing(true), []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [close]);

  // drag the header down to dismiss
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return;
    drag.current = { y: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !panel.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    panel.current.style.transition = 'none';
    panel.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onUp = () => {
    if (!drag.current || !panel.current) return;
    const { dy } = drag.current;
    drag.current = null;
    if (dy > 110) return onClose();
    panel.current.style.transition = 'transform 0.35s var(--ease)';
    panel.current.style.transform = '';
  };

  return (
    <SheetCtx.Provider value={close}>
      <div
        className={`scrim${closing ? ' closing' : ''}`}
        onClick={(e) => e.target === e.currentTarget && close()}
        onAnimationEnd={(e) => closing && e.target === e.currentTarget && onClose()}
      >
        <div className="sheet" ref={panel} role="dialog" aria-modal="true" aria-label={title}>
          <div className="sheet-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <div className="grabber" />
            <div className="sheet-bar">
              <h2>{title}</h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {action}
                <button className="icon-btn" onClick={close} aria-label="Close">{Icon.close}</button>
              </div>
            </div>
          </div>
          {children}
        </div>
      </div>
    </SheetCtx.Provider>
  );
}
