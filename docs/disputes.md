# Disputes (stake, screenshots, admin decision)

Code: `backend/src/services/disputes.js`, `backend/src/routes/disputes.js`. Tests: `npm run dispute:test` (58 checks, stake on and off) and section 3b of `npm run chain:e2e`.

## The rule

The person who raises a dispute **stakes USDC** (default 1, `DISPUTE_BOND_USDC`, `0` = off). The stake sits in the same deployed escrow contract under its own id.

| Admin decides | Stake | The trade | Disputer | Other party |
|---|---|---|---|---|
| Disputer **right** | back to the disputer | settled in the disputer's favour | gets their stake back | gets a strike |
| Disputer **wrong** | goes to the other party | settled in the other party's favour | **banned** | receives the stake |

"Settled in the disputer's favour": requester right = trade refunded; fulfiller right = trade released to the fulfiller. Wrong is the opposite.

## Flow for the frontend

1. `POST /requests/:id/dispute/bond` -> `{ amountBaseUnits, escrowId, escrowContract }`.
2. Wallet: `USDC.approve(escrowContract, amount)`, then `escrow.deposit(escrowId, amount)`.
3. `POST /requests/:id/dispute { category, reason, bondTxHash }`. The backend checks the deposit on-chain (right contract, right depositor, enough, Funded).
4. Optional, while disputed (either party, max 4 each): `POST /requests/:id/evidence?note=...` with the **raw image bytes** as the body and `Content-Type: image/png|image/jpeg|image/webp` (max 500 KB each). Stored in Firestore (`requests/{id}/evidence`).
5. The other party can answer once: `POST /requests/:id/dispute/respond { text }`.
6. Admin reads: `GET /requests/:id/evidence` (list), `GET /requests/:id/evidence/:evidenceId` (image). Only the two parties and admins can.
7. Admin decides: `POST /requests/:id/resolve { verdict: "disputer_right" | "disputer_wrong", note? }` (old `{ outcome }` still works).

Categories: `invalid_code, already_redeemed, wrong_amount, wrong_brand, expired, code_changed, code_is_valid, other`.

## Why the stake id has a secret

Anyone can call `deposit(id, ...)` for any id. If the stake id were guessable, the other party could deposit into it first and block the dispute. So the id includes a random nonce that only the disputer is given (`requests/{id}/private/bond-{address}`).

## Safe to retry

If a payout fails the dispute stays open with the verdict locked. Resolving again with the same verdict continues from where it stopped: the stake is paid once, the strike or ban is applied once, and the verdict cannot be flipped afterwards.

## Not built yet (decisions for the team)

- No timers: nothing auto-resolves a dispute that the admin never decides.
- The stake is a fixed amount, not a percentage of the trade.
- A lost dispute gives the other side a strike but no ban; decide a threshold (for example 3 strikes).
- The admin decision is manual and there is no admin screen yet.
- Screenshots may contain the voucher code. They are only readable by the two parties and admins, but the public `GET /requests/:id` still shows the dispute reason text.
- The stake is USDC (the escrow's token), not ETH.
- Real-chain run of section 3b needs the operator key (`OPERATOR_PK`, `CONFIRM_CHAIN_TX`); it has only been run in dry mode.
