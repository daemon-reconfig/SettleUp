import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { api } from './lib/sync';
import { fmt, toRupees, type Debt, type Group } from './lib/money';
import { isNative } from './lib/platform';
import { UPI_APPS, isMobile, upiUri, type UpiRequest } from './lib/upi';
import { Avatar, CheckBurst, Icon, Sheet, copy, haptic, toast, useSheetClose } from './ui';

interface Props { group: Group; debt: Debt; me: string; onGroup: (g: Group) => void; onClose: () => void; onAddVpa: () => void }

// UPI apps refuse most direct links ("intents") to personal UPI IDs, but they do accept the
// very same request as a QR image. So the main route is: hand the QR to the UPI app through
// the phone's share menu. Direct links stay available, and if one ever works for this person
// we remember it and lead with it next time.
const PREF = 'chukta:paymethod';
const GALLERY_QR_CAP = 200000; // ₹2,000 — some apps cap payments made from a saved QR image

export function PaySheet(p: Props) {
  const who = (id: string) => p.group.members.find((m) => m.id === id)?.name ?? '';
  const title = p.debt.from === p.me ? `Pay ${who(p.debt.to)}` : `${who(p.debt.from)} → ${who(p.debt.to)}`;
  return <Sheet title={title} onClose={p.onClose}><PayBody {...p} /></Sheet>;
}

/** A self-explanatory image: the QR plus who and how much, so it reads well in a gallery too. */
async function qrCard(req: UpiRequest): Promise<HTMLCanvasElement> {
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, upiUri(req), { margin: 2, width: 640, errorCorrectionLevel: 'M' });
  const c = document.createElement('canvas');
  c.width = 720; c.height = 900;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(qr, 40, 30);
  g.textAlign = 'center'; g.fillStyle = '#555';
  g.font = '500 32px system-ui, sans-serif'; g.fillText(`Pay ${req.name}`.slice(0, 36), 360, 730);
  g.fillStyle = '#000'; g.font = '700 68px system-ui, sans-serif'; g.fillText(fmt(req.amount), 360, 812);
  g.fillStyle = '#888'; g.font = '400 24px system-ui, sans-serif'; g.fillText('Scan or upload in any UPI app', 360, 862);
  return c;
}

/** Returns false if the person backed out of the share menu. */
async function shareQr(req: UpiRequest): Promise<boolean> {
  const canvas = await qrCard(req);
  if (isNative) {
    const data = canvas.toDataURL('image/png').split(',')[1];
    const { uri } = await Filesystem.writeFile({ path: 'chukta-pay.png', data, directory: Directory.Cache });
    try { await Share.share({ files: [uri], dialogTitle: 'Pay with your UPI app' }); return true; } catch { return false; }
  }
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('no image'))), 'image/png'));
  const file = new File([blob], 'chukta-pay.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; } catch { return false; }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'chukta-pay.png' });
  a.click();
  URL.revokeObjectURL(a.href);
  toast('QR saved. In your UPI app: Scan → pick from gallery');
  return true;
}

