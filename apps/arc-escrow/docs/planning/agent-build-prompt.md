# Build prompt: NetPositive backend

Copy everything below the line into your coding agent, run from the root of the `NetPositive` repo.

---

You are implementing the backend of **NetPositive** for ETHGlobal Mumbai. Submission deadline: **Saturday 7 Nov 2026, 09:00 IST**. Work in small, working increments and commit after each one with a clear message. The judges check for steady git history, so never squash everything into one commit at the end.

Read `README.md`, `docs/planning/project-brief.md`, `docs/design/voucher-rail-walkthrough.html` and `docs/research/card-mcc-reward-matrix.csv` before writing code.

## 1. What the product does

A peer-to-peer trade of a **gift voucher for USDC**:

- **Seller** has USDC and wants a voucher for a merchant (e.g. ₹10,000 Lifestyle). They lock USDC + a 1% fee in an escrow contract.
- **Buyer** wants USDC. They buy the voucher with their own credit card on the best reward route (e.g. HDFC Infinia via SmartBuy, 5X) and keep 100% of their card rewards. We only predict those rewards; we never pay them.
- A **verification layer** proves the voucher is live and unspent before the seller's USDC is released.
- **Proof-of-Unspent**: disputes are settled by attested proofs of the issuer's balance page, not by an admin. A voucher can be sold on the platform only once.
- **World ID**: one human per account; a proven cheater is banned for good.

Worked example to use in tests and the demo: seller locks **111.11 USDC + 1.11 USDC fee** for **2 × ₹5,000 Lifestyle vouchers** at ₹90/USDC.

## 2. Hard rules

1. **Never store, log or transmit** card numbers, CVV, PIN, OTP or bank passwords. The backend never sees card data.
2. **Voucher codes never exist in plaintext on our servers or on-chain.** They are encrypted on the buyer's device to the seller's encryption key. Only a hash (fingerprint) goes on-chain.
3. **No third-party trackers or analytics** anywhere (EF CROPS rule).
4. **Do not invent** chain IDs, contract addresses, SDK method names or API endpoints. Look them up in the official docs listed in section 10. If you can't confirm one, leave a clearly marked `TODO(verify)` in config and tell me.
5. Every number the card engine returns must carry its `source` and `status` from the dataset. If `status` is `X`, the card earns 0% for that category and must never be recommended for it.
6. Add a line to `AI_USAGE.md` for every file you generate, naming the file and saying it was written with an AI coding agent.
7. Keep secrets in `.env` (git-ignored) and commit a `.env.example` with placeholder values only.

## 3. Target chain

- **Primary: Arc testnet, settling in USDC.** Get the RPC, chain ID, USDC address and faucet from Arc's docs. Put them in `config/chains.ts`, not in code.
- The Arc prize requires the project to be **built in Arc Studio**. Write the contracts so they compile in Foundry locally *and* can be pasted into Arc Studio unchanged: plain Solidity, OpenZeppelin imports only, no custom tooling. Leave a note in the README where the human adds the Arc Studio project URL.
- **Optional module, behind a feature flag (`ENABLE_SWAP_IN=false` by default):** `SwapInAdapter`, which lets a seller fund an order with any token, swapped to USDC through Uniswap's Universal Router with a `minUsdcOut`. Only enable it on a chain where Uniswap's official deployment list shows the router. Uniswap's list currently shows no Arc testnet, so on Arc the flag stays off.

## 4. Repo layout to create

```
contracts/                 Foundry project
  src/VoucherEscrow.sol
  src/IdentityRegistry.sol
  src/AttestorRegistry.sol
  src/ReserveVault.sol
  src/SwapInAdapter.sol    (feature-flagged, optional)
  src/lib/Attestations.sol EIP-712 structs + verification
  test/                    one test file per contract + an end-to-end flow test
  script/Deploy.s.sol
services/
  attestor/                Node + TypeScript: proves voucher balance, signs EIP-712 attestations
  api/                     Node + TypeScript: orders, World ID verification, card engine, events indexer
packages/
  shared/                  types, EIP-712 domain + struct definitions shared by contracts tests, services and the extension
config/
  chains.ts
  issuers.ts               voucher issuers and their balance-check sources
data/
  card-mcc-reward-matrix.csv  (copy from docs/research)
AI_USAGE.md
.env.example
```

Use pnpm workspaces. Use Foundry for contracts, Fastify (or Express) for the API, viem for chain access, SQLite via Drizzle or Prisma for off-chain state (orders mirror, encrypted payload pointers, user public keys).

## 5. Smart contracts

