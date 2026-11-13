// All money is integer paise. Never floats.
export type SplitMode = 'equal' | 'exact' | 'percent' | 'shares' | 'adjust';
export type Amounts = Record<string, number>;

export interface Member {
  id: string; name: string; vpa: string;
  /** Public key of the device that claimed this member ("this is me"). Only that device can edit them. */
  owner?: string;
  /** When the UPI ID was last set, by which device, and whether it replaced an earlier one. */
  vpaAt?: number; vpaBy?: string; vpaChanged?: boolean;
}
export interface Expense {
  id: string; title: string; emoji: string; amount: number;
  paidBy: Amounts; shares: Amounts;
  split: { mode: SplitMode; values: Record<string, number> };
  createdBy: string | null; createdAt: number;
}
export interface Settlement { id: string; from: string; to: string; amount: number; createdBy: string | null; createdAt: number }
export interface Group {
  id: string; name: string; createdAt: number;
  /** Public key of the device that created the group. */
  creator?: string | null;
  members: Member[]; expenses: Expense[]; settlements: Settlement[];
}
export interface Debt { from: string; to: string; amount: number }

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
/** ₹1,23,456 or ₹12.50 — drops ".00". */
export const fmt = (paise: number) => inr.format(Math.abs(paise) / 100).replace(/\.00$/, '');

/** "12.5" -> 1250. Returns NaN for junk. */
export function toPaise(input: string | number): number {
  const n = typeof input === 'number' ? input : parseFloat(String(input).replace(/[, ₹]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
export const toRupees = (paise: number) => (paise / 100).toFixed(2).replace(/\.00$/, '');

/** Split `total` paise proportionally to `weights`; leftover paise go to the largest remainders. */
export function distribute(total: number, weights: number[]): number[] {
  const wsum = weights.reduce((a, b) => a + b, 0);
  if (wsum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / wsum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length][1]]++;
  return out;
}

export interface SplitResult { shares: Amounts; error?: string }

/**
 * values meaning per mode:
 *  equal   – ignored
 *  exact   – paise each person owes
 *  percent – percent each person owes (must total 100)
 *  shares  – relative weights (2 shares pays twice 1 share)
 *  adjust  – extra paise on top of an equal split of the rest
 */
export function computeShares(total: number, mode: SplitMode, people: string[], values: Record<string, number>): SplitResult {
  const empty: SplitResult = { shares: {} };
  if (!(total > 0)) return { ...empty, error: 'Enter an amount' };
  if (!people.length) return { ...empty, error: 'Pick at least one person' };
  const v = (id: string) => (Number.isFinite(values[id]) ? values[id] : 0);
  const zip = (nums: number[]) => {
    const shares: Amounts = {};
    people.forEach((id, i) => { if (nums[i] > 0) shares[id] = nums[i]; });
    return shares;
  };

  switch (mode) {
    case 'equal':
      return { shares: zip(distribute(total, people.map(() => 1))) };
    case 'exact': {
      const nums = people.map((id) => Math.max(0, Math.round(v(id))));
      const diff = total - nums.reduce((a, b) => a + b, 0);
      if (diff !== 0) return { shares: zip(nums), error: diff > 0 ? `${fmt(diff)} left to assign` : `${fmt(diff)} over` };
      return { shares: zip(nums) };
    }
    case 'percent': {
      const pcts = people.map((id) => Math.max(0, v(id)));
      const psum = pcts.reduce((a, b) => a + b, 0);
      if (Math.abs(psum - 100) > 0.001) {
        const d = +(100 - psum).toFixed(2);
        return { shares: zip(distribute(Math.round((total * Math.min(psum, 100)) / 100), pcts)), error: d > 0 ? `${d}% left to assign` : `${-d}% over` };
      }
      return { shares: zip(distribute(total, pcts)) };
    }
    case 'shares': {
      const w = people.map((id) => Math.max(0, v(id)));
      if (w.reduce((a, b) => a + b, 0) <= 0) return { ...empty, error: 'Give at least one person a share' };
      return { shares: zip(distribute(total, w)) };
    }
    case 'adjust': {
      const adj = people.map((id) => Math.round(v(id)));
      const rest = total - adj.reduce((a, b) => a + b, 0);
      if (rest < 0) return { ...empty, error: `Adjustments are ${fmt(rest)} more than the total` };
      const nums = distribute(rest, people.map(() => 1)).map((b, i) => b + adj[i]);
      if (nums.some((n) => n < 0)) return { ...empty, error: 'Someone ends up below ₹0' };
      return { shares: zip(nums) };
    }
  }
}

/** Positive = is owed money, negative = owes money. */
export function netBalances(group: Pick<Group, 'members' | 'expenses' | 'settlements'>): Amounts {
  const net: Amounts = {};
  for (const m of group.members) net[m.id] = 0;
  const add = (id: string, n: number) => { net[id] = (net[id] || 0) + n; };
  for (const e of group.expenses) {
    for (const [id, n] of Object.entries(e.paidBy)) add(id, n);
    for (const [id, n] of Object.entries(e.shares)) add(id, -n);
  }
  for (const s of group.settlements) { add(s.from, s.amount); add(s.to, -s.amount); }
  return net;
}

/** Fewest-ish payments that clear everyone: repeatedly match biggest debtor with biggest creditor. */
export function simplifyDebts(net: Amounts): Debt[] {
  const debtors = Object.entries(net).filter(([, n]) => n < 0).map(([id, n]) => ({ id, n: -n }));
  const creditors = Object.entries(net).filter(([, n]) => n > 0).map(([id, n]) => ({ id, n }));
  const bySize = (a: { id: string; n: number }, b: { id: string; n: number }) => b.n - a.n || a.id.localeCompare(b.id);
  const out: Debt[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort(bySize); creditors.sort(bySize);
    const d = debtors[0], c = creditors[0];
    const amount = Math.min(d.n, c.n);
    out.push({ from: d.id, to: c.id, amount });
    d.n -= amount; c.n -= amount;
    if (!d.n) debtors.shift();
    if (!c.n) creditors.shift();
  }
  return out;
}
