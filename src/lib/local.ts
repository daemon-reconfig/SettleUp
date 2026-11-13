// Per-device conveniences: your name/UPI ID for prefilling, and which groups you've opened.
// A saved group's id is its secret key, so this list is what lets you back into your groups.
export interface Profile { name: string; vpa: string }
export interface SavedGroup { id: string; name: string; seenAt: number }

const read = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
};
const write = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
};

export const getProfile = () => read<Profile>('chukta:profile', { name: '', vpa: '' });
export const setProfile = (p: Profile) => write('chukta:profile', p);

export const getGroups = () => read<SavedGroup[]>('chukta:groups2', []).sort((a, b) => b.seenAt - a.seenAt);
export function rememberGroup(id: string, name: string) {
  write('chukta:groups2', [...read<SavedGroup[]>('chukta:groups2', []).filter((g) => g.id !== id), { id, name, seenAt: Date.now() }]);
}
export const forgetGroup = (id: string) => write('chukta:groups2', read<SavedGroup[]>('chukta:groups2', []).filter((g) => g.id !== id));
