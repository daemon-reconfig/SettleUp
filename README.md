# Chukta

Split expenses with friends and settle over UPI in one tap. ("Chukta" = settled.)

- **Flexible splits** — equal, exact amounts, percentages, shares, or adjustments; one or many payers.
- **One-tap pay** — whoever you owe, you get their UPI QR and deep links into GPay / PhonePe / Paytm / any UPI app with the amount and UPI ID prefilled.
- **Ticked off live** — mark it paid and everyone's balances update instantly.
- **No sign-up** — a group is a private link. Open it, pick your name, done.

## Run

```bash
npm install
npm run build
npm start        # http://localhost:3001
```

Development (hot reload on :5173, API on :3001): `npm run dev`. Tests: `npm test`.

Data lives in `data/chukta.db` (SQLite; override with `DATA_DIR`). Port via `PORT`.
UPI deep links only open from a phone, so deploy it over HTTPS (any Node 22+ host with a persistent disk) to use it for real.

## How it fits together

| Path | What |
| --- | --- |
| `server/index.js` | Express API, SQLite storage, server-sent events for live sync |
| `src/lib/money.ts` | Split maths, balances, debt simplification (all integer paise) |
| `src/lib/upi.ts` | `upi://pay` links and per-app schemes |
| `src/Group.tsx`, `src/ExpenseSheet.tsx`, `src/PaySheet.tsx` | The main screens |

## Things to know

- **Payments are self-reported.** UPI gives ordinary apps no way to confirm a transfer, so the payer taps "mark as paid" and the payee can remove it if money never arrived.
- **Anyone with the group link can edit the group**, including UPI IDs. Share links only with the people in the group.
- Some UPI apps limit or block deep-link payments to personal UPI IDs. The QR and copyable UPI ID are always there as a fallback.
