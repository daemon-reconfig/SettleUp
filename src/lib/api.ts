import type { Group } from './money';
import { serverUrl } from './server';

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${serverUrl()}/api${url}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('You seem to be offline. Try again in a moment.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data as T;
}

type G = Promise<Group>;
export const api = {
  health: (origin: string) => fetch(`${origin}/api/health`).then((r) => r.ok && r.json()).then((d) => !!d?.chukta, () => false),
  createGroup: (name: string, members: { name: string; vpa: string }[]): G => call('POST', '/groups', { name, members }),
  getGroup: (id: string): G => call('GET', `/groups/${id}`),
  renameGroup: (id: string, name: string): G => call('PATCH', `/groups/${id}`, { name }),
  addMember: (id: string, m: { name: string; vpa: string }): G => call('POST', `/groups/${id}/members`, m),
  updateMember: (id: string, mid: string, m: { name: string; vpa: string }): G => call('PATCH', `/groups/${id}/members/${mid}`, m),
  removeMember: (id: string, mid: string): G => call('DELETE', `/groups/${id}/members/${mid}`),
  saveExpense: (id: string, e: unknown, eid?: string): G =>
    eid ? call('PUT', `/groups/${id}/expenses/${eid}`, e) : call('POST', `/groups/${id}/expenses`, e),
  deleteExpense: (id: string, eid: string): G => call('DELETE', `/groups/${id}/expenses/${eid}`),
  settle: (id: string, s: { from: string; to: string; amount: number; createdBy: string }): G => call('POST', `/groups/${id}/settlements`, s),
  undoSettle: (id: string, sid: string): G => call('DELETE', `/groups/${id}/settlements/${sid}`),
};
