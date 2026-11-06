# World ID in NetPositive

Status as of 6 Nov 2026. Code: `backend/src/services/{worldid,humans,recovery}.js`, `backend/src/routes/{worldid,recovery}.js`.
Tests: `backend/scripts/smoke.js` (full flow), `backend/scripts/world-upstream.test.js` (real verification path, World faked).

## The trust moments

NetPositive moves money between strangers for a voucher code. Three moments need to know "which real person is this":

| Moment | What World ID gives us |
|---|---|
| **Sign-up** (both sides: the crypto seller who locks USDC, the voucher buyer who fulfils) | One real person, one account. No farm of throwaway wallets. |
| **Fraud ban** (a used voucher is sold, or a false "it was used" complaint is made) | The *human* is banned, not the wallet. A new wallet cannot get back in. |
| **Lost wallet** (funds are locked in escrow, the wallet key is gone) | The same human can prove it is them from a new wallet and take over their account and trades. |

## Why Proof of Human, and nothing lighter

All three moments need a **stable, unique, per-person identifier** (the nullifier for one action). Sign-up needs
"is this person already here?", a ban needs "is this the banned person?", recovery needs "is this the owner?". A
device-level or liveness-only credential cannot give a stable one-person-one-id guarantee, so Proof of Human is the
minimum that makes all three work. We request no other credential and store only the nullifier (no identity, no biometrics).

## Flows

**Sign-up** (`POST /world-id/request` → IDKit widget → `POST /world-id/verify`)
1. The wallet signs in. The server signs an RP request bound to that wallet (`signal` = wallet) and remembers its nonce.
2. The user completes Proof of Human in the widget.
3. The server checks: schema, action, environment, the nonce (used once), the signal (this wallet), expiry. Then it forwards
   the result unchanged to `https://developer.world.org/api/v4/verify/{rp_id}` and accepts only an explicit `success: true`
   for our environment.
4. The nullifier is stored as the canonical decimal string. One nullifier maps to one wallet.

**Fraud ban** (`POST /requests/:id/resolve`, admin)
- `refund` (the voucher was bad) → the **fulfiller** is at fault. `release` (the voucher was fine, the complaint was false) →
  the **requester** is at fault. The arbitrator can pass `fault: "none"` when it cannot be determined, and nobody is banned.
- The ban is applied after the money has moved. It marks the nullifier, the current wallet and every earlier wallet of that
  human. A banned wallet is locked out. The same person on a new wallet gets `human_banned` at sign-up and at recovery.

**Wallet recovery** (`/recovery/*`)
1. New wallet signs in (it has no World ID yet) and proves it is the same human → `POST /recovery/start`. A waiting period
   (`RECOVERY_DELAY_MINUTES`, default 60) starts.
2. During the wait the old wallet, if it is still in the owner's hands, can `cancel`.
3. After the wait the new wallet calls `complete`. The nullifier moves to the new wallet, reputation comes with it, the old
   wallet loses its verified status, trades where the old wallet was requester or fulfiller are rebound, and unfunded orders are cancelled.
4. A recovered requester's escrow was deposited by the old wallet, so a later refund is paid to the new wallet through the
   operator's `release()` (see "Trade-offs").

## Failure and alternative paths (covered by tests)

- Wrong action, replayed result, proof made for another wallet, malformed result → refused.
- World says `success: false`, omits `success`, answers for another environment, errors or is unreachable → refused (502 for outages), nobody is verified.
- A second wallet using an already-used human → `world_id_already_used` (points to recovery).
- A different human tries to recover someone's account → `no_account_to_recover`.
- Recovery too early → `recovery_too_early`; only the new wallet completes, only the old wallet cancels.
- Banned human on a new wallet, at sign-up or recovery → `human_banned`.

## Trade-offs (state these in the submission)

- **Recovery relies on the operator.** The deployed escrow records the old wallet as depositor and cannot rotate it. Refunds
  to a recovered wallet are paid by the operator's `release()`. The operator can already release any escrow, so this adds no
  new power, but it is a trusted party. A contract-level `rotateDepositor` would remove it and needs a redeploy.
- **The 7-day timeout still pays the old wallet.** Anyone can trigger `claimAfterTimeout` after the contract's delay and it
  refunds the depositor, i.e. the lost wallet. Recovery must complete before that.
- **Old-wallet veto.** Anyone holding the old wallet's key can cancel a recovery. That is intended (the owner's veto), but a
  thief holding the key could also keep cancelling. The waiting period is a mitigation, not a guarantee.
- **Fault is decided by the arbitrator.** There is no automatic proof that a voucher was already used; the ban is only as good as that decision.
- **Same action everywhere.** Recovery works only if one human gives the same nullifier each time they prove for our action.
  Confirmed with the simulator (same nullifier on both proofs). Not yet confirmed with a real World App.
- Public request documents show wallets (already public on-chain) and which side was banned, never the other wallets of a banned or recovered person.

## What has and has not been tested

| | Status |
|---|---|
| Whole flow (sign-up, bans, recovery, trades) with World mocked, in-memory Firestore | Passing (`npm run test:smoke-memory`) |
| Real verification path with World's verifier faked | Passing (`npm run test:world`) |
| **Real sign-up: signed RP request, IDKit widget, World simulator (staging), World's v4 verifier accepts, nullifier bound to a wallet** | **Done, 6 Nov 2026** (test page `tools/world-test`, first success after 158 s) |
| **Real recovery of the account identity: a second wallet proves the same human, gets the same nullifier, completes after the wait, account moves** | **Done, 6 Nov 2026** (simulator identity; same nullifier on both proofs) |
| Recovery of live trades and escrow refunds with real World ID | Not done. The real run had no trades (`moved` was all zeros); trade rebinding is covered only by the mocked smoke test |
| Fraud bans with a real World proof | Not done. Covered by the mocked smoke test only |
| A real World App on a phone | **Failed for `staging`**: World answered `integrity_verification_failed` (the phone adds a device-integrity bundle that staging does not accept). The `sandbox` environment needs the private World ID Sandbox app, which was not installed. The simulator works. |
| Against the Firestore emulator (`npm run smoke`) | Not run |

### Things found by running it for real (useful for the debrief)

- `expires_at_min` in the result is the minimum credential expiry the request asked for, **not** a deadline. It equals roughly the request time, so comparing it to "now" rejects every real proof.
- IDKit's result uses decimal strings for the proof and nullifier, and may include extra fields (such as `integrity_bundle` from a phone). Forward the payload to World unchanged.
- The simulator's result has no `integrity_bundle`; a phone's does, and a staging request approved on a real phone is refused.
- World returns errors as `{ code, detail }` (for example `integrity_verification_failed`); the docs list only 200, 400 and 404 for the verify call.
- One human proving the same action twice gives the same nullifier, which is what makes recovery and bans possible.

## To test it for real

1. In the World Developer Portal: create/confirm the app and RP, and create the action named in `WORLD_ID_ACTION`
   (an action is just a name; no portal setting was needed).
2. In `backend/.env` (git-ignored): `WORLD_ID_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `WORLD_ENVIRONMENT=staging`, `WORLD_ID_MOCK=false`.
   Never put the signing key in the repo or in chat.
3. A frontend that runs the IDKit widget (Proof of Human preset) with the values from `POST /world-id/request`, and posts the result to `/world-id/verify`.
4. Verify on wallet A, then sign in on wallet B and run `/recovery/start` with a second proof of the same person.

## Integration debrief (to fill in honestly while testing)

- Time to first successful verification:
- Friction:
- Missing capability or documentation:
- The one improvement with the greatest impact:
