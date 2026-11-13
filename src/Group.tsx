import { useEffect, useMemo, useState } from 'react';
import { navigate } from './App';
import { api, type SyncStatus } from './lib/sync';
import { forgetGroup, getProfile, rememberGroup, setProfile } from './lib/local';
import { fmt, netBalances, simplifyDebts, type Debt, type Expense, type Group, type Settlement } from './lib/money';
import { isVpa } from './lib/upi';
import { inviteUrl } from './lib/platform';
import { ExpenseSheet } from './ExpenseSheet';
import { PaySheet } from './PaySheet';
import { PeopleSheet } from './PeopleSheet';
import { Avatar, Icon, Sheet, passStyle, shareOrCopy, toast, useSheetClose } from './ui';

function useGroup(id: string) {
  const [state, setState] = useState<{ group: Group | null; status: SyncStatus | null; myKey: string }>({ group: null, status: null, myKey: '' });
  const [error, setError] = useState('');
  // Fires with what's saved on this device straight away, then again whenever anyone's change arrives.
  useEffect(() => api.watch(id, (group, status, myKey) => setState({ group, status, myKey }), (e) => setError(e.message)), [id]);
  return { ...state, error };
}

type SheetState =
  | { kind: 'expense'; expense?: Expense } | { kind: 'pay'; debt: Debt }
  | { kind: 'people'; focus?: string } | { kind: 'settlement'; s: Settlement } | null;

