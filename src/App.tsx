import { useEffect, useState } from 'react';
import { api } from './lib/sync';
import { getGroups, getProfile, rememberGroup, setProfile, type SavedGroup } from './lib/local';
import { isVpa } from './lib/upi';
import { fmt } from './lib/money';
import { parseInvite } from './lib/platform';
import { GroupScreen } from './Group';
import { Icon, Sheet, Toaster, passStyle, toast } from './ui';

export function navigate(path: string) {
  location.hash = path === '/' ? '' : path;
}
const route = () => location.hash.replace(/^#/, '') || '/';

export function App() {
  const [path, setPath] = useState(route);
  useEffect(() => {
    const on = () => { setPath(route()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const gid = path.match(/^\/g\/([\w-]+)/)?.[1];
  return (
    <>
      {gid ? <GroupScreen key={gid} id={gid} /> : <Home />}
      <Toaster />
    </>
  );
}

function Home() {
  const [groups] = useState<SavedGroup[]>(getGroups);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  return (
    <div className="page">
      <div className="nav">
        <span className="grow" />
        <button className="pill soft" onClick={() => setJoining(true)}>{Icon.link} Join with a link</button>
      </div>
      {groups.length ? (
        <>
          <h1 className="large-title">Chukta</h1>
          <div className="pass-list">
            {groups.map((g) => (
              <button key={g.id} className="pass mini" style={passStyle(g.id)} onClick={() => navigate(`/g/${g.id}`)}>
                <div className="top"><span className="name">{g.name}</span><span className="mark">CHUKTA</span></div>
                <div>
                  {g.net !== undefined && <div className="label">{g.net < 0 ? 'You owe' : g.net > 0 ? 'You’re owed' : 'All settled'}</div>}
                  <div className="big">{g.net ? fmt(g.net) : g.net === 0 ? '₹0' : ''}</div>
                  <div className="foot">{g.people ? `${g.people} ${g.people === 1 ? 'person' : 'people'}` : 'Tap to open'}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="hero-copy" style={{ marginTop: 28 }}>
            <h1 className="large-title">Split it.<br />Tap. Paid.</h1>
            <p>Add an expense, and everyone gets a one-tap UPI payment with the exact amount filled in.</p>
          </div>
          <div className="card steps">
            <div className="row"><span className="emoji">🧾</span><div><div className="title">Split any way you like</div><div className="sub">Equal, exact, percent, shares or adjustments</div></div></div>
            <div className="row"><span className="emoji">📲</span><div><div className="title">Pay from GPay, PhonePe or Paytm</div><div className="sub">Amount and UPI ID are already filled in</div></div></div>
            <div className="row"><span className="emoji">✅</span><div><div className="title">Ticked off for everyone</div><div className="sub">Synced phone to phone, end-to-end encrypted</div></div></div>
          </div>
        </>
      )}
      <div className="dock"><button className="btn" onClick={() => setCreating(true)}>{Icon.plus} New group</button></div>
      {creating && <Sheet title="New group" onClose={() => setCreating(false)}><CreateGroup /></Sheet>}
      {joining && <Sheet title="Join a group" onClose={() => setJoining(false)}><JoinLink /></Sheet>}
    </div>
  );
}

function CreateGroup() {
  const profile = getProfile();
  const [name, setName] = useState('');
  const [me, setMe] = useState(profile.name);
  const [vpa, setVpa] = useState(profile.vpa);
  const [others, setOthers] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const addDraft = () => {
    const names = draft.split(',').map((s) => s.trim()).filter(Boolean);
    if (names.length) setOthers((o) => [...o, ...names]);
    setDraft('');
  };
  const vpaOk = !vpa.trim() || isVpa(vpa);
  const ready = name.trim() && me.trim() && vpaOk;

  const create = async () => {
    setBusy(true);
    try {
      const pending = draft.split(',').map((s) => s.trim()).filter(Boolean);
      const members = [{ name: me, vpa: vpa.trim() }, ...[...others, ...pending].map((n) => ({ name: n, vpa: '' }))];
      const g = await api.createGroup(name, members);
      setProfile({ name: me.trim(), vpa: vpa.trim() });
      rememberGroup(g.id, g.name);
      navigate(`/g/${g.id}`);
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sheet-body">
        <div className="card">
          <div className="field"><label>Group</label><input autoFocus placeholder="Goa trip, Flat 302…" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></div>
        </div>
        <div className="group-label">You</div>
        <div className="card">
          <div className="field"><label>Name</label><input placeholder="Your name" value={me} onChange={(e) => setMe(e.target.value)} maxLength={60} /></div>
          <div className="field"><label>UPI ID</label><input placeholder="yourname@okhdfcbank" value={vpa} onChange={(e) => setVpa(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" /></div>
        </div>
        <p className="caption" style={vpaOk ? undefined : { color: 'var(--red)' }}>
          {vpaOk ? 'Your UPI ID is how friends pay you. Find it in your UPI app’s profile. You can add it later.' : 'That doesn’t look like a UPI ID — it should look like name@bank.'}
        </p>
        <div className="group-label">Friends <span>They add their own UPI ID when they join</span></div>
        <div className="card">
          {others.map((n, i) => (
            <div className="field" key={i}>
              <span className="grow ellipsis">{n}</span>
              <button className="muted" onClick={() => setOthers((o) => o.filter((_, j) => j !== i))} aria-label={`Remove ${n}`}>Remove</button>
            </div>
          ))}
          <div className="field">
            <input placeholder="Add a name" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addDraft()} onBlur={addDraft} maxLength={60} enterKeyHint="next" />
          </div>
        </div>
      </div>
      <div className="sheet-foot"><button className="btn" disabled={!ready || busy} onClick={create}>Create group</button></div>
    </>
  );
}

/** Paste an invite link (links open the browser, so the apps need a way in). */
function JoinLink() {
  const [link, setLink] = useState('');
  const secret = parseInvite(link.trim());
  const go = () => (secret ? navigate(`/g/${secret}`) : toast('That doesn’t look like an invite link'));
  return (
    <>
      <div className="sheet-body">
        <div className="card"><div className="field"><input autoFocus placeholder="Paste the invite link" value={link} onChange={(e) => setLink(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" onKeyDown={(e) => e.key === 'Enter' && go()} /></div></div>
        <p className="caption">Ask whoever made the group to share it. The link is the key to the group — only send it to people who belong in it.</p>
      </div>
      <div className="sheet-foot"><button className="btn" disabled={!secret} onClick={go}>Open group</button></div>
    </>
  );
}
