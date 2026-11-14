import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { AppLauncher } from '@capacitor/app-launcher';
import { Media } from '@capacitor-community/media';
import { api } from './lib/sync';
import { fmt, toRupees, type Debt, type Group } from './lib/money';
import { isNative, platform } from './lib/platform';
import { UPI_APPS, isMobile, upiUri, type UpiRequest } from './lib/upi';
import { Avatar, CheckBurst, Icon, Sheet, copy, haptic, toast, useSheetClose } from './ui';

interface Props { group: Group; debt: Debt; me: string; onGroup: (g: Group) => void; onClose: () => void; onAddVpa: () => void }

// UPI apps refuse most direct links ("intents") to personal UPI IDs, and treat a shared image as
// a chat message. What they do accept is their own scanner reading a QR from the phone's photos.
// So: save the QR to photos, open the UPI app, and tell the person the two taps to make there.
const GALLERY_QR_CAP = 200000; // ₹2,000 — some apps cap payments made from a saved QR image
type UpiApp = (typeof UPI_APPS)[number];

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

/** Puts the QR in the phone's photos, where the UPI app's scanner can pick it up. */
async function saveQr(req: UpiRequest) {
  const canvas = await qrCard(req);
  if (isNative) {
    const path = canvas.toDataURL('image/png');
    const fileName = `chukta-pay-${Date.now()}`;
    if (platform !== 'android') return void (await Media.savePhoto({ path, fileName }));
    const find = async () => (await Media.getAlbums()).albums.find((a) => a.name === 'Chukta');
    let album = await find();
    if (!album) { await Media.createAlbum({ name: 'Chukta' }); album = await find(); }
    return void (await Media.savePhoto({ path, fileName, albumIdentifier: album?.identifier }));
  }
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('no image'))), 'image/png'));
  const file = new File([blob], 'chukta-pay.png', { type: 'image/png' });
  // iPhone browsers can't write to Photos directly: the share menu's "Save Image" does it.
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && navigator.canShare?.({ files: [file] })) return void (await navigator.share({ files: [file] }));
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `chukta-pay-${Date.now()}.png` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Opens the UPI app itself (its home screen), not a payment link. */
async function launch(app: UpiApp) {
  if (isNative) return void (await AppLauncher.openUrl({ url: platform === 'android' ? app.pkg : app.scheme }));
  window.location.href = /Android/i.test(navigator.userAgent)
    ? `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${app.pkg};end`
    : app.scheme;
}

function PayBody({ group, debt, me, onGroup, onAddVpa }: Props) {
  const close = useSheetClose();
  const payee = group.members.find((m) => m.id === debt.to)!;
  const payer = group.members.find((m) => m.id === debt.from)!;
  const mine = debt.from === me;
  const [stage, setStage] = useState<'pay' | 'guide' | 'confirm' | 'done'>('pay');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const [app, setApp] = useState<UpiApp>(UPI_APPS[0]);
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

  const saveAndOpen = async () => {
    haptic();
    setBusy(true);
    try {
      await saveQr(req);
      // Backup route if the app won't take the picture: the UPI ID is ready to paste.
      await navigator.clipboard?.writeText(payee.vpa).catch(() => {});
      toast('QR saved to your photos');
      await launch(app);
      setTimeout(() => setStage('confirm'), 700); // the UPI app covers us; this is what they return to
    } catch {
      toast('Couldn’t save the QR — take a screenshot of it instead');
    }
    setBusy(false);
  };
  const directLink = () => {
    haptic();
    window.location.href = app.link(req);
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
        ) : canPay && stage === 'guide' ? (
          <>
            <ol className="steps-list">
              <li><span>We save this QR to your photos and open {app.name}.</span></li>
              <li><span>In {app.name}, tap <b>{app.scan}</b>, then the <b>photo / gallery icon</b>.</span></li>
              <li><span>Pick the newest picture. {payee.name} and {fmt(debt.amount)} fill in by themselves.</span></li>
            </ol>
            {debt.amount > GALLERY_QR_CAP && (
              <p className="caption orange" style={{ margin: '0 8px 4px' }}>Some apps cap a QR from photos at ₹2,000. If yours does, choose “Pay UPI ID” there and paste — the ID is copied for you.</p>
            )}
            <button className="btn" disabled={busy} onClick={saveAndOpen}>Save QR and open {app.short}</button>
            <div className="foot-row">
              <button className="btn plain" onClick={() => setStage('pay')}>Back</button>
              <button className="btn plain" onClick={directLink}>Try direct link</button>
            </div>
          </>
        ) : canPay ? (
          <>
            <p className="status muted">Pay with</p>
            <div className="apps">
              {UPI_APPS.map((a) => (
                <button key={a.id} className="app" onClick={() => { haptic(); setApp(a); setStage('guide'); }} aria-label={`Pay with ${a.name}`}><i style={{ background: a.color }} />{a.short}</button>
              ))}
            </div>
            <button className="btn plain" disabled={busy} onClick={markPaid}>I’ve paid another way — mark as paid</button>
          </>
        ) : (
          <button className="btn" disabled={busy} onClick={markPaid}>{mine ? 'I’ve paid — mark as paid' : 'Mark as received'}</button>
        )}
      </div>
    </>
  );
}
