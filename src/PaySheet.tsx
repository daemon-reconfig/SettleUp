import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { api } from './lib/sync';
import { fmt, type Debt, type Group } from './lib/money';
import { UPI_APPS, isMobile, upiUri, type UpiRequest } from './lib/upi';
import { CheckBurst, Icon, Sheet, copy, haptic, toast, useSheetClose } from './ui';

interface Props { group: Group; debt: Debt; me: string; onGroup: (g: Group) => void; onClose: () => void; onAddVpa: () => void }

/** Pay sheet: payee's QR + one-tap deep links into UPI apps, then tick it off. */
export function PaySheet(p: Props) {
  const who = (id: string) => p.group.members.find((m) => m.id === id)?.name ?? '';
  const title = p.debt.from === p.me ? `Pay ${who(p.debt.to)}` : `${who(p.debt.from)} → ${who(p.debt.to)}`;
  return <Sheet title={title} onClose={p.onClose}><PayBody {...p} /></Sheet>;
}

function PayBody({ group, debt, me, onGroup, onAddVpa }: Props) {
  const close = useSheetClose();
  const payee = group.members.find((m) => m.id === debt.to)!;
  const payer = group.members.find((m) => m.id === debt.from)!;
  const mine = debt.from === me;
  const [stage, setStage] = useState<'pay' | 'confirm' | 'done'>('pay');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const mobile = isMobile();
  // Show where the UPI ID came from, and flag it if it was swapped recently — money goes wherever it points.
  const setBy = payee.vpaBy === payee.owner && payee.owner ? payee.name : group.members.find((m) => m.owner && m.owner === payee.vpaBy)?.name;
  const vpaFresh = !!payee.vpaChanged && Date.now() - (payee.vpaAt ?? 0) < 3 * 86400e3;
  const vpaNote = !payee.vpa ? '' : vpaFresh
    ? `This UPI ID was changed recently${setBy ? ` by ${setBy}` : ''}. Check with ${payee.name} before paying.`
    : payee.owner && payee.vpaBy === payee.owner ? `Added by ${payee.name} from their own phone` : `Added by ${setBy ?? 'someone'} — ${payee.name} hasn’t confirmed it yet`;

  const req: UpiRequest = useMemo(
    () => ({ vpa: payee.vpa, name: payee.name, amount: debt.amount, note: group.name.replace(/[^\w ]/g, '').trim() || 'Chukta' }),
    [payee.vpa, payee.name, debt.amount, group.name],
  );
  useEffect(() => {
    if (!payee.vpa) return;
    QRCode.toDataURL(upiUri(req), { margin: 0, width: 600, errorCorrectionLevel: 'M' }).then(setQr, () => setQr(''));
  }, [req, payee.vpa]);

  const openApp = (link: string) => {
    haptic();
    window.location.href = link;
    // The UPI app covers us now; this is what they see when they come back.
    setTimeout(() => setStage('confirm'), 700);
  };

  const markPaid = async () => {
    setBusy(true);
    try {
      onGroup(await api.settle(group.id, { from: debt.from, to: debt.to, amount: debt.amount }));
      setStage('done');
      haptic([12, 60, 24]);
      setTimeout(close, 1700);
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  };

  if (stage === 'done') {
    return (
      <div className="sheet-body">
        <div className="done">
          <CheckBurst />
          <h3>Done</h3>
          <p className="muted">{mine ? `${fmt(debt.amount)} to ${payee.name}` : `${fmt(debt.amount)} from ${payer.name}`}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="sheet-body">
        <div className="pay-amount">
          <div className="big">{fmt(debt.amount)}</div>
        </div>

        {payee.vpa ? (
          <>
            <div className="qr">{qr && <img src={qr} alt={`UPI QR code to pay ${payee.name} ${fmt(debt.amount)}`} />}</div>
            <button className="vpa" onClick={() => copy(payee.vpa, 'UPI ID copied')}>
              <span className="ellipsis">{payee.vpa}</span>{Icon.copy}
            </button>
            {vpaNote && <p className={`caption ${vpaFresh ? 'orange' : ''}`} style={{ textAlign: 'center', margin: '2px 0 6px' }}>{vpaNote}</p>}
            <p className="caption" style={{ textAlign: 'center', marginBottom: 0 }}>
              {mobile ? 'Or scan this from another phone — the amount is built in.' : 'Scan with any UPI app — the amount is built in.'}
            </p>
          </>
        ) : (
          <div className="card" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 34 }}>🪪</div>
            <p style={{ fontWeight: 600, marginTop: 6 }}>{payee.name} hasn’t added a UPI ID yet</p>
            <p className="muted small" style={{ marginTop: 4 }}>Add it for them, or pay another way and mark it as paid.</p>
            <button className="btn plain" onClick={() => { close(); onAddVpa(); }}>Add {payee.name}’s UPI ID</button>
          </div>
        )}
      </div>

      <div className="sheet-foot">
        {stage === 'confirm' ? (
          <>
            <p className="status">Did the payment go through?</p>
            <button className="btn" disabled={busy} onClick={markPaid}>Yes, mark as paid</button>
            <button className="btn plain" onClick={() => setStage('pay')}>Not yet</button>
          </>
        ) : (
          <>
            {mine && payee.vpa && mobile && (
              <>
                <div className="apps">
                  {UPI_APPS.map((a) => (
                    <button key={a.id} className="app" onClick={() => openApp(a.link(req))} aria-label={`Pay with ${a.name}`}>
                      <i style={{ background: a.color }} />{a.short}
                    </button>
                  ))}
                </div>
                <button className="btn" onClick={() => openApp(upiUri(req))}>Pay {fmt(debt.amount)}</button>
              </>
            )}
            <button className={mine && payee.vpa && mobile ? 'btn plain' : 'btn'} disabled={busy} onClick={markPaid}>
              {mine ? 'I’ve paid — mark as paid' : 'Mark as received'}
            </button>
          </>
        )}
      </div>
    </>
  );
}
