# Timed voucher disputes

Frontend module: `DisputeCenter`, `useDisputes`, `disputes.ts`. The Dispute page hosts it, and Track embeds the same trade-scoped component. The old direct reveal/confirm panel is replaced so it cannot bypass the new acceptance and review UI. Chatbot logic remains untouched. Existing dispute history remains read-only; the former reason-only creation form is removed.

## Agreed policy

Roles are explicit: voucher buyer = crypto seller / escrow depositor / claimant; voucher seller = crypto buyer / voucher provider.

Server records `sharedAt` when the encrypted voucher is delivered. Acceptance closes at sharedAt + 5 minutes. No acceptance means cancel/refund, not automatic release to the voucher provider. The refund transition requires backend/contract execution, never a browser timeout.

The final dispute cutoff is fixed at sharedAt + 15 minutes, regardless of early acceptance/reveal. The displayed 5 + 10 windows are nominal phases; an early reveal leaves additional time before the same minute-15 cutoff. The frontend uses server timestamps and does not reset them on refresh. Missing timestamps never authorize a claim. Server time and contract rules are authoritative.

Only the voucher buyer opening a dispute deposits a bond equal to 1% of USDC principal, additional to the trading fee. Bond computation uses six-decimal integer arithmetic, rounding up fractional micro-USDC. Provider responses require no bond. A bond receipt alone does not freeze principal: backend validation and successful claim registration must atomically hold escrow before acknowledging the claim. Valid claims return the bond; false claims forfeit it. Destination of forfeited funds remains a backend policy decision.

Merchant review targets 72 hours from accepted claim registration. This is a service target, not an implemented automatic adjudication or guarantee. Confirmed invalid delivery can ban the voucher seller. An accepted replacement clears the seller ban but keeps a reputation penalty. A confirmed false claimant loses the bond and receives a buyer-profile ban and rating penalty under adjudication. NetPositive owns these reputation/ban records linked to a World ID nullifier; it does not modify a user's World ID credential. Exact scoring weights, replacement deadline and exceptional late merchant responses require backend policy.

## Proposed backend adapter (not implemented by the legacy account service)

All endpoints require wallet authentication and authorization by role. Base is `VITE_API_URL` / existing proxy. There is no silent fallback to a reason-only dispute.

- `GET /disputes/trades`: `{protocol:"voucher-disputes-v1",trades:DisputeTrade[]}`. Return only caller-owned trades and cases, server deadlines, confirmed escrow/bond state and reputation decisions. The TypeScript model is in `src/lib/disputes.ts`.
- `POST /disputes/trades/:id/accept-voucher`: acknowledge encrypted delivery within the acceptance window; return `{trade}`.
- `POST /disputes/trades/:id/reveal`: authorize only the voucher buyer after acceptance; persist the first reveal once, return `{trade,voucher:{code,pin?}}`. Repeated reveal does not extend cutoff. Secrets stay in component memory and clear on hide / wallet change.
- `POST /disputes/trades/:id/bond` with `{}`: prepare a chain-specific transaction `{trade,transaction:{chainId,to,data,value}}`. This does not send funds. Connect this intent to the trusted escrow wallet module; check configured chain, contract and calldata before signing. The current frontend exposes the intent and receipt-registration hook, not an automatic wallet payment.
- The same `bond` endpoint with `{txHash}` verifies chain receipt, depositor, contract, asset, amount, finality, intended trade and single-use reference. Return bond state `locked` only after settlement confirmation.
- `POST /disputes/trades/:id/evidence`: multipart `evidence` image, return `{evidenceId}`. UI allows PNG/JPEG/WebP up to 5 MB. Server must validate bytes, strip EXIF, scan/quarantine, enforce retention and private access, and prohibit public evidence URLs. Do not store screenshots or codes onchain or in browser persistence.
- `POST /disputes/trades/:id/open`: `{reason,evidenceIds}`. Atomically recheck recipient, state, fixed cutoff, verified bond and evidence ownership; persist claim, hold assets and return `{trade}` only on success. Uploading evidence does not reserve the deadline. Reject duplicate/racing claims idempotently.
- `POST /disputes/trades/:id/replacement`: `{vaultRecordId}`. Authorize only the voucher provider in replacement state. Resolve a recipient-encrypted vault record; never send the code through chat or a public field. Merchant/recipient verification is required before clearing a ban.

Adjudication is a separate authenticated staff/merchant operation. The client must never choose the winning party, assign ratings, unfreeze assets, or declare a deposit successful. Backend must enforce authorization, freeze/refund/release transitions and policy even if every browser is closed. World ID alone is not KYC or proof of a valid voucher.

## Current boundary

This change implements frontend views, countdowns, evidence selection, role-aware controls, replacement reference, decimal bond calculation and API hooks. It does not deploy contracts, change the backend, actually transfer a bond, freeze funds or verify merchants. Until the new protocol is available the view clearly reports the missing service and does not claim successful protection.

## Interactive design preview

The Dispute page shows an explicitly labelled, in-memory sample when the live protection service is absent. The preview has acceptance, reveal, evidence + bond consent, merchant review, recipient/provider roles, replacement, false-claim and timeout outcome screens. It never calls an API, opens a wallet, uploads evidence, transacts or persists a screenshot. Use the stage tabs to inspect states, or accept, reveal and report to walk through them. File validation matches the live form. Its sample principal is 1,000 USDC and the sample bond is 10 USDC. An early acceptance retains the original fixed minute-15 cutoff; changing scenario tabs intentionally restarts the selected sample scenario.

## frontened-2 integration

Based on 39f8975, preserving its Dashboard, Assistant, wallet store, Track and backend URL. The replacement is reachable at `/dispute`, `/disputes` and `/dispute/:id`. Existing DisputeSection / DisputeView / RaiseDispute exports remain compatible and use the shared module. The simulated Trade page opens only the labelled design preview. `dispute-transport.ts` reuses `lib/api.ts` API_URL and the existing store token; no second wallet or identity provider is introduced. Styling is scoped to the dispute surface.

The current legacy backend’s fixed 1 USDC bond endpoints do not implement the new 1% and timed protocol. They must not silently substitute for it. Existing legacy API and wallet helpers remain in lib/dispute.ts for backend migration and history access. Full funded disputes remain unavailable until the new protocol is implemented. No unsupported automatic freeze or adjudication is claimed.
