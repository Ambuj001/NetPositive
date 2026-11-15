# Operations

How to host NetPositive against the live contract, which keys exist, and what the owner, arbiter and operator have to do.

Contract: `VoucherEscrowV2` on Arc mainnet (chain 5042) at `0x14ed5880d4c2cbf0459f5ab019651aaa0f168ea2`. Roles, settings and transactions are recorded in `contracts/deployments/arc-mainnet.json`.

## Keys and wallets

| Key | Held by | Power | If it leaks |
|---|---|---|---|
| Owner wallet | A person (a multisig is strongly preferred) | Settings for future orders, pause, replace arbiter and guardian | Fees and limits for new orders can be changed and the arbiter replaced. Existing undisputed escrows are safe. Move ownership at once (`transferOwnership`, then `acceptOwnership` from the new owner). |
| Arbiter wallet | A person, or the backend if `ESCROW_ARBITER_PRIVATE_KEY` is set | Split disputed escrows | Disputed escrows can be ruled wrongly. The owner replaces it with `setArbiter`. |
| Guardian wallet | A person | Pause new deposits | Deposits can be paused; the owner unpauses and replaces it with `setGuardian`. |
| Keeper key | Backend environment | None in the contract; pays gas | Its small gas balance can be spent. Replace it. |
| `JWT_SECRET`, `VOUCHER_ENC_KEY`, World ID signing key | Backend environment | Sessions, legacy voucher encryption, World ID requests | Rotate; sessions are invalidated. |

Never put the owner key on a server. The keeper needs about 1 USDC on Arc for gas (Arc pays gas in USDC) and should be topped up when it runs low.

## Web app (static host, for example Vercel)

Project root `apps/web-v2`, build `npm run build`, output `dist`. `vercel.json` already rewrites every path to the app.

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://<your backend host>` |
| `VITE_ARC_NETWORK` | `mainnet` |
| `VITE_ESCROW_CONTRACT` | `0x14ed5880d4c2cbf0459f5ab019651aaa0f168ea2` |
| `VITE_WALLETCONNECT_PROJECT_ID` | From cloud.reown.com. Add the site's domain to the project's allow-list. |
| `VITE_WORLD_ID_ENV` | `production` |
| `VITE_CHATBOT_URL` | `https://<your chatbot host>` (leave unset to hide the assistant) |

A production build refuses to send escrow transactions unless `VITE_ESCROW_CONTRACT` is set, and flags a mismatch with the address the server reports.

## Backend (any Node 22 host)

Start command `npm start` in `backend/`. One instance should run the timeout sweep; with several instances set `SWEEP_INTERVAL_SECONDS=0` on all of them and call `POST /internal/sweep` from one scheduler with `x-cron-secret`.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | The web app's `https://` origin(s). Required in production. |
| `TRUST_PROXY` | `1` behind a platform proxy or load balancer |
| `JWT_SECRET`, `VOUCHER_ENC_KEY` | Fresh random values (commands are in `.env.example`) |
| `VOUCHER_MODE` | `sealed` |
| `ADMIN_ADDRESSES` | Wallets allowed to decide disputes in the admin API |
| `CRON_SECRET` | Random value, if an external scheduler calls the sweep |
| `FIREBASE_PROJECT_ID` + credentials | The production Firestore project |
| `WORLD_ID_APP_ID`, `WORLD_ID_RP_ID`, `WORLD_ID_SIGNING_KEY`, `WORLD_ID_ENV=production` | From the World developer portal |
| `ESCROW_MODE` | `chain` |
| `ARC_CHAIN_ID` | `5042` |
| `ARC_RPC_URL` | `https://rpc.mainnet.arc.io` (or a dedicated provider endpoint) |
| `ESCROW_CONTRACT_ADDRESS` | `0x14ed5880d4c2cbf0459f5ab019651aaa0f168ea2` |
| `USDC_ADDRESS` | `0x3600000000000000000000000000000000000000` |
| `ESCROW_KEEPER_PRIVATE_KEY` | A new key with no other use, funded with about 1 USDC |
| `ESCROW_ARBITER_PRIVATE_KEY` | Optional. Only if the backend should send dispute rulings itself; it must be the key of the contract's arbiter address. |
| `DISPUTE_BOND_USDC` | `0` (the stake is set in the contract) |

