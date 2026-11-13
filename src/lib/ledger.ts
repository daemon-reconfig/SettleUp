// The group ledger: an append-only list of signed operations, reduced into the
// current state. Every device runs the same reduction, so everyone agrees on the
// result no matter what order the operations arrived in.
import type { Amounts, Expense, Group, Member, Settlement, SplitMode } from './money';
import { VPA_RE } from './upi';

export type Op =
  | { t: 'group'; name: string }
  /** claim: "this is me" — ties the member to the author's device key. release: creator frees a claim. */
  | { t: 'member'; id: string; name: string; vpa: string; claim?: boolean; release?: boolean }
  | { t: 'expense'; id: string; title: string; emoji: string; amount: number; paidBy: Amounts; shares: Amounts; split: { mode: SplitMode; values: Record<string, number> } }
  | { t: 'settle'; id: string; from: string; to: string; amount: number }
  | { t: 'del'; id: string };

/** One decrypted, signature-checked operation. `author` is the signer's public key. */
export interface Rec { id: string; author: string; ts: number; op: Op }

const MAX_AMOUNT = 1e11;
const MODES = ['equal', 'exact', 'percent', 'shares', 'adjust'];
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const total = (o: Amounts) => Object.values(o).reduce((a, b) => a + b, 0);
const okId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

function amounts(v: unknown, has: (id: string) => boolean): Amounts | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Amounts = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (!has(k) || !Number.isInteger(n) || (n as number) < 0 || (n as number) > MAX_AMOUNT) return null;
    if ((n as number) > 0) out[k] = n as number;
  }
  return out;
}

type M = Member & { owner?: string };

/** Returns null until the group's first operation has arrived. */
export function reduce(recs: Iterable<Rec>, groupId: string): Group | null {
  const sorted = [...recs].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  let name: string | null = null;
  let creator: string | null = null;
  let createdAt = 0;
  const members = new Map<string, M>();
  const expenses = new Map<string, Expense & { byKey: string }>();
  const settlements = new Map<string, Settlement & { byKey: string }>();
  const deleted = new Set<string>();
  const involved = (mid: string) =>
    [...expenses.values()].some((e) => mid in e.paidBy || mid in e.shares) || [...settlements.values()].some((s) => s.from === mid || s.to === mid);

  for (const { op, author, ts, id: rid } of sorted) {
    if (!op || typeof op !== 'object' || !Number.isFinite(ts)) continue;
    switch (op.t) {
      case 'group': {
        const n = str(op.name, 60);
        if (!n) break;
        if (name === null) { creator = author; createdAt = ts; }
        name = n;
        break;
      }
      case 'member': {
        if (!okId(op.id) || deleted.has(op.id)) break;
        const cur = members.get(op.id);
        if (op.release) { if (cur && author === creator) cur.owner = undefined; break; }
        const n = str(op.name, 60);
        const vpa = typeof op.vpa === 'string' ? op.vpa.trim().toLowerCase() : '';
        if (!n || (vpa && !VPA_RE.test(vpa))) break;
        if (!cur && members.size >= 50) break;
        // Once someone has claimed a member, only their device can change it (so nobody can swap your UPI ID).
        if (cur?.owner && cur.owner !== author) break;
        let owner = cur?.owner;
        if (op.claim && !owner && ![...members.values()].some((m) => m.owner === author)) owner = author;
        const next: M = { id: op.id, name: n, vpa, owner, vpaAt: cur?.vpaAt, vpaBy: cur?.vpaBy, vpaChanged: cur?.vpaChanged };
        if (vpa !== (cur?.vpa ?? '')) { next.vpaAt = ts; next.vpaBy = author; next.vpaChanged = !!cur?.vpa; }
        members.set(op.id, next);
        break;
      }
      case 'expense': {
        if (!okId(op.id) || deleted.has(op.id) || settlements.has(op.id)) break;
        const has = (k: string) => members.has(k);
        const paidBy = amounts(op.paidBy, has), shares = amounts(op.shares, has);
        const title = str(op.title, 60);
        if (!title || !paidBy || !shares || !Number.isInteger(op.amount) || op.amount <= 0 || op.amount > MAX_AMOUNT) break;
        if (total(paidBy) !== op.amount || total(shares) !== op.amount) break;
        const mode = (MODES.includes(op.split?.mode) ? op.split.mode : 'exact') as SplitMode;
        const values: Record<string, number> = {};
        for (const [k, v] of Object.entries(op.split?.values ?? {})) if (has(k) && typeof v === 'number' && Number.isFinite(v)) values[k] = v;
        const cur = expenses.get(op.id);
        expenses.set(op.id, {
          id: op.id, title, emoji: typeof op.emoji === 'string' ? [...op.emoji].slice(0, 4).join('') : '🧾',
          amount: op.amount, paidBy, shares, split: { mode, values },
          createdAt: cur?.createdAt ?? ts, createdBy: null, byKey: cur?.byKey ?? author,
        });
        break;
      }
      case 'settle': {
        if (!okId(op.id) || deleted.has(op.id) || settlements.has(op.id) || expenses.has(op.id)) break;
        if (!members.has(op.from) || !members.has(op.to) || op.from === op.to) break;
        if (!Number.isInteger(op.amount) || op.amount <= 0 || op.amount > MAX_AMOUNT) break;
        settlements.set(op.id, { id: op.id, from: op.from, to: op.to, amount: op.amount, createdAt: ts, createdBy: null, byKey: author });
        break;
      }
      case 'del': {
        if (!okId(op.id)) break;
        const m = members.get(op.id);
        if (m) {
          if (involved(m.id) || (m.owner && m.owner !== author && author !== creator)) break;
          members.delete(m.id);
        } else if (!expenses.delete(op.id) && !settlements.delete(op.id)) break;
        deleted.add(op.id);
        break;
      }
    }
    void rid;
  }

  if (name === null) return null;
  const byKey = (k: string) => [...members.values()].find((m) => m.owner === k)?.id ?? null;
  const newest = <T extends { createdAt: number }>(xs: T[]) => xs.sort((a, b) => b.createdAt - a.createdAt);
  return {
    id: groupId, name, createdAt, creator,
    members: [...members.values()],
    expenses: newest([...expenses.values()].map(({ byKey: k, ...e }) => ({ ...e, createdBy: byKey(k) }))),
    settlements: newest([...settlements.values()].map(({ byKey: k, ...s }) => ({ ...s, createdBy: byKey(k) }))),
  };
}
