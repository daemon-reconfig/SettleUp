import { useEffect, useMemo, useState } from 'react';
import { navigate } from './App';
import { api } from './lib/api';
import { forgetGroup, getMe, getProfile, rememberGroup, setProfile } from './lib/local';
import { fmt, netBalances, simplifyDebts, type Debt, type Expense, type Group, type Settlement } from './lib/money';
import { isVpa } from './lib/upi';
import { serverUrl } from './lib/server';
import { ExpenseSheet } from './ExpenseSheet';
import { PaySheet } from './PaySheet';
import { PeopleSheet } from './PeopleSheet';
import { Avatar, Icon, Sheet, passStyle, shareOrCopy, toast, useSheetClose } from './ui';

function useGroup(id: string) {
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () => api.getGroup(id).then((g) => alive && setGroup(g), (e) => alive && setError(e.message));
    load();
    const es = new EventSource(`${serverUrl()}/api/groups/${id}/events`); // live updates from everyone else
    es.onmessage = load;
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; es.close(); document.removeEventListener('visibilitychange', onVisible); };
  }, [id]);
  return { group, setGroup, error };
}

type SheetState =
  | { kind: 'expense'; expense?: Expense } | { kind: 'pay'; debt: Debt }
  | { kind: 'people'; focus?: string } | { kind: 'settlement'; s: Settlement } | null;