In production the server refuses to start with a mock escrow, mocked World ID, a World ID bypass, or without https CORS origins. Rate limits (300 requests and 60 writes per minute per address), security headers and request logs are on by default.

Check after deploying: `GET /health` shows `escrowMode: "chain"`, `chainId: 5042` and the contract address; `GET /escrow/terms` shows the fee, limits and stake read from the contract.

## Chatbot (optional, Python 3.11+)

`python server.py` in `chatbot/`. Set `JWT_SECRET` to the backend's value, `CHATBOT_HOST=0.0.0.0`, `PORT`, `CHATBOT_CORS_ORIGINS=https://<web app origin>` and the model provider variables from `chatbot/.env.example`.

## The owner's jobs

All of these are transactions from the owner wallet to the contract. They apply to orders created afterwards.

| Job | Call |
|---|---|
| Raise or lower limits, change the dispute stake | `setToken(USDC, true, min, max, cap, disputeBond)` |
| Change the fee or the reserve share | `setFee(feeBps, reserveShareBps)` (fee at most 500 = 5%) |
| Change the review and fulfil windows | `setWindows(reviewSeconds, fulfillSeconds)` |
| Replace the arbiter or guardian | `setArbiter(address)`, `setGuardian(address)` |
| Change where fees go | `setFeeRecipients(treasury, reserve)` |
| Stop new deposits in an emergency | `pause()` (the guardian can too); `unpause()` to resume |
| Collect fees | `withdrawFees(USDC)` (anyone can call; funds go to treasury and reserve) |
| Hand ownership to a multisig | `transferOwnership(safe)`, then `acceptOwnership()` from the Safe |

At launch the arbiter, treasury and reserve are the same address. Separate them before volume grows: the reserve is meant to be distinct from revenue, and the wallet that judges disputes should not be the one that receives fees.

## The arbiter's job

A dispute appears in the admin API (`ADMIN_ADDRESSES`) with both sides' statements and screenshots. Decide, then:

- with `ESCROW_ARBITER_PRIVATE_KEY` set: `POST /requests/:id/resolve` with the verdict; the server sends `resolve` and records it;
- without it: send `resolve(escrowId, toFulfiller)` from the arbiter wallet (the full amount to pay the buyer, 0 to refund, anything between to split), then post the same verdict so the server records it.

A dispute left undecided for 30 days refunds the spender.

## What to watch

- **Keeper balance** on Arc. If it is empty, timeouts stop being sent by the server (the parties can still send them).
- **`GET /escrow/terms`**: `lockedBaseUnits` against `capBaseUnits`, and `paused`.
- **Server logs** for `[sweep]` and `[settle]` errors and for `[rate-check]` when no live rate was available.
- **Contract events** `Deposited`, `Settled`, `Disputed` on the explorer.

## Verifying the contract's source on the explorer

The explorer's API sits behind a browser check, so this is done by hand in its "Verify contract" form:

- Compiler `0.8.24`, EVM version `paris`, optimizer on with 200 runs.
- Method "Standard JSON input": upload `contracts/deployments/arc-mainnet.standard-input.json`.
- Contract name `src/VoucherEscrowV2.sol:VoucherEscrowV2`.
- Constructor arguments: the contents of `contracts/deployments/arc-mainnet.constructor-args.txt`.

## Deploying a new version of the contract

`node tools/deploy/serve.mjs`, then open `http://127.0.0.1:4174` in the browser with the owner's wallet. The page validates the settings, simulates, lets the wallet sign the deployment and the "enable USDC" call, and reads everything back from the chain. Point the web app and backend at the new address; trades on the old contract finish there.

## Before raising the launch limits

1. An external audit of `VoucherEscrowV2.sol`.
2. Ownership moved to a multisig; arbiter, treasury and reserve separated.
3. Source verified on the explorer.
4. A dedicated RPC endpoint for the backend.
