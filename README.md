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

## Test it on your phone

1. Run the server on your computer (`npm start`). It prints an address like `http://192.168.1.5:3001`.
2. With the phone on the same Wi-Fi, either open that address in the browser (on iPhone: Share → Add to Home Screen), or install the app and type the address on first launch.

## Android and iOS apps

The `android/` and `ios/` folders are Capacitor projects wrapping the same web app. Every push builds both in GitHub Actions (Actions → Build apps → Artifacts):

- **Chukta-android** — a debug APK you can install directly.
- **Chukta-ios** — an unsigned `.ipa`. Apple only runs signed apps, so either install it with a sideloading tool that signs with your Apple ID, or on a Mac run `npx cap open ios` and press Run with your phone plugged in.

Run the workflow manually with a `server_url` to bake your hosted server into the apps. After changing web code locally: `npm run build && npx cap sync`.

The look follows the device: Liquid Glass on Apple, Material 3 Expressive on Android. Add `?ui=ios` or `?ui=md` to any URL to preview the other one.

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