const day = (t: number) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function GroupScreen({ id }: { id: string }) {
  const { group, setGroup, error } = useGroup(id);
  const [me, setMe] = useState(() => getMe(id));
  const [sheet, setSheet] = useState<SheetState>(null);

  useEffect(() => { if (group) rememberGroup(group.id, group.name, me); }, [group?.id, group?.name, me]);

  const net = useMemo(() => (group ? netBalances(group) : {}), [group]);
  const debts = useMemo(() => simplifyDebts(net), [net]);

  if (!group) {
    if (!error) return <div className="spinner" role="status" aria-label="Loading" />;
    return (
      <div className="page">
        <div className="empty" style={{ marginTop: '22vh' }}>
          <div className="glyph">🫥</div>
          <h2 style={{ color: 'var(--text)' }}>Can’t open this group</h2>
          <p style={{ margin: '6px 0 20px' }}>{error}</p>
          <button className="btn secondary" onClick={() => { if (/not found/i.test(error)) forgetGroup(id); navigate('/'); }}>Go home</button>
        </div>
      </div>
    );
  }

  const meMember = group.members.find((m) => m.id === me);
  if (!meMember) return <Join group={group} onJoined={(g, mid) => { setGroup(g); setMe(mid); }} />;

  const name = (mid: string) => (mid === me ? 'You' : group.members.find((m) => m.id === mid)?.name ?? 'Someone');
  const member = (mid: string) => group.members.find((m) => m.id === mid) ?? { id: mid, name: '?', vpa: '' };
  const myNet = net[me!] ?? 0;
  const toPay = debts.filter((d) => d.from === me);
  const toGet = debts.filter((d) => d.to === me);
  const others = debts.filter((d) => d.from !== me && d.to !== me);
  const spent = group.expenses.reduce((a, e) => a + e.amount, 0);
  const url = `${serverUrl()}/g/${group.id}`;

  const activity = [
    ...group.expenses.map((e) => ({ t: e.createdAt, e, s: undefined as Settlement | undefined })),
    ...group.settlements.map((s) => ({ t: s.createdAt, s, e: undefined as Expense | undefined })),
  ].sort((a, b) => b.t - a.t);

  const invite = () => shareOrCopy({ title: group.name, text: `Join “${group.name}” on Chukta — split expenses and pay each other in one tap:`, url });
  const remind = (d: Debt) => shareOrCopy({ text: `Hey ${name(d.from)}, you owe me ${fmt(d.amount)} for “${group.name}”. Pay in one tap here:`, url });

  return (
    <div className="page">
      <div className="nav">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="All groups">{Icon.back}</button>
        <span className="grow" />
        <button className="avatars" onClick={() => setSheet({ kind: 'people' })} aria-label="People in this group">
          <span className="stack">{group.members.slice(0, 4).map((m) => <Avatar key={m.id} m={m} size={30} />)}</span>
          {group.members.length}
        </button>
        <button className="icon-btn" onClick={invite} aria-label="Invite friends">{Icon.share}</button>
      </div>

      <div className="pass" style={passStyle(group.id)}>
        <div className="top"><span className="name">{group.name}</span><span className="mark">CHUKTA</span></div>
        <div>
          <div className="label">{myNet < 0 ? 'You owe' : myNet > 0 ? 'You’re owed' : 'All settled'}</div>
          <div className="big">{myNet === 0 ? '₹0' : fmt(myNet)}</div>
          <div className="foot">{group.expenses.length ? `${fmt(spent)} spent across ${group.expenses.length} expense${group.expenses.length > 1 ? 's' : ''}` : 'No expenses yet'}</div>
        </div>
      </div>

      {!meMember.vpa && (
        <button className="banner" onClick={() => setSheet({ kind: 'people', focus: me })}>
          <span style={{ fontSize: 26 }}>🪪</span>
          <span className="grow"><b>Add your UPI ID</b><span className="small muted">So friends can pay you in one tap</span></span>
          <span className="pill">Add</span>
        </button>
      )}

      {toPay.length > 0 && (
        <>
          <h2 className="section-title">Pay</h2>
          <div className="card">
            {toPay.map((d) => (
              <div className="row" key={d.to}>
                <Avatar m={member(d.to)} />
                <div className="grow"><div className="title ellipsis">{name(d.to)}</div><div className="sub num">{fmt(d.amount)}</div></div>
                <button className="pill" onClick={() => setSheet({ kind: 'pay', debt: d })}>Pay</button>
              </div>
            ))}
          </div>
        </>
      )}

      {toGet.length > 0 && (
        <>
          <h2 className="section-title">Owed to you</h2>
          <div className="card">
            {toGet.map((d) => (
              <div className="row" key={d.from}>
                <Avatar m={member(d.from)} />
                <div className="grow"><div className="title ellipsis">{name(d.from)}</div><div className="sub num green">{fmt(d.amount)}</div></div>
                <button className="pill soft icon" onClick={() => remind(d)} aria-label={`Remind ${name(d.from)}`}>{Icon.bell}</button>
                <button className="pill soft icon" onClick={() => setSheet({ kind: 'pay', debt: d })} aria-label={`Mark ${name(d.from)} as paid`}>{Icon.checkCur}</button>
              </div>
            ))}
          </div>
        </>
      )}

      {others.length > 0 && (
        <>
          <h2 className="section-title">Between others</h2>
          <div className="card">
            {others.map((d) => (
              <button className="row" key={d.from + d.to} onClick={() => setSheet({ kind: 'pay', debt: d })}>
                <Avatar m={member(d.from)} />
                <div className="grow"><div className="title ellipsis">{name(d.from)}</div><div className="sub ellipsis">owes {name(d.to)}</div></div>
                <div className="amt">{fmt(d.amount)}</div>
              </button>
            ))}
          </div>
        </>
      )}

      <h2 className="section-title">Activity</h2>
      {activity.length === 0 ? (
        <div className="card empty">
          <div className="glyph">🧾</div>
          <p>Add the first expense and everyone’s share shows up here, ready to pay.</p>
          {group.members.length < 2 && <button className="btn plain" onClick={invite}>Invite friends</button>}
        </div>
      ) : (
        <div className="card">
          {activity.map(({ e, s }) => {
            if (s) {
              return (
                <button className="row" key={s.id} onClick={() => setSheet({ kind: 'settlement', s })}>
                  <span className="emoji" style={{ background: 'color-mix(in srgb, var(--green) 20%, transparent)', color: 'var(--green)' }}>✓</span>
                  <div className="grow"><div className="title ellipsis">{name(s.from)} paid {name(s.to) === 'You' ? 'you' : name(s.to)}</div><div className="sub">{day(s.createdAt)} · Payment</div></div>
                  <div className="amt green">{fmt(s.amount)}</div>
                </button>
              );
            }
            const x = e!;
            const payers = Object.keys(x.paidBy);
            const lent = (x.paidBy[me!] ?? 0) - (x.shares[me!] ?? 0);
            const involved = me! in x.paidBy || me! in x.shares;
            return (
              <button className="row" key={x.id} onClick={() => setSheet({ kind: 'expense', expense: x })}>
                <span className="emoji">{x.emoji}</span>
                <div className="grow">
                  <div className="title ellipsis">{x.title}</div>
                  <div className="sub ellipsis">{day(x.createdAt)} · {payers.length === 1 ? `${name(payers[0])} paid` : `${payers.length} people paid`}</div>
                </div>
                <div className="amt">
                  {fmt(x.amount)}
                  <div className={`small ${lent > 0 ? 'green' : lent < 0 ? 'orange' : 'muted'}`} style={{ fontWeight: 500 }}>
                    {lent > 0 ? `you lent ${fmt(lent)}` : lent < 0 ? `you owe ${fmt(lent)}` : involved ? 'even' : 'not involved'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="dock"><button className="btn" onClick={() => setSheet({ kind: 'expense' })}>{Icon.plus} Add expense</button></div>

      {sheet?.kind === 'expense' && <ExpenseSheet group={group} me={me!} expense={sheet.expense} onGroup={setGroup} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'pay' && (
        <PaySheet group={group} debt={sheet.debt} me={me!} onGroup={setGroup} onClose={() => setSheet((s) => (s?.kind === 'pay' ? null : s))}
          onAddVpa={() => setSheet({ kind: 'people', focus: sheet.debt.to })} />
      )}
      {sheet?.kind === 'people' && (
        <PeopleSheet group={group} me={me!} focus={sheet.focus} onGroup={setGroup} onClose={() => setSheet(null)}
          onSwitch={() => { setSheet(null); setMe(undefined); }} />
      )}
      {sheet?.kind === 'settlement' && (
        <Sheet title="Payment" onClose={() => setSheet(null)}>
          <SettlementBody group={group} s={sheet.s} label={`${name(sheet.s.from)} paid ${name(sheet.s.to) === 'You' ? 'you' : name(sheet.s.to)}`} onGroup={setGroup} />
        </Sheet>
      )}
    </div>
  );
}

function SettlementBody({ group, s, label, onGroup }: { group: Group; s: Settlement; label: string; onGroup: (g: Group) => void }) {
  const close = useSheetClose();
  const [busy, setBusy] = useState(false);
  const undo = async () => {
    setBusy(true);
    try { onGroup(await api.undoSettle(group.id, s.id)); close(); } catch (e) { toast((e as Error).message); setBusy(false); }
  };
  return (
    <>
      <div className="sheet-body">
        <div className="pay-amount">
          <div className="muted">{label}</div>
          <div className="big">{fmt(s.amount)}</div>
          <div className="muted small" style={{ marginTop: 6 }}>{new Date(s.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        </div>
        <p className="caption" style={{ textAlign: 'center' }}>Chukta can’t see inside UPI apps, so payments are marked by the people involved. If the money never arrived, remove it and the balance comes back.</p>
      </div>
      <div className="sheet-foot"><button className="btn secondary" style={{ color: 'var(--red)' }} disabled={busy} onClick={undo}>Money didn’t arrive — remove</button></div>
    </>
  );
}

function Join({ group, onJoined }: { group: Group; onJoined: (g: Group, me: string) => void }) {
  const profile = getProfile();
  const [name, setName] = useState(profile.name);
  const [vpa, setVpa] = useState(profile.vpa);
  const [busy, setBusy] = useState(false);
  const vpaOk = !vpa.trim() || isVpa(vpa);

  const pick = (mid: string) => { rememberGroup(group.id, group.name, mid); onJoined(group, mid); };
  const join = async () => {
    setBusy(true);
    try {
      const g = await api.addMember(group.id, { name, vpa: vpa.trim() });
      setProfile({ name: name.trim(), vpa: vpa.trim() });
      const added = g.members.find((m) => !group.members.some((o) => o.id === m.id)) ?? g.members[g.members.length - 1];
      rememberGroup(g.id, g.name, added.id);
      onJoined(g, added.id);
    } catch (e) { toast((e as Error).message); setBusy(false); }
  };

  return (
    <div className="page" style={{ paddingBottom: 40 }}>
      <div className="nav" />
      <div className="pass mini" style={passStyle(group.id)}>
        <div className="top"><span className="name">{group.name}</span><span className="mark">CHUKTA</span></div>
        <div className="foot">{group.members.length} {group.members.length === 1 ? 'person' : 'people'}</div>
      </div>
      <h2 className="section-title">Who are you?</h2>
      <div className="card">
        {group.members.map((m) => (
          <button className="row" key={m.id} onClick={() => pick(m.id)}>
            <Avatar m={m} /><div className="grow title ellipsis">{m.name}</div><span className="muted small">That’s me</span>
          </button>
        ))}
      </div>
      <h2 className="section-title">Not on the list?</h2>
      <div className="card">
        <div className="field"><label>Name</label><input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></div>
        <div className="field"><label>UPI ID</label><input placeholder="yourname@bank" value={vpa} onChange={(e) => setVpa(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" /></div>
      </div>
      <p className="caption" style={vpaOk ? undefined : { color: 'var(--red)' }}>{vpaOk ? 'Your UPI ID lets friends pay you in one tap. Optional for now.' : 'A UPI ID looks like name@bank.'}</p>
      <button className="btn" disabled={!name.trim() || !vpaOk || busy} onClick={join}>Join group</button>
    </div>
  );
}
