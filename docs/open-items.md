# Open items

Things that are known, deliberately not done yet, and need a decision or more work. Newest context first.

## 1. INR <-> USDC rate and the 1% fee are not implemented anywhere  (needs a product decision)

**What the product walkthrough says** (Voucher Rail walkthrough v3, 5 Nov 2026)

| | |
|---|---|
| Rate | Set by the **two users in the order** (example: Rs 90 per USDT). Not a fixed or oracle rate. |
| Voucher | Rs 10,000 |
| Buyer of crypto receives | **111.11 USDT** (10,000 / 90) |
| Fee | **1%** of that = **1.11 USDT** |
| Seller of crypto locks | **112.22 USDT** (amount + fee) |
| Fee split (proposal) | 0.56 USDT to the dispute reserve, 0.55 USDT platform revenue |

**What the code does today**

- **Backend** (`POST /requests`): takes `amountInr` and `amountUsdc` as two independent numbers. It stores the rate-free pair, **never checks that they agree**, locks `amountUsdc` exactly, and on release pays **all of it** to the fulfiller. There is **no fee, no reserve split and no rate field.**
- **Chatbot** (`draft_request`): produces only the INR amount and a suggested voucher split. It has no rate and does not compute USDC.
- **Simulations/tests** use a fixed adapter, Rs 90 per USDC, with no fee (`backend/scripts/integration-sim.js`, `real-firestore-check.mjs`). They prove the wiring, **not** the economics.

**Consequences if shipped as is**

- The platform earns nothing and the dispute reserve is never funded.
- A client can post `amountInr: 10000` with `amountUsdc: "0.01"` (or the reverse) and the backend accepts it, so the INR/USDC pair is unvalidated.
- The numbers shown to the seller ("you lock 112.22") and the buyer ("you receive 111.11") are not produced by any single piece of code.

**Decisions needed before building**

1. **Who sets the rate, and how is it kept honest?** Seller types it? Agreed in an order book? Bounded against a market price (e.g. reject if more than X% away)? Where is it stored (suggest a `rateInrPerUsdc` field on the request)?
2. **Fee mechanics.** The escrow must hold `amount + fee`. Release must pay `amount` to the fulfiller and split the fee. The current contract interface (`release(id, to)` pays everything to one address, see `backend/src/services/escrow.js`) has to change, and the contract is not deployed yet, so this is the cheapest moment to change it.
3. **What happens to the fee on cancel, refund or dispute?** The walkthrough doesn't say. Refund the full lock, or keep the fee?
4. **Rounding.** USDC has 6 decimals. 1.11 USDT does not split evenly (0.56 + 0.55). Define who gets the spare base unit and how INR to USDC is rounded (and the INR side is a whole number).
5. **One source of truth for the numbers.** Compute them once (backend, exposed over the API) and have the chatbot and frontend only display them, so what the seller sees is what the contract locks.
6. **Limits.** Backend: `amountInr` must be a whole number <= 100,000. Chatbot currently accepts any positive amount up to Rs 10 crore (the seller then gets a clean 400). Decide the real limit and enforce it in both.
7. **Token.** The backend and walkthrough use USDC/USDT. If ETH was intended (the early diagram said ETH), the escrow model changes.

**Tests to write once decided:** fee math at awkward amounts (Rs 1, Rs 99, Rs 100,000), rounding/dust, the invariant `locked == paid_to_fulfiller + fee`, refund and dispute paths, rate bounds, and an end-to-end check that seller-shown and buyer-shown numbers match the contract call.

## 2. Other known gaps (short list)

- **Escrow is mocked** (`ESCROW_MODE=mock`): no contract deployed, no operator key. Nothing has moved on a chain.
- **World ID is mocked** in all tests. Real verification needs a real person with the World App.
- **Voucher-code verification is only half-built.** `backend/extension` (merged from `backend-integration`) lets the buyer check a Woohoo voucher on their own device (status, balance, expiry); the chatbot now tells the buyer to use it (`verify_before_submit`). But: it only reads woohoo.in (other portals can't be checked), it can't tell the brand, the result never reaches the backend (so `confirm`/release does not depend on it), and only the success response was captured from the real site. A server-side or attested check is still needed before the backend can trust it. Also still to do: a bridge from the website to the extension, and the login round-trip is untested.
- **Card reward data:** about 62% of matrix rows are assumed base rates, not confirmed per merchant. Bank portal links are landing pages, not per-brand pages. HDFC uses the GyFTR instant-vouchers page though research says the 5X route is inside SmartBuy. SBI has no portal link. CRED has no reward data and its URL is a placeholder (`https://cred.club`).
- **Chatbot API has no authentication**: it trusts `user_id`. Add real auth before exposing it.
- **Chatbot offers only merchants the backend supports** (Amazon, Flipkart, Myntra, BigBasket, Swiggy, Zomato). Adding more means adding the brand to backend `BRANDS` **and** `chatbot/data/backend_brands.json` (a contract test fails if the two differ).
- **In-memory Firestore stand-in** is not a substitute for the real emulator for index and rules behaviour; real-Firestore checks are in `backend/scripts/real-firestore-check.mjs`.
