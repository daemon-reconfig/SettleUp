// Per-device state: who you are in each group, and which groups you've opened.
export interface Profile { name: string; vpa: string }
export interface SavedGroup { id: string; name: string; me?: string; seenAt: number }

const read = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
};
const write = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
};

export const getProfile = () => read<Profile>('chukta:profile', { name: '', vpa: '' });
export const setProfile = (p: Profile) => write('chukta:profile', p);

export const getGroups = () => read<SavedGroup[]>('chukta:groups', []).sort((a, b) => b.seenAt - a.seenAt);
export function rememberGroup(id: string, name: string, me?: string) {
  const all = read<SavedGroup[]>('chukta:groups', []);
  const prev = all.find((g) => g.id === id);
  write('chukta:groups', [...all.filter((g) => g.id !== id), { id, name, me: me ?? prev?.me, seenAt: Date.now() }]);
}
export const forgetGroup = (id: string) => write('chukta:groups', read<SavedGroup[]>('chukta:groups', []).filter((g) => g.id !== id));
export const getMe = (groupId: string) => read<SavedGroup[]>('chukta:groups', []).find((g) => g.id === groupId)?.me;
