# Chukta

Split expenses with friends and settle over UPI in one tap. ("Chukta" = settled.)

- **Flexible splits** — equal, exact amounts, percentages, shares, or adjustments; one or many payers.
- **Pay without typing** — whoever you owe, send their QR straight into GPay / PhonePe / Paytm from the share menu, with the amount and UPI ID already in it.
- **No server, no sign-up** — data lives on each phone and syncs phone-to-phone, end-to-end encrypted.
- **Liquid Glass look** on iPhone and Android. A Material 3 Expressive theme is also built in: open with `?ui=md` (`?ui=ios` to switch back).

## How sync works

A group is a random 128-bit key, carried in the invite link after the `#` (browsers never send that part anywhere).

- Every change (add expense, mark paid, …) is an operation, **encrypted** with a key derived from the group key and **signed** by the device that made it.
- Operations are saved on the device and mirrored through free public [Nostr](https://nostr.com) relays, which act as mailboxes. Relays see only ciphertext.
- Every device reduces the same operations to the same balances (`src/lib/ledger.ts`), so there is nothing to conflict.
- The app works offline; changes go out when you're back. If a relay loses data, any phone that has it re-uploads it.

## Security model

- Only people with the invite link can read or write the group. **The link is the key — share it only with the group.**
- Joining ties your name to your phone. After that only your phone can change your name or UPI ID, so nobody can redirect your payments. The pay sheet says who added a UPI ID and warns if it changed recently.
- Whoever created the group can reset a member who switched phones.
- Anyone in the group can add, edit or delete expenses (like Splitwise). Payments are self-reported — UPI gives apps no way to confirm a transfer — and can be removed if money never arrived.
- Not protected against: a group member acting in bad faith with a modified app (they could, for example, backdate changes), or losing every phone that holds the group.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test
```

It is a static site: `npm run build` produces `dist/`, which GitHub Pages can serve for free (`.github/workflows/web.yml`; enable once under repo Settings → Pages → Source: GitHub Actions).
For offline development, `npm run relay` starts a local relay; open the app with `?relays=ws://localhost:7777`.

## Android and iOS apps

`android/` and `ios/` are Capacitor projects wrapping the same web app. Every push builds both in GitHub Actions and publishes them on the repo's Releases page:

- **Chukta-android** — a debug APK you can install directly.
- **Chukta-ios** — an unsigned `.ipa`; install with a sideloading tool that signs with your Apple ID, or on a Mac run `npx cap open ios` and press Run.

The web code is bundled inside the apps, so app users get changes by installing a new build. After changing web code locally: `npm run build && npx cap sync`.

## Code map

| Path | What |
| --- | --- |
| `src/lib/ledger.ts` | Operations and the reducer that turns them into group state |
| `src/lib/sync.ts` | Encryption, device keys, local storage, relay sync |
| `src/lib/money.ts` | Split maths, balances, debt simplification (integer paise) |
| `src/lib/upi.ts` | `upi://pay` links and per-app schemes |
| `src/Group.tsx`, `src/ExpenseSheet.tsx`, `src/PaySheet.tsx` | The main screens |

UPI apps refuse most direct links to personal UPI IDs, so the main route is sharing the QR image into the UPI app. Direct links are still offered; if one works on a phone, the app remembers and leads with it. Some apps cap payments from a shared QR at ₹2,000.
