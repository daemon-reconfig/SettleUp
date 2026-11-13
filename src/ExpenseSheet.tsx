import { useMemo, useState } from 'react';
import { api } from './lib/sync';
import { computeShares, fmt, toPaise, toRupees, type Amounts, type Expense, type Group, type SplitMode } from './lib/money';
import { Avatar, Icon, Sheet, haptic, toast, useSheetClose } from './ui';

const MODES: { id: SplitMode; label: string; hint: string }[] = [
  { id: 'equal', label: 'Equal', hint: 'Split evenly between the people you pick.' },
  { id: 'exact', label: 'Exact', hint: 'Type what each person owes.' },
  { id: 'percent', label: '%', hint: 'Give each person a percentage.' },
  { id: 'shares', label: 'Shares', hint: 'Someone with 2 shares pays twice as much as someone with 1.' },
  { id: 'adjust', label: 'Adjust', hint: 'Add extras for some people; the rest is split evenly.' },
];

const EMOJI: [RegExp, string][] = [
  [/pizza|dinner|lunch|breakfast|brunch|food|restaurant|swiggy|zomato|biryani|dosa|meal|snack/i, '🍕'],
  [/chai|tea|coffee|cafe|starbucks/i, '☕'], [/beer|drink|bar|pub|wine|whisky|booze|party/i, '🍻'],
  [/uber|ola|cab|taxi|auto|rapido|metro|bus|train|toll/i, '🚕'], [/petrol|fuel|diesel/i, '⛽'],
  [/flight|air|trip|travel|hotel|stay|airbnb|hostel|villa/i, '✈️'], [/rent|flat|house|maid|deposit/i, '🏠'],
  [/grocer|blinkit|zepto|instamart|bigbasket|milk|vegetable|sabzi/i, '🛒'], [/movie|film|netflix|show|ticket|concert/i, '🎬'],
  [/wifi|internet|electric|bill|recharge|gas|water/i, '💡'], [/gift|birthday|cake/i, '🎁'], [/medic|doctor|pharma/i, '💊'],
];
const guessEmoji = (title: string) => EMOJI.find(([re]) => re.test(title))?.[1] ?? '🧾';

interface Props { group: Group; me: string; expense?: Expense; onGroup: (g: Group) => void; onClose: () => void }

export function ExpenseSheet(p: Props) {
  return <Sheet title={p.expense ? 'Expense' : 'New expense'} onClose={p.onClose}><Form {...p} /></Sheet>;
}

const num = (s: string | undefined) => { const n = parseFloat(s ?? ''); return Number.isFinite(n) ? n : 0; };
const paise = (s: string | undefined) => { const n = toPaise(s ?? ''); return Number.isFinite(n) ? n : 0; };
const strMap = (o: Record<string, number>, f: (n: number) => string) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));

function Form({ group, me, expense: ex, onGroup }: Props) {
  const close = useSheetClose();
  const members = group.members;
  const [amountStr, setAmountStr] = useState(ex ? toRupees(ex.amount) : '');
  const [title, setTitle] = useState(ex?.title ?? '');
  const exPayers = ex ? Object.keys(ex.paidBy) : [];
  const [payer, setPayer] = useState<string>(ex ? (exPayers.length === 1 ? exPayers[0] : 'multi') : me);
  const [paidStr, setPaidStr] = useState<Record<string, string>>(ex ? strMap(ex.paidBy, toRupees) : {});
  const [mode, setMode] = useState<SplitMode>(ex?.split.mode ?? 'equal');
  const [included, setIncluded] = useState<Set<string>>(() => new Set(ex ? Object.keys(ex.shares) : members.map((m) => m.id)));
  const [vals, setVals] = useState<Record<SplitMode, Record<string, string>>>(() => {
    const base: Record<SplitMode, Record<string, string>> = {
      equal: {}, exact: {}, percent: {}, adjust: {}, shares: Object.fromEntries(members.map((m) => [m.id, '1'])),
    };
    if (ex) base[ex.split.mode] = strMap(ex.split.values, ex.split.mode === 'exact' || ex.split.mode === 'adjust' ? toRupees : String);
    return base;
  });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const total = paise(amountStr);
  const picks = mode === 'equal' || mode === 'adjust';
  const people = useMemo(() => members.filter((m) => !picks || included.has(m.id)).map((m) => m.id), [members, picks, included]);
  const values = useMemo(() => {
    const money = mode === 'exact' || mode === 'adjust';
    return Object.fromEntries(people.map((id) => [id, money ? paise(vals[mode][id]) : num(vals[mode][id])]));
  }, [people, mode, vals]);
  const result = useMemo(() => computeShares(total, mode, people, values), [total, mode, people, values]);

  const paidBy: Amounts = payer === 'multi'
    ? Object.fromEntries(members.map((m) => [m.id, paise(paidStr[m.id])] as const).filter(([, n]) => n > 0))
    : { [payer]: total };
  const paidLeft = total - Object.values(paidBy).reduce((a, b) => a + b, 0);
  const paidErr = total > 0 && paidLeft !== 0 ? (paidLeft > 0 ? `${fmt(paidLeft)} of the bill isn’t paid by anyone yet` : `Payers add up to ${fmt(paidLeft)} too much`) : '';
  const error = total > 0 ? paidErr || result.error : '';
  const canSave = total > 0 && !paidErr && !result.error;

  const setVal = (id: string, v: string) => setVals((all) => ({ ...all, [mode]: { ...all[mode], [id]: v } }));
  const toggle = (id: string) => {
    haptic(5);
    setIncluded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const save = async () => {
    setBusy(true);
    try {
      const t = title.trim() || 'Expense';
      const body = { title: t, emoji: guessEmoji(t), amount: total, paidBy, shares: result.shares, split: { mode, values } };
      onGroup(await api.saveExpense(group.id, body, ex?.id));
      haptic([10, 40, 16]);
      close();
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    try { onGroup(await api.deleteExpense(group.id, ex!.id)); close(); } catch (e) { toast((e as Error).message); setBusy(false); }
  };

  const unit = mode === 'percent' ? '%' : mode === 'shares' ? '×' : mode === 'adjust' ? '+₹' : '₹';

  return (
    <>
      <div className="sheet-body">
        <label className="amount-input" style={{ fontSize: amountStr.length > 9 ? 38 : amountStr.length > 7 ? 46 : undefined }}>
          <span>₹</span>
          <input
            autoFocus={!ex} inputMode="decimal" placeholder="0" aria-label="Amount in rupees" value={amountStr}
            style={{ width: `calc(${Math.max(1, amountStr.length)}ch + 0.3em)` }}
            onChange={(e) => /^\d{0,8}(\.\d{0,2})?$/.test(e.target.value) && setAmountStr(e.target.value)}
          />
        </label>
        <div className="title-input">
          <input placeholder="What was it for?" aria-label="Description" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} enterKeyHint="done" />
        </div>

        <div className="group-label">Paid by</div>
        <div className="chips">
          {members.map((m) => (
            <button key={m.id} className={`chip${payer === m.id ? ' on' : ''}`} onClick={() => setPayer(m.id)} aria-pressed={payer === m.id}>
              <Avatar m={m} size={30} />{m.id === me ? 'You' : m.name}
            </button>
          ))}
          {members.length > 1 && <button className={`chip text${payer === 'multi' ? ' on' : ''}`} onClick={() => setPayer('multi')} aria-pressed={payer === 'multi'}>Multiple people</button>}
        </div>
        {payer === 'multi' && (
          <div className="card" style={{ marginTop: 12 }}>
            {members.map((m) => (
              <div className="row" key={m.id}>
                <Avatar m={m} />
                <div className="grow title ellipsis">{m.id === me ? 'You' : m.name}</div>
                <label className="mini-input"><span>₹</span><input inputMode="decimal" placeholder="0" aria-label={`Amount paid by ${m.name}`} value={paidStr[m.id] ?? ''} onChange={(e) => setPaidStr((s) => ({ ...s, [m.id]: e.target.value }))} /></label>
              </div>
            ))}
          </div>
        )}

        <div className="group-label">Split</div>
        <div className="seg" role="tablist">
          {MODES.map((m) => <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)}>{m.label}</button>)}
        </div>
        <p className="caption" style={{ margin: '8px 4px 12px' }}>{MODES.find((m) => m.id === mode)!.hint}</p>

        <div className="card">
          {members.map((m) => {
            const inc = !picks || included.has(m.id);
            const share = result.shares[m.id] ?? 0;
            const name = m.id === me ? 'You' : m.name;
            const tick = <span className={`tick${inc ? ' on' : ''}`}>{Icon.check}</span>;
            if (mode === 'equal') {
              return (
                <button className="row" key={m.id} onClick={() => toggle(m.id)} aria-pressed={inc}>
                  {tick}<Avatar m={m} size={36} />
                  <div className={`grow title ellipsis${inc ? '' : ' off'}`}>{name}</div>
                  <div className={`amt${inc ? '' : ' off'}`}>{inc && total > 0 ? fmt(share) : '—'}</div>
                </button>
              );
            }
            return (
              <div className="row" key={m.id}>
                {mode === 'adjust' && <button onClick={() => toggle(m.id)} aria-label={`Include ${m.name}`} aria-pressed={inc}>{tick}</button>}
                <Avatar m={m} size={36} />
                <div className={`grow${inc ? '' : ' off'}`}>
                  <div className="title ellipsis">{name}</div>
                  {mode !== 'exact' && <div className="sub num">{inc && total > 0 && !(mode === 'adjust' && result.error) ? fmt(share) : '—'}</div>}
                </div>
                <label className={`mini-input${inc ? '' : ' off'}`}>
                  {mode !== 'percent' && <span>{unit}</span>}
                  <input inputMode="decimal" placeholder="0" disabled={!inc} aria-label={`${MODES.find((x) => x.id === mode)!.label} for ${m.name}`} value={vals[mode][m.id] ?? ''} onChange={(e) => setVal(m.id, e.target.value)} />
                  {mode === 'percent' && <span>%</span>}
                </label>
              </div>
            );
          })}
        </div>
        {ex && <button className="btn danger" style={{ marginTop: 10 }} disabled={busy} onClick={remove}>{confirmDelete ? 'Tap again to delete' : 'Delete expense'}</button>}
      </div>
      <div className="sheet-foot">
        {error && <p className="status orange" role="status">{error}</p>}
        <button className="btn" disabled={!canSave || busy} onClick={save}>{ex ? 'Save changes' : total > 0 ? `Add ${fmt(total)}` : 'Add expense'}</button>
      </div>
    </>
  );
}