### 5.1 Data shared by all contracts

EIP-712 domain: `name = "NetPositive"`, `version = "1"`, the chain ID, and the verifying contract.

Attestation structs (define once in `packages/shared` and `Attestations.sol`):

```solidity
struct HumanAttestation {          // signed by the identity signer after World ID server verification
    address account;
    bytes32 nullifierHash;         // World ID nullifier for our app/action
    uint64  issuedAt;
    uint64  expiresAt;
}

struct BalanceAttestation {        // signed by an allowlisted attestor
    bytes32 voucherHash;           // keccak256(abi.encode(issuerId, normalizedCode, normalizedPin))
    bytes32 issuerId;              // keccak256 of the issuer slug, e.g. "gyftr"
    bytes32 brandId;               // keccak256 of the brand slug, e.g. "lifestyle"
    uint256 balancePaise;          // balance in paise (₹1 = 100)
    bool    redeemed;              // true if the issuer shows any redemption
    uint64  lastRedeemedAt;        // 0 if the issuer page has no redemption history
    uint64  observedAt;            // when the attestor saw the page
    bytes32 proofRef;              // hash/ID of the underlying zkTLS proof (0 in fallback mode)
}
```

### 5.2 `AttestorRegistry`

- Owner-managed allowlist of attestor signer addresses and an `identitySigner`.
- `threshold` (default 1). Write the verification to accept N signatures so we can raise it later.
- `maxAttestationAge` (default 10 minutes); stale attestations revert.

### 5.3 `IdentityRegistry`

- `register(HumanAttestation, sig)`: links `msg.sender` to a `nullifierHash`. One nullifier ↔ one account. Reverts on reuse.
- `isBanned(address)`, `isVerified(address)`.
- `ban(address)`: callable only by `VoucherEscrow`. Banning marks the **nullifier**, so a new wallet with the same World ID can't register.

### 5.4 `ReserveVault`

- Holds the reserve share of fees in USDC.
- `payout(order, to, amount)`: callable only by `VoucherEscrow`, capped by `maxPayoutPerOrder` and `maxPayoutPerDay`.
- Public view of the balance.

### 5.5 `VoucherEscrow` (the core)

Parameters (constructor + owner setters, all emitted as events): `feeBps = 100` (1%), `reserveShareBps = 5000` (half the fee goes to the reserve, half to the treasury), `holdbackBps = 1000` (10% of buyer payout held back), `acceptWindow`, `deliverWindow`, `confirmWindow`, `challengeWindow`. Use short windows on testnet (minutes) via config.

**There is no admin function that moves user funds.** The owner can only change parameters for *future* orders, manage attestors and pause *new* orders. Write this in a NatSpec comment, because it is the CROPS censorship-resistance claim.

Order states:

```
Open → Accepted → Delivered → Released → Closed
  ↘ Cancelled (seller, before accept)
Accepted → Expired (buyer didn't deliver in time; seller refunded)
Delivered → Slashed (provable fraud; seller refunded, buyer banned)
Delivered / Released → Disputed (ambiguous; frozen for resolution)
```

Functions:

1. `createOrder(brandId, faceValuePaise, usdcAmount, buyerMustBeVerified=true)`: pulls `usdcAmount + fee` from the seller (USDC has 6 decimals). Emits `OrderCreated`.
2. `cancelOrder(orderId)`: seller only, `Open` only, full refund.
3. `acceptOrder(orderId)`: caller must be verified and not banned in `IdentityRegistry`. Sets buyer and `deliverDeadline`.
4. `deliverVoucher(orderId, BalanceAttestation[] atts, bytes[] sigs, bytes32 sealedPayloadHash)`:
   - Each attestation is valid, fresh, from an allowlisted attestor, with the right `brandId`, `redeemed == false`, and the summed `balancePaise >= faceValuePaise`.
   - Each `voucherHash` is **not already in `usedVoucher`**; mark it used (this is the double-sell block).
   - Store `sealedPayloadHash` (hash of the encrypted code bundle stored off-chain) and `deliveredAt = block.timestamp`.
5. `confirmReceived(orderId)`: seller only, `Delivered`. Pays the buyer `usdcAmount − holdback`, splits the fee (reserve/treasury), stores `releasedAt`, starts the `challengeWindow` on the holdback.
6. `releaseWithRecheck(orderId, BalanceAttestation[] recheck, sigs)`: anyone, after `confirmWindow` if the seller hasn't confirmed or challenged. Requires fresh attestations with `observedAt > deliveredAt` showing the full balance still unredeemed. Same payout as `confirmReceived`, and stores `recheckAt`.
7. `challenge(orderId, BalanceAttestation[] spent, sigs)`: seller only, before release or within `challengeWindow` after release. The attestation must show `redeemed == true` or `balancePaise < face value` for one of the order's `voucherHash`es. Resolution:
   - `lastRedeemedAt != 0 && lastRedeemedAt < deliveredAt` → **Slashed**: the voucher was spent before the seller could have had it. Refund the seller in full (or pay out the holdback plus a reserve top-up if already released), ban the buyer.
   - Already released, and `lastRedeemedAt < recheckAt` → **Slashed** (the recheck was wrong or the page was stale).
   - Otherwise (no redemption timestamp, or spent after delivery) → **Disputed**: funds frozen, emit `Disputed`. Ambiguous cases can't be decided by proof alone, so don't guess.
8. `resolveDispute(orderId, sellerShareBps)`: callable only by a `disputeResolver` address (a multisig for the hackathon). Document in the README that this is the one human-trust component and that it can't touch any order that isn't `Disputed`.
9. `closeOrder(orderId)`: after `challengeWindow`, pays the holdback to the buyer.
10. `expireOrder(orderId)`: anyone; refunds the seller if the buyer missed `deliverDeadline`.

Events for every state change, including `orderId`, the parties and amounts, so the API can index them.

Security requirements: checks-effects-interactions, `ReentrancyGuard`, `SafeERC20`, no `tx.origin`, signature replay protection (attestation digest marked used per order), all arithmetic on the fee and holdback tested for rounding.

### 5.6 `SwapInAdapter` (optional, flag off)

`createOrderWithToken(tokenIn, amountIn, minUsdcOut, deadline, …)` swaps through the Universal Router, then calls `createOrder`. Revert if the output is below `minUsdcOut`. Never read a spot pool price as an oracle.

### 5.7 Tests (Foundry)

Write tests for at least these cases:
- The happy path with the worked example amounts: exact payouts, reserve and treasury split, holdback, close.
- Cancel; expiry; the release-after-recheck path.
- Double-sell: the same `voucherHash` in a second order reverts.
- Stale, unsigned, wrong-brand or replayed attestations revert.
- Insufficient balance reverts.
- Challenge → Slashed when `lastRedeemedAt < deliveredAt`; buyer banned; a new wallet with the same nullifier can't register.
- Challenge → Disputed when there's no redemption timestamp; `resolveDispute` splits correctly; only the resolver can call it.
- The owner cannot move funds from any live order (try every owner function).
- Reserve payout caps.
- Fuzz tests on amounts for rounding.

## 6. Attestor service (`services/attestor`)

Purpose: look at a voucher issuer's balance-check page and sign a `BalanceAttestation`.

1. **Mode A, zkTLS (preferred):** use a zkTLS SDK (evaluate Reclaim Protocol first) to generate a proof from the issuer's balance-check page that reveals only the balance, status, redemption history (if the page shows it) and a hash of the code. Verify the proof in the service, then sign the EIP-712 attestation with `proofRef` = the proof's ID or hash. This is the same trust model ZKP2P (Peer) uses: zkTLS proof → signed attestation → escrow release.
2. **Mode B, fallback:** if zkTLS can't be made to work for the issuer in time, the service queries the balance page itself and signs, with `proofRef = 0`. The API and the UI must show "trusted attestor mode" whenever `proofRef == 0`.
3. Start with **one issuer** in `config/issuers.ts`. Confirm in the issuer's real page whether redemption history with timestamps is visible. If it isn't, `lastRedeemedAt = 0`, and say in the README that disputes then fall back to the Disputed path.
4. Rate-limit and back off. If the issuer shows a captcha or blocks automated access, stop and report it; don't try to bypass it.
5. The service receives the code only transiently, in memory, over TLS, to compute the hash and run the check. It never writes the code to disk or logs. Add a test that greps logs for the test code and fails if it's found.
6. Endpoint: `POST /attest/balance` → `{ attestation, signature, mode }`.

## 7. API service (`services/api`)

