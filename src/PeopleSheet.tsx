import { useState } from 'react';
import { api } from './lib/api';
import type { Group, Member } from './lib/money';
import { isVpa } from './lib/upi';
import { getProfile, setProfile } from './lib/local';
import { Avatar, Sheet, toast } from './ui';

interface Props { group: Group; me: string; focus?: string; onGroup: (g: Group) => void; onClose: () => void; onSwitch: () => void }

export function PeopleSheet({ group, me, focus, onGroup, onClose, onSwitch }: Props) {
  const [editing, setEditing] = useState<string | null>(focus ?? null);
  const [adding, setAdding] = useState(false);

  return (
    <Sheet title="People" onClose={onClose}>
      <div className="sheet-body">
        <div className="card">
          {group.members.map((m) =>
            editing === m.id ? (
              <MemberForm
                key={m.id} initial={m} isMe={m.id === me}
                onCancel={() => setEditing(null)}
                onSave={async (v) => {
                  onGroup(await api.updateMember(group.id, m.id, v));
                  if (m.id === me) setProfile({ ...getProfile(), ...v });
                  setEditing(null);
                }}
                onRemove={m.id === me ? undefined : async () => { onGroup(await api.removeMember(group.id, m.id)); setEditing(null); }}
              />
            ) : (
              <button className="row" key={m.id} onClick={() => { setEditing(m.id); setAdding(false); }}>
                <Avatar m={m} />
                <div className="grow">
                  <div className="title ellipsis">{m.name}{m.id === me && <span className="muted" style={{ fontWeight: 400 }}> · you</span>}</div>
                  <div className={`sub ellipsis${m.vpa ? '' : ' orange'}`}>{m.vpa || 'No UPI ID yet'}</div>
                </div>
                <span className="muted small">Edit</span>
              </button>
            ),
          )}
        </div>
        <div className="card" style={{ marginTop: 14 }}>
          {adding ? (
            <MemberForm
              onCancel={() => setAdding(false)}
              onSave={async (v) => { onGroup(await api.addMember(group.id, v)); setAdding(false); }}
            />
          ) : (
            <button className="row tight" onClick={() => { setAdding(true); setEditing(null); }} style={{ color: 'var(--blue)', fontWeight: 500 }}>Add a person</button>
          )}
        </div>
        <button className="btn plain" style={{ marginTop: 8 }} onClick={onSwitch}>I’m someone else on this list</button>
      </div>
    </Sheet>
  );
}

function MemberForm({ initial, isMe, onSave, onCancel, onRemove }: {
  initial?: Member; isMe?: boolean;
  onSave: (v: { name: string; vpa: string }) => Promise<void>; onCancel: () => void; onRemove?: () => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [vpa, setVpa] = useState(initial?.vpa ?? '');
  const [busy, setBusy] = useState(false);
  const vpaOk = !vpa.trim() || isVpa(vpa);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast((e as Error).message); setBusy(false); }
  };
  return (
    <div style={{ padding: '4px 0 10px' }}>
      <div className="field"><label>Name</label><input autoFocus={!initial} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={60} /></div>
      <div className="field">
        <label>UPI ID</label>
        <input autoFocus={!!initial && !initial.vpa} value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="name@bank" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" />
      </div>
      {!vpaOk && <p className="caption red" style={{ marginBottom: 4 }}>A UPI ID looks like name@bank.</p>}
      {isMe && vpaOk && <p className="caption" style={{ marginBottom: 4 }}>This is where friends’ payments to you will go — double-check it.</p>}
      <div style={{ display: 'flex', gap: 8, padding: '8px 16px 0', alignItems: 'center' }}>
        {onRemove && <button className="pill soft" style={{ color: 'var(--red)' }} disabled={busy} onClick={() => run(onRemove)}>Remove</button>}
        <span className="grow" />
        <button className="pill soft" onClick={onCancel}>Cancel</button>
        <button className="pill" disabled={busy || !name.trim() || !vpaOk} onClick={() => run(() => onSave({ name: name.trim(), vpa: vpa.trim() }))}>Save</button>
      </div>
    </div>
  );
}
