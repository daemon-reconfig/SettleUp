import { Capacitor } from '@capacitor/core';

export const platform = Capacitor.getPlatform(); // 'web' | 'ios' | 'android'
export const isNative = Capacitor.isNativePlatform();

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

/**
 * Invite links point at the web version of the app. The group's key lives after the "#",
 * which browsers never send to any server.
 */
const PUBLIC_URL = (import.meta.env.VITE_PUBLIC_URL as string | undefined) || 'https://daemon-reconfig.github.io/SettleUp/';
export function inviteUrl(secret: string) {
  const base = isNative ? PUBLIC_URL : location.origin + location.pathname;
  return `${base}#/g/${secret}`;
}
/** Pull the group key out of a pasted invite link (or a bare key). */
export const parseInvite = (text: string) => text.match(/(?:\/g\/|^)([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/)?.[1] ?? null;
