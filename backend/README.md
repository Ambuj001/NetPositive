# NetPositive backend

Express + Firestore backend for P2P gift-card ↔ USDC escrow on Arc, with World ID proof-of-human.

**Roles**
- **Requester**: has USDC, wants a voucher. Locks USDC in escrow and confirms the code.
- **Fulfiller**: buys the gift card with INR, submits the code and is paid in USDC.

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

## Testing without Java/Firebase (in-memory Firestore)

`npm run smoke:mem` runs the full lifecycle smoke test against an in-memory Firestore stand-in (`test-support/`), loaded through a Node module hook, so the backend source is untouched and **no Java, emulator or Firebase project is needed**.

`npm run sim` runs the chatbot + backend integration simulation: the Python chatbot API (`../chatbot/server.py`) and this backend side by side. It covers seller query -> merchant choice -> request draft -> `POST /requests` -> simulated escrow deposit -> `POST /requests/:id/fund` -> open and listed, plus validation/abuse cases and the buyer side.

- Uses throwaway secrets generated at start-up; never reads `.env`; refuses to run if real Firebase credentials are set.
- `ESCROW_MODE=mock` and `WORLD_ID_MOCK=true`: **no funds move and no chain is contacted.**
- The stand-in does not model composite-index requirements, security rules or latency. Use the real emulator (`npm run smoke`) for those before release.

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
| GET | `/world-id/config` | anyone | public IDs for IDKit |
| POST | `/world-id/request` | auth | signed request for the IDKit widget (signal = wallet) |
| POST | `/world-id/verify` | auth | IDKit v4 result → verified with World, binds one human to one wallet; refuses banned humans |
| POST | `/recovery/start` | new wallet | prove you are the same human as a lost wallet; starts the waiting period |
| GET | `/recovery/mine` | auth | recoveries where I am the new or old wallet |
| POST | `/recovery/:id/cancel` | old wallet | veto a recovery during the wait |
| POST | `/recovery/:id/complete` | new wallet | after the wait: account, reputation and live trades move to the new wallet |
| GET | `/requests?brand=&limit=` | anyone | open requests |
| GET | `/requests/mine` | auth | `{asRequester, asFulfiller}` |
| GET | `/requests/:id` | anyone | request state |
| POST | `/requests` | auth 🧍 | `{brand, amountInr, amountUsdc}` → returns `escrowId`, `amountUsdcBaseUnits` |
| POST | `/requests/:id/fund` | requester 🧍 | `{txHash}`; verifies the escrow on-chain |
| POST | `/requests/:id/cancel` | requester | cancel (unfunded) or refund (funded, unaccepted) |
| POST | `/requests/:id/accept` | fulfiller 🧍 | locks the request for `FULFIL_WINDOW_MINUTES` |
| POST | `/requests/:id/submit-code` | fulfiller 🧍 | `{code, pin?}`, encrypted at rest |
| GET | `/requests/:id/voucher` | requester | decrypted code (admin too, while disputed) |
| POST | `/requests/:id/confirm` | requester | releases USDC to the fulfiller |
| POST | `/requests/:id/dispute` | either party | `{reason}` |
| POST | `/requests/:id/resolve` | admin | `{outcome: release\|refund, note?}` |
| POST | `/internal/sweep` | cron (`x-cron-secret`) | handles timeouts |

## Frontend integration

1. **Sign in:** `POST /auth/nonce` → `signMessage(message)` → `POST /auth/verify` → store the token.
2. **World ID (v4):** `POST /world-id/request` (signed in) returns everything the IDKit widget needs (`app_id`, `action`, `environment`, `signal`, `rp_context`). Run the widget with the **Proof of Human** preset, then POST its result to `/world-id/verify`. Each human can be linked to only one wallet. Full detail: [docs/world-id.md](../docs/world-id.md).
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
requests/{id}                         public lifecycle state
requests/{id}/private/voucher         AES-256-GCM encrypted {code, pin}, AAD = request id
requests/{id}/events/{auto}           audit trail
```

Deploy rules and indexes with `firebase deploy --only firestore` (see `firestore.rules` and `firestore.indexes.json`).

> **Open item: the INR<->USDC rate and the 1% fee are not implemented anywhere yet.** See [docs/open-items.md](../docs/open-items.md) for what the walkthrough specifies, what the code does, and the decisions needed.

## Not done yet

- Gift-card API path (Pay2All / Qwikcilver) for instant fulfilment
- Rate limiting (add `express-rate-limit` before the hackathon demo is public)
- Automatic code validity checks; disputes are resolved manually by `ADMIN_ADDRESSES`
