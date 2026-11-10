// UPI deep links. The same URI is what a UPI QR code encodes.
export const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9.-]{2,64}$/;
export const isVpa = (s: string) => VPA_RE.test(s.trim());

export interface UpiRequest { vpa: string; name: string; amount: number; note: string }

function query({ vpa, name, amount, note }: UpiRequest) {
  // Built by hand: UPI apps are picky — spaces must be %20 (not "+") and "@" must stay literal.
  const enc = (s: string) => encodeURIComponent(s).replace(/%40/g, '@');
  return `pa=${enc(vpa)}&pn=${enc(name)}&am=${(amount / 100).toFixed(2)}&cu=INR&tn=${enc(note.slice(0, 50))}`;
}

export const upiUri = (r: UpiRequest) => `upi://pay?${query(r)}`;

export const UPI_APPS = [
  { id: 'gpay', name: 'Google Pay', short: 'GPay', color: '#4285F4', link: (r: UpiRequest) => `tez://upi/pay?${query(r)}` },
  { id: 'phonepe', name: 'PhonePe', short: 'PhonePe', color: '#5f259f', link: (r: UpiRequest) => `phonepe://pay?${query(r)}` },
  { id: 'paytm', name: 'Paytm', short: 'Paytm', color: '#00baf2', link: (r: UpiRequest) => `paytmmp://pay?${query(r)}` },
] as const;

export const isMobile = () =>
  typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