const day = (t: number) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function GroupScreen({ id }: { id: string }) {
  const { group, status, myKey, error } = useGroup(id);
  const setGroup = (_: Group) => {}; // state arrives through the watcher
  const me = group?.members.find((m) => m.owner === myKey)?.id;
  const [sheet, setSheet] = useState<SheetState>(null);

  const net = useMemo(() => (group ? netBalances(group) : {}), [group]);
  const mineNow = group?.members.find((m) => m.owner === myKey)?.id;
  const netNow = mineNow ? net[mineNow] ?? 0 : undefined;
  useEffect(() => { if (group) rememberGroup(group.id, group.name, { net: netNow, people: group.members.length }); }, [group?.id, group?.name, netNow, group?.members.length]);
  const debts = useMemo(() => simplifyDebts(net), [net]);

  if (!group) {
    if (!error && !status?.searched) return <div className="spinner" role="status" aria-label="Loading" />;
    return (
      <div className="page">
        <div className="empty" style={{ marginTop: '22vh' }}>
          <div className="glyph">{error ? '🫥' : '📡'}</div>
          <h2 style={{ color: 'var(--text)' }}>{error ? 'Can’t open this group' : 'Still looking for this group'}</h2>
          <p style={{ margin: '6px 0 20px' }}>
            {error || (status?.online
              ? 'Nothing has arrived yet. Ask someone in the group to open the app — their phone will send it over. This page updates by itself.'
              : 'You’re offline. Connect to the internet and it will load by itself.')}
          </p>
          <button className="btn secondary" onClick={() => { forgetGroup(id); navigate('/'); }}>Go home</button>
        </div>
      </div>
    );
  }

  const meMember = group.members.find((m) => m.id === me);
  if (!meMember) return <Join group={group} myKey={myKey} />;

  const name = (mid: string) => (mid === me ? 'You' : group.members.find((m) => m.id === mid)?.name ?? 'Someone');
  const member = (mid: string) => group.members.find((m) => m.id === mid) ?? { id: mid, name: '?', vpa: '' };
  const myNet = net[me!] ?? 0;
  const toPay = debts.filter((d) => d.from === me);
  const toGet = debts.filter((d) => d.to === me);
  const others = debts.filter((d) => d.from !== me && d.to !== me);
  const spent = group.expenses.reduce((a, e) => a + e.amount, 0);
  const url = inviteUrl(group.id);

  const waiting = group.members.filter((m) => !m.owner);
  const dayLabel = (t: number) => {
    const d = new Date(t).toDateString(), now = Date.now();
    return d === new Date(now).toDateString() ? 'Today' : d === new Date(now - 86400e3).toDateString() ? 'Yesterday' : day(t);
  };
  const activity = [
    ...group.expenses.map((e) => ({ t: e.createdAt, e, s: undefined as Settlement | undefined })),
    ...group.settlements.map((s) => ({ t: s.createdAt, s, e: undefined as Expense | undefined })),
  ].sort((a, b) => b.t - a.t);
  const days: [string, typeof activity][] = [];
  for (const item of activity) {
    const label = dayLabel(item.t);
    if (days.at(-1)?.[0] === label) days.at(-1)![1].push(item); else days.push([label, [item]]);
  }

  const invite = () => shareOrCopy({ title: group.name, text: `Join “${group.name}” on Chukta — split expenses and pay each other in one tap. This link is the key to the group, keep it between us:`, url });
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

      {status && (!status.online || status.pending > 0) && (
        <p className="caption" style={{ margin: '12px 4px 0' }} role="status">
          {status.online ? 'Sending your changes to the group…' : 'Offline — saved on this phone, will sync when you’re back online.'}
        </p>
      )}

      {!meMember.vpa && (
        <button className="banner" onClick={() => setSheet({ kind: 'people', focus: me })}>
          <span style={{ fontSize: 26 }}>🪪</span>
          <span className="grow"><b>Add your UPI ID</b><span className="small muted">So friends can pay you in one tap</span></span>
          <span className="pill">Add</span>
        </button>
      )}

      {waiting.length > 0 && (
        <button className="banner calm" onClick={invite}>
          <span className="stack">{waiting.slice(0, 3).map((m) => <Avatar key={m.id} m={m} size={30} />)}</span>
          <span className="grow"><b>{waiting.length === 1 ? `${waiting[0].name} hasn’t joined yet` : `${waiting.length} people haven’t joined yet`}</b><span className="small muted">Send them the invite link</span></span>
          <span className="pill">Invite</span>
        </button>
      )}

      {debts.length === 0 && group.expenses.length > 0 && (
        <div className="card settled" style={{ padding: 16 }}>
          <span className="tick on">{Icon.check}</span>
          <div><div className="title">Everyone’s settled up</div><div className="sub">Nobody owes anybody anything.</div></div>
        </div>
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
        days.map(([label, items]) => (
          <div key={label}>
            <div className="day-label">{label}</div>
            <div className="card">
              {items.map(({ e, s }) => {
                if (s) {
                  return (
                    <button className="row" key={s.id} onClick={() => setSheet({ kind: 'settlement', s })}>
                      <span className="emoji" style={{ background: 'color-mix(in srgb, var(--green) 20%, transparent)', color: 'var(--green)' }}>✓</span>
                      <div className="grow"><div className="title ellipsis">{name(s.from)} paid {name(s.to) === 'You' ? 'you' : name(s.to)}</div><div className="sub">Payment</div></div>
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
                      <div className="sub ellipsis">{payers.length === 1 ? `${name(payers[0])} paid` : `${payers.length} people paid`}</div>
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
          </div>
        ))
      )}

      <div className="dock"><button className="btn" onClick={() => setSheet({ kind: 'expense' })}>{Icon.plus} Add expense</button></div>

      {sheet?.kind === 'expense' && <ExpenseSheet group={group} me={me!} expense={sheet.expense} onGroup={setGroup} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'pay' && (
        <PaySheet group={group} debt={sheet.debt} me={me!} onGroup={setGroup} onClose={() => setSheet((s) => (s?.kind === 'pay' ? null : s))}
          onAddVpa={() => setSheet({ kind: 'people', focus: sheet.debt.to })} />
      )}
      {sheet?.kind === 'people' && (
        <PeopleSheet group={group} me={me!} myKey={myKey} focus={sheet.focus} onGroup={setGroup} onClose={() => setSheet(null)} />
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

function Join({ group, myKey }: { group: Group; myKey: string }) {
  const profile = getProfile();
  const [name, setName] = useState(profile.name);
  const [vpa, setVpa] = useState(profile.vpa);
  const [busy, setBusy] = useState(false);
  const vpaOk = !vpa.trim() || isVpa(vpa);
  void myKey;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const join = () => run(async () => {
    await api.addMember(group.id, { name, vpa: vpa.trim() }, true);
    setProfile({ name: name.trim(), vpa: vpa.trim() });
  });
  const open = group.members.filter((m) => !m.owner);

  return (
    <div className="page" style={{ paddingBottom: 40 }}>
      <div className="nav"><button className="icon-btn" onClick={() => navigate('/')} aria-label="All groups">{Icon.back}</button></div>
      <div className="pass mini" style={passStyle(group.id)}>
        <div className="top"><span className="name">{group.name}</span><span className="mark">CHUKTA</span></div>
        <div className="foot">{group.members.length} {group.members.length === 1 ? 'person' : 'people'}</div>
      </div>
      {open.length > 0 && (
        <>
          <h2 className="section-title">Who are you?</h2>
          <div className="card">
            {open.map((m) => (
              <button className="row" key={m.id} disabled={busy} onClick={() => run(() => api.claim(group.id, m.id))}>
                <Avatar m={m} /><div className="grow title ellipsis">{m.name}</div><span className="muted small">That’s me</span>
              </button>
            ))}
          </div>
          <p className="caption">Picking a name ties it to this phone, so only you can change its UPI ID.</p>
        </>
      )}
      <h2 className="section-title">{open.length ? 'Not on the list?' : 'Join this group'}</h2>
      <div className="card">
        <div className="field"><label>Name</label><input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></div>
        <div className="field"><label>UPI ID</label><input placeholder="yourname@bank" value={vpa} onChange={(e) => setVpa(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" /></div>
      </div>
      <p className="caption" style={vpaOk ? undefined : { color: 'var(--red)' }}>{vpaOk ? 'Your UPI ID lets friends pay you in one tap. Optional for now.' : 'A UPI ID looks like name@bank.'}</p>
      <button className="btn" disabled={!name.trim() || !vpaOk || busy} onClick={join}>Join group</button>
    </div>
  );
}
