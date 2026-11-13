import { describe, expect, it } from 'vitest';
import { reduce, type Op, type Rec } from './ledger';

let n = 0;
const rec = (author: string, op: Op, ts = ++n): Rec => ({ id: `e${String(++n).padStart(4, '0')}`, author, ts, op });
const base = () => [
  rec('A', { t: 'group', name: 'Goa' }),
  rec('A', { t: 'member', id: 'dev', name: 'Dev', vpa: 'dev@okhdfc', claim: true }),
  rec('A', { t: 'member', id: 'rahul', name: 'Rahul', vpa: '' }),
];
const exp = (id: string, amount = 1000): Op => ({ t: 'expense', id, title: 'Dinner', emoji: '🍕', amount, paidBy: { dev: amount }, shares: { dev: amount / 2, rahul: amount / 2 }, split: { mode: 'equal', values: {} } });

describe('ledger', () => {
  it('is null until the group op arrives, and order-independent after', () => {
    const recs = [...base(), rec('A', exp('x1'))];
    expect(reduce(recs.slice(1), 'g')).toBeNull();
    expect(reduce([...recs].reverse(), 'g')).toEqual(reduce(recs, 'g'));
    expect(reduce(recs, 'g')!.expenses[0].createdBy).toBe('dev');
  });

  it('lets only the owner change a claimed member', () => {
    const recs = [...base(), rec('B', { t: 'member', id: 'dev', name: 'Dev', vpa: 'thief@upi' })];
    expect(reduce(recs, 'g')!.members[0].vpa).toBe('dev@okhdfc');
    recs.push(rec('A', { t: 'member', id: 'dev', name: 'Dev', vpa: 'dev2@upi' }));
    const m = reduce(recs, 'g')!.members[0];
    expect(m.vpa).toBe('dev2@upi');
    expect(m.vpaChanged).toBe(true);
  });

  it('claims: first device wins, one member per device, creator can release', () => {
    const recs = [...base(), rec('B', { t: 'member', id: 'rahul', name: 'Rahul', vpa: 'rahul@upi', claim: true }), rec('C', { t: 'member', id: 'rahul', name: 'Rahul', vpa: 'cc@upi', claim: true })];
    let g = reduce(recs, 'g')!;
    expect(g.members[1]).toMatchObject({ owner: 'B', vpa: 'rahul@upi' });
    recs.push(rec('A', { t: 'member', id: 'x', name: 'Extra', vpa: '', claim: true })); // A already owns dev
    expect(reduce(recs, 'g')!.members[2].owner).toBeUndefined();
    recs.push(rec('C', { t: 'member', id: 'rahul', name: '-', vpa: '', release: true })); // not the creator
    expect(reduce(recs, 'g')!.members[1].owner).toBe('B');
    recs.push(rec('A', { t: 'member', id: 'rahul', name: '-', vpa: '', release: true }));
    g = reduce(recs, 'g')!;
    expect(g.members[1].owner).toBeUndefined();
    expect(g.members[1].vpa).toBe('rahul@upi');
  });

  it('rejects expenses that do not add up or reference strangers', () => {
    const bad1: Op = { ...(exp('b1') as object), shares: { dev: 1 } } as unknown as Op;
    const bad2: Op = { ...(exp('b2') as object), paidBy: { ghost: 1000 } } as unknown as Op;
    const g = reduce([...base(), rec('A', bad1), rec('A', bad2), rec('A', exp('ok'))], 'g')!;
    expect(g.expenses.map((e) => e.id)).toEqual(['ok']);
  });

  it('deletes stick, and involved members cannot be removed', () => {
    const recs = [...base(), rec('A', exp('x1')), rec('A', { t: 'del', id: 'rahul' })];
    expect(reduce(recs, 'g')!.members).toHaveLength(2);
    recs.push(rec('B', { t: 'del', id: 'x1' }), rec('A', exp('x1')), rec('A', { t: 'del', id: 'rahul' }));
    const g = reduce(recs, 'g')!;
    expect(g.expenses).toHaveLength(0);
    expect(g.members).toHaveLength(1);
  });

  it('settlements are write-once', () => {
    const recs = [...base(), rec('B', { t: 'settle', id: 's1', from: 'rahul', to: 'dev', amount: 500 }), rec('C', { t: 'settle', id: 's1', from: 'rahul', to: 'dev', amount: 99999 })];
    expect(reduce(recs, 'g')!.settlements[0].amount).toBe(500);
  });
});
