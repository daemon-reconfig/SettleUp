import { describe, expect, it } from 'vitest';
import { computeShares, distribute, netBalances, simplifyDebts, toPaise, fmt } from './money';

const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe('distribute', () => {
  it('never loses a paisa', () => {
    expect(distribute(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
    expect(distribute(1, [1, 1, 1])).toEqual([1, 0, 0]);
    for (const t of [1, 99, 100, 12345, 999999]) expect(distribute(t, [3, 7, 11, 1]).reduce((a, b) => a + b)).toBe(t);
  });
});

describe('computeShares', () => {
  const p = ['a', 'b', 'c'];
  it('equal', () => {
    const r = computeShares(100000, 'equal', p, {});
    expect(r.error).toBeUndefined();
    expect(total(r.shares)).toBe(100000);
  });
  it('exact must add up', () => {
    expect(computeShares(1000, 'exact', p, { a: 500, b: 300 }).error).toMatch(/left/);
    expect(computeShares(1000, 'exact', p, { a: 500, b: 300, c: 200 }).shares).toEqual({ a: 500, b: 300, c: 200 });
    expect(computeShares(1000, 'exact', p, { a: 900, b: 300 }).error).toMatch(/over/);
  });
  it('percent', () => {
    const r = computeShares(999, 'percent', p, { a: 33.33, b: 33.33, c: 33.34 });
    expect(r.error).toBeUndefined();
    expect(total(r.shares)).toBe(999);
    expect(computeShares(999, 'percent', p, { a: 50 }).error).toMatch(/50% left/);
  });
  it('shares', () => {
    expect(computeShares(900, 'shares', p, { a: 2, b: 1 }).shares).toEqual({ a: 600, b: 300 });
  });
  it('adjust', () => {
    expect(computeShares(1000, 'adjust', p, { a: 100 }).shares).toEqual({ a: 400, b: 300, c: 300 });
    expect(computeShares(1000, 'adjust', p, { a: 2000 }).error).toBeDefined();
  });
});

describe('balances', () => {
  it('nets and simplifies', () => {
    const g = {
      members: ['a', 'b', 'c'].map((id) => ({ id, name: id, vpa: '' })),
      expenses: [
        { paidBy: { a: 900 }, shares: { a: 300, b: 300, c: 300 } },
        { paidBy: { b: 300 }, shares: { a: 150, b: 150 } },
      ] as never[],
      settlements: [{ from: 'c', to: 'a', amount: 100 }] as never[],
    };
    const net = netBalances(g);
    expect(net).toEqual({ a: 350, b: -150, c: -200 });
    const debts = simplifyDebts(net);
    expect(debts).toEqual([{ from: 'c', to: 'a', amount: 200 }, { from: 'b', to: 'a', amount: 150 }]);
  });
});

describe('formatting', () => {
  it('parses and formats', () => {
    expect(toPaise('1,234.5')).toBe(123450);
    expect(toPaise('0.1') + toPaise('0.2')).toBe(30);
    expect(fmt(12345600)).toBe('₹1,23,456');
    expect(fmt(1250)).toBe('₹12.50');
  });
});