1. **World ID:** `POST /identity/verify` verifies an IDKit proof server-side for our app and action (follow World's docs; never trust a client-side result), then returns a signed `HumanAttestation` for `IdentityRegistry.register`. Use the **Proof of Human** credential, and write a short README paragraph on why that's the minimum assurance needed. Return clear errors for cancelled, failed and already-used verifications.
2. **Encryption keys:** `POST /keys` stores a user's public encryption key (X25519, generated in the extension) against their address. Voucher bundles are encrypted client-side with it (libsodium sealed box). The API stores **only ciphertext**, served by `GET /payloads/:orderId` to the seller after an ownership check. Its hash must match `sealedPayloadHash` on-chain.
3. **Orders:** read-only mirror of on-chain orders built by an event indexer (viem `watchContractEvent` with a backfill on start). `GET /orders?status=open&brand=…`, `GET /orders/:id`.
4. **Voucher catalogue:** `GET /brands` (brand slug, issuer, denominations, redemption mode online/in-store), from `config/issuers.ts`.
5. **Card engine:** `POST /recommend` with `{ brand, amountInr, cards:[{bank, card, capsUsed}] }` (the portfolio comes from the extension and is **not stored**). It uses `data/card-mcc-reward-matrix.csv`:
   - Score every (card × route) for category `GVP` (bank portal voucher) and `GVD` (direct gift card).
   - Apply per-transaction rounding by denomination: points = floor(denomination ÷ spend unit) × points per unit × multiplier.
   - Subtract remaining monthly caps from `capsUsed`.
   - Exclude `status = X`. Return `status = A` (base rate assumed) and `U` (unknown) with explicit labels.
   - Return the ranked list plus `reasonsNotChosen` for every losing option, each with `source` and the dataset date.
   - Unit-test the worked example: Infinia, Lifestyle 2 × ₹5,000, 3,000 bonus RP available → 1,650 RP, 16.5% at ₹1/RP, 4.95% at ₹0.30/RP; and the cap-exhausted case where InstaDeals becomes best.
6. **Chat support:** `POST /explain` takes the `/recommend` output and returns plain-language reasons. If you use an LLM, pass it only the ranked result and rule citations (never the user's full portfolio) and tell it not to compute numbers itself.
7. OpenAPI spec at `GET /openapi.json`. CORS is restricted to the extension origin and the web app.

## 8. Deliverables and acceptance checks

Done means all of this works:

1. `forge test` passes, including the fuzz tests. Coverage report committed.
2. `pnpm -r test` passes.
3. `script/Deploy.s.sol` deploys everything to Arc testnet. Addresses are written to `deployments/arc-testnet.json` and listed in the README.
4. `scripts/e2e.ts` runs the worked example on testnet end to end: seller creates → buyer verifies identity and accepts → attestor attests → buyer delivers → seller confirms → close. A second run tries to reuse the same voucher and is rejected. A third run proves a pre-delivery redemption and ends in `Slashed` with the buyer banned. Print explorer links for each transaction.
5. README sections:
   - **Architecture** (diagram, the contracts, which component is trusted for what)
   - **CROPS** (Control/Censorship resistance, Open source, Privacy, Security: one paragraph each, including the attestor and dispute resolver as the trust points)
   - **Arc** (Arc Studio project URL placeholder, which Circle tools are used, the track entered: "Best Smart Contracts with Advanced Stablecoin Logic")
   - **World ID** (why Proof of Human; integration debrief: time to first success, friction, missing docs, top improvement)
   - **Limits** (voucher terms, issuer access, ambiguous disputes, fallback attestor mode)
6. `AI_USAGE.md` lists every AI-assisted file.

## 9. Order of work

1. Monorepo skeleton, shared EIP-712 types, `.env.example`. Commit.
2. Contracts + tests (happy path first, then fraud paths). Commit after each contract.
3. Deploy to Arc testnet. Commit.
4. Attestor in fallback mode (Mode B) end to end. Commit.
5. API: identity, keys/payloads, orders indexer. Commit.
6. Card engine + tests. Commit.
7. e2e script. Commit.
8. zkTLS mode (Mode A) for the one issuer, if time allows. Commit.
9. README sections and `AI_USAGE.md`. Commit.

After each step, tell me what works, what's stubbed, and any `TODO(verify)` you left.

## 10. Official docs to use (look up, don't guess)

- Arc: https://docs.arc.network/ and https://docs.arc.io (testnet RPC, chain ID, USDC, faucet, Arc Studio)
- World ID IDKit: https://docs.world.org/world-id/idkit/integrate and https://docs.world.org/world-id/idkit/credentials
- Uniswap deployments (only if the swap flag is enabled): https://developers.uniswap.org/docs/protocols/v4/deployments
- ZKP2P architecture (reference design for zkTLS-attested escrow): https://www.mintlify.com/zkp2p/zkp2p-contracts/architecture
- zkTLS SDK: Reclaim Protocol's official docs (find the current URL; don't guess method names)
- OpenZeppelin Contracts (EIP712, ECDSA, SafeERC20, ReentrancyGuard, Ownable2Step, Pausable)
