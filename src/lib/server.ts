// Where the API lives. On the web it's the site itself; inside the native apps the
// web bundle ships in the app, so the server address is baked in at build time
// (VITE_SERVER_URL) or entered once on first launch.
import { Capacitor } from '@capacitor/core';

export const platform = Capacitor.getPlatform(); // 'web' | 'ios' | 'android'
export const isNative = Capacitor.isNativePlatform();
const KEY = 'chukta:server';
const clean = (u: string) => u.trim().replace(/\/+$/, '');

export function serverUrl(): string {
  if (!isNative) return location.origin;
  const baked = import.meta.env.VITE_SERVER_URL as string | undefined;
  let saved = '';
  try { saved = localStorage.getItem(KEY) || ''; } catch { /* ignore */ }
  return clean(saved || baked || '');
}
export function setServerUrl(u: string) {
  try { localStorage.setItem(KEY, clean(u)); } catch { /* ignore */ }
}

/** Accepts "192.168.1.5:3001", "https://x.com" or a full group link. */
export function parseLink(input: string): { origin: string; groupId?: string } | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = (/^(localhost|[\d.]+)(:|\/|$)/.test(s) ? 'http://' : 'https://') + s;
  try {
    const u = new URL(s);
    return { origin: u.origin, groupId: u.pathname.match(/^\/g\/([\w-]+)/)?.[1] };
  } catch { return null; }
}

/** Liquid Glass on Apple devices, Material 3 Expressive on Android. `?ui=md|ios` overrides. */
export function pickUi(): 'ios' | 'md' {
  const forced = new URLSearchParams(location.search).get('ui');
  try {
    if (forced === 'md' || forced === 'ios') sessionStorage.setItem('chukta:ui', forced);
    const s = sessionStorage.getItem('chukta:ui');
    if (s === 'md' || s === 'ios') return s;
  } catch { /* ignore */ }
  return platform === 'android' || (platform === 'web' && /Android/i.test(navigator.userAgent)) ? 'md' : 'ios';
}