function PayBody({ group, debt, me, onGroup, onAddVpa }: Props) {
  const close = useSheetClose();
  const payee = group.members.find((m) => m.id === debt.to)!;
  const payer = group.members.find((m) => m.id === debt.from)!;
  const mine = debt.from === me;
  const [stage, setStage] = useState<'pay' | 'confirm' | 'done'>('pay');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const [showApps, setShowApps] = useState(false);
  const [tried, setTried] = useState('');
  const mobile = isMobile();
  const preferred = useMemo(() => { try { return UPI_APPS.find((a) => `direct:${a.id}` === localStorage.getItem(PREF)); } catch { return undefined; } }, []);

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

  const sendQr = async () => {
    haptic();
    setBusy(true);
    const sent = await shareQr(req).catch(() => { toast('Couldn’t share the QR — take a screenshot instead'); return false; });
    setBusy(false);
    if (sent) { setTried('qr'); setStage('confirm'); }
  };
  const openApp = (id: string, link: string) => {
    haptic();
    setTried(`direct:${id}`);
    window.location.href = link;
    setTimeout(() => setStage('confirm'), 700); // the UPI app covers us; this is what they return to
  };

  const markPaid = async () => {
    setBusy(true);
    try {
      onGroup(await api.settle(group.id, { from: debt.from, to: debt.to, amount: debt.amount }));
      if (stage === 'confirm' && tried) { try { localStorage.setItem(PREF, tried); } catch { /* ignore */ } }
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

  const canPay = mine && !!payee.vpa && mobile;
  return (
    <>
      <div className="sheet-body">
        <div className="pay-amount">
          <div className="pay-who"><Avatar m={mine ? payee : payer} size={28} />{mine ? payee.name : `${payer.name} pays ${payee.name}`}</div>
          <div className="big">{fmt(debt.amount)}</div>
        </div>

        {payee.vpa ? (
          <>
            <div className="qr">{qr && <img src={qr} alt={`UPI QR code to pay ${payee.name} ${fmt(debt.amount)}`} />}</div>
            <div className="copy-row">
              <button className="vpa" onClick={() => copy(payee.vpa, 'UPI ID copied')}><span className="ellipsis">{payee.vpa}</span>{Icon.copy}</button>
              <button className="vpa" onClick={() => copy(toRupees(debt.amount), 'Amount copied')}><span className="num">{fmt(debt.amount)}</span>{Icon.copy}</button>
            </div>
            {vpaNote && <p className={`caption ${vpaFresh ? 'orange' : ''}`} style={{ textAlign: 'center', margin: '8px 0 0' }}>{vpaNote}</p>}
            {!mobile && <p className="caption" style={{ textAlign: 'center', margin: '6px 0 0' }}>Scan with any UPI app — the amount is built in.</p>}
          </>
        ) : (
          <div className="card" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 34 }}>🪪</div>
            <p style={{ fontWeight: 600, marginTop: 6 }}>{payee.name} hasn’t added a UPI ID yet</p>
            <p className="muted small" style={{ marginTop: 4 }}>Ask them to open the group and add it, or pay another way and mark it as paid.</p>
            {!payee.owner && <button className="btn plain" onClick={() => { close(); onAddVpa(); }}>Add {payee.name}’s UPI ID</button>}
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
        ) : canPay ? (
          <>
            {showApps && (
              <>
                <div className="apps">
                  {UPI_APPS.map((a) => (
                    <button key={a.id} className="app" onClick={() => openApp(a.id, a.link(req))} aria-label={`Pay with ${a.name}`}><i style={{ background: a.color }} />{a.short}</button>
                  ))}
                </div>
                <p className="caption" style={{ textAlign: 'center', margin: '2px 8px 4px' }}>UPI apps often refuse direct links to personal UPI IDs. If yours does, send the QR instead.</p>
              </>
            )}
            {preferred ? (
              <button className="btn" onClick={() => openApp(preferred.id, preferred.link(req))}>Pay with {preferred.name}</button>
            ) : (
              <button className="btn" disabled={busy} onClick={sendQr}>{Icon.share} Send QR to my UPI app</button>
            )}
            <p className={`caption${!preferred && debt.amount > GALLERY_QR_CAP ? ' orange' : ''}`} style={{ textAlign: 'center', margin: '2px 8px 0' }}>
              {preferred ? 'Worked last time on this phone.'
                : debt.amount > GALLERY_QR_CAP ? 'Some apps cap a shared QR at ₹2,000. If yours does, scan this from another screen or copy the UPI ID.'
                : 'Pick GPay, PhonePe or Paytm in the menu — who and how much are already filled in.'}
            </p>
            <div className="foot-row">
              {preferred
                ? <button className="btn plain" disabled={busy} onClick={sendQr}>Send QR instead</button>
                : <button className="btn plain" onClick={() => setShowApps((v) => !v)}>{showApps ? 'Hide apps' : 'Open an app directly'}</button>}
              <button className="btn plain" disabled={busy} onClick={markPaid}>Mark as paid</button>
            </div>
          </>
        ) : (
          <button className="btn" disabled={busy} onClick={markPaid}>{mine ? 'I’ve paid — mark as paid' : 'Mark as received'}</button>
        )}
      </div>
    </>
  );
}
