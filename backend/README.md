# NetPositive backend

Express + Firestore backend for P2P gift-card ↔ USDC escrow on Arc, with World ID proof-of-human.

**Roles**
- **crypto_spender** (was requester): has USDC, wants a voucher. Locks USDC in escrow and confirms the code.
- **crypto_buyer** (was fulfiller): buys the gift card with INR, submits the code and is paid in USDC.

## Quick start (local, no chain, no World App)

```bash
cd backend
npm install
cp .env.example .env        # set JWT_SECRET + VOUCHER_ENC_KEY; keep ESCROW_MODE=mock, set WORLD_ID_MOCK=true
npm run emulator            # terminal 1: Firestore emulator on :8085 (needs Java 11+)
npm run dev                 # terminal 2: API on :8080
npm run smoke               # or: full lifecycle test in a throwaway emulator
```

`ESCROW_MODE=mock` and `WORLD_ID_MOCK=true` are refused when `NODE_ENV=production`.

## Lifecycle

```
pending_funding ─fund─▶ open ─accept─▶ accepted ─submit-code─▶ code_submitted ─confirm / review timeout─▶ released
      │                  │  ▲              │                          │
   cancel             cancel └─fulfil timeout┘                      dispute ─▶ disputed ─admin─▶ released | refunded
      ▼                  ▼
  cancelled          refunded
```

Every transition runs in a Firestore transaction and writes to `requests/{id}/events`. Payouts use a two-phase lock (`releasing` / `refunding`), so double confirms, and confirms racing the sweeper, can't pay out twice.

## API

All authenticated routes need `Authorization: Bearer <token>`. 🧍 = World ID required.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/auth/nonce` | anyone | `{address}` → message to sign |
| POST | `/auth/verify` | anyone | `{address, signature}` → `{token, user}` |
| GET | `/auth/me` | auth | profile + reputation |
| GET | `/world-id/config` | anyone | `app_id`, `rp_id`, `action`, `environment` |
| POST | `/world-id/rp-signature` | auth | signs the Proof of Human request (`sig`, `nonce`, `created_at`, `expires_at`, `rp_id`) |
| POST | `/world-id/verify` | auth | `{ rp_id, idkitResponse }` → World v4 verify, then binds the nullifier to the wallet |
| GET | `/requests?brand=&limit=` | anyone | open requests |
| GET | `/requests/mine` | auth | `{asCryptoSpender, asCryptoBuyer}` |
| GET | `/requests/:id` | anyone | request state |
| POST | `/requests` | auth 🧍 | `{brand, amountInr, amountUsdc}` → returns `escrowId`, `amountUsdcBaseUnits` |
| POST | `/requests/:id/fund` | crypto spender 🧍 | `{txHash}`; verifies the escrow on-chain |
| POST | `/requests/:id/cancel` | crypto spender | cancel (unfunded) or refund (funded, unaccepted) |
| POST | `/requests/:id/accept` | crypto buyer 🧍 | locks the request for `FULFIL_WINDOW_MINUTES` |
| POST | `/requests/:id/submit-code` | crypto buyer 🧍 | `{code, pin?}`, encrypted at rest |
| GET | `/requests/:id/voucher` | crypto spender | decrypted code (admin too, while disputed) |
| POST | `/requests/:id/confirm` | crypto spender | releases USDC to the crypto buyer |
| POST | `/requests/:id/dispute` | either party | `{reason}` |
| POST | `/requests/:id/resolve` | admin | `{outcome: release\|refund, note?}` |
| GET | `/buy-intents?amountInr=&brand=` | anyone | active buy requests that fit: same voucher, or no voucher (any brand). No `brand` means amount only |
| GET | `/buy-intents/mine` | auth | my active buy request, or `null` |
| POST | `/buy-intents` | auth 🧍 | `{amountInr, voucher?}`: "I want USDC for this INR amount"; `voucher` is a brand or null. One per wallet, replaces the previous one, expires after 24 h |
| DELETE | `/buy-intents/mine` | auth | withdraw my buy request |
| POST | `/internal/sweep` | cron (`x-cron-secret`) | handles timeouts |

## Frontend integration

1. **Sign in:** `POST /auth/nonce` → `signMessage(message)` → `POST /auth/verify` → store the token.
2. **World ID:** sign in, then `POST /world-id/rp-signature`. Open IDKit with Proof of Human, `action`, and **`signal = the signed-in wallet address`**. POST `{ rp_id, idkitResponse }` to `/world-id/verify`. The server forwards the result to World's v4 verifier and keeps one human on one wallet.
3. **Fund:** after `POST /requests`, from the user's wallet: `USDC.approve(escrow, amountUsdcBaseUnits)` → `escrow.deposit(escrowId, amountUsdcBaseUnits)` → `POST /requests/:id/fund {txHash}`.
4. **Live status:** `onSnapshot(doc(db, 'requests', id))` from the client SDK. Rules allow reads of `requests/*` only. Codes live in a backend-only subcollection.

`escrowId = keccak256(toHex(requestId))`, which is also returned by the API.

## Escrow contract (to build on Arc)

The backend expects the interface documented at the top of [src/services/escrow.js](src/services/escrow.js): `deposit`, operator-only `release(id, to)` / `refund(id)`, and an `escrows(id)` view. For the CROPS track, also add a permissionless `claimAfterTimeout`, so funds can't get stuck if this backend goes away.

## Data model

```
users/{address}                       reputation {completed, disputes, strikes}, worldIdNullifier, banned
worldIdNullifiers/{nullifierHash}     → address   (one human ↔ one wallet)
authNonces/{address}                  one-time sign-in message, 5 min TTL
buyIntents/{address}                  a crypto buyer's {amountInr, voucher|null, status, expiresAt}; shown to spenders as a recommendation
requests/{id}                         public lifecycle state
requests/{id}/private/voucher         AES-256-GCM encrypted {code, pin}, AAD = request id
requests/{id}/events/{auto}           audit trail
```

Deploy rules and indexes with `firebase deploy --only firestore` (see `firestore.rules` and `firestore.indexes.json`).

## Not done yet

- Gift-card API path (Pay2All / Qwikcilver) for instant fulfilment
- Rate limiting (add `express-rate-limit` before the hackathon demo is public)
- Automatic code validity checks; disputes are resolved manually by `ADMIN_ADDRESSES`

## Voucher vault

Voucher codes can be sealed in the browser so the server never sees them. See [docs/vault.md](../docs/vault.md); tests: `npm run vault:test` and `npm run vault:e2e`.
