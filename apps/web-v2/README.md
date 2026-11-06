# NetPositive frontend

Light product UI for voucher-based USDC trading. Source lives in `apps/web-v2`.

## Local preview

```sh
cd apps/web-v2
npm install
npm run dev -- --host 127.0.0.1 --port 5174
```

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Landing page with intersecting Pay / Buy actions and an effective-rate example |
| `/home` | Buy USDC: amount, Market / Limit, 1–8% slippage, preview matching, calculator |
| `/home?mode=sell` | Pay with crypto: voucher catalogue, buyer demand, voucher amount, rate and fee |
| `/market` | Search, category filters, cash-value effective-rate sorting and order selection |
| `/cards` | Wallet-scoped local card portfolio, custom rates, bonus cap usage |
| `/profile` | Wallet, local username, signed account session, World ID |
| `/profile?tab=disputes` | Load disputes and report issues on eligible real backend requests |

`/sell` redirects to Pay with crypto inside Trade. The old `/trade/:id` simulator redirects to Trade. No simulator remains in product navigation.

## Implemented behavior and boundaries

- Trade modes preserve separate amounts and order types. Whole-voucher matching respects buy limit prices and market slippage. No partial voucher fills or overspending.
- Preview orders are scoped to the connected wallet and can be cancelled during the session. They do not fund escrow or move USDC.
- The calculator uses the same saved card portfolio as Cards and Market. Statement value is the default; travel value is an explicit selection. Bonus caps, discounted qualifying spend, denomination splits and per-transaction rounding apply to the illustrative model. These are not current issuer offer feeds.
- The assistant expands on focus. Available orders shrink with a height transition and remain scrollable. Collapse restores the market area. Optional chatbot service uses `VITE_CHATBOT_URL`; an offline/local helper can still fill order amounts and explain fees.
- Card metadata and usernames persist in localStorage, scoped by wallet. No PAN, CVV, voucher secret or bearer token is written there. Usernames are local aliases, not globally reserved handles.
- Wallet connection uses the existing provider discovery and SDK connectors. Account sign-in requests a nonce and signs the fixed backend sign-in message with that same provider. Account changes invalidate the session and identity UI.
- World ID uses `@worldcoin/idkit` 4.6, server-signed RP context, Proof of Human, and server-side proof verification. No timer or local boolean can mark a trader verified. The World signing credential stays on the backend. Mock services are refused for verification.
- Disputes load from authenticated real requests. Only `code_submitted` requests offer reporting. Submitting a reason calls the existing dispute endpoint; no fake resolution or refund is displayed.

## Backend contract

The frontend targets the API contract already present on `origin/testing` (`backend/src/routes`). No backend branch is merged into this checkout.

| Endpoint | Use |
| --- | --- |
| `GET /health` | Availability and `worldIdMock` status |
| `POST /auth/nonce` | Wallet-bound sign-in message |
| `POST /auth/verify` | Sign-in signature → memory-only bearer session and user |
| `GET /auth/me` | Authenticated user profile |
| `POST /world-id/request` | Signed `{ app_id, action, signal, rp_context, environment }` |
| `POST /world-id/verify` | Forward IDKit result unchanged; accept only explicit verified result |
| `GET /requests/mine` | `{ asRequester, asFulfiller }` used for history and disputes |
| `POST /requests/:id/dispute` | Authenticated `{ reason }` |

Vite proxies `/api` to port 8080. For a separate deployment, set `VITE_API_URL` to the HTTPS backend origin and configure its CORS for the frontend. Do not place signing keys or backend credentials in Vite variables.

World ID end-to-end completion requires that backend to be running with real RP/app configuration, `WORLD_ID_MOCK=false`, and a user completing World App/the configured staging flow. Dispute data requires real authenticated backend trades. A disconnected or unavailable service is shown as such, not as an empty successful response.

## Checks

```sh
npm run typecheck
npm run build
npm test
```

Tests cover fee accounting, net reward valuations, rounding and caps, slippage/limit boundaries, sign-in message validation and offline/mismatched account responses. Browser QA is separate; if computer access is disabled, build success is not a visual or wallet end-to-end check.

World integration reference: https://docs.world.org/world-id/idkit/react and https://docs.world.org/world-id/idkit/signatures.

## Integrated chatbot lifecycle

See [`docs/frontend/chatbot-integration.md`](../../docs/frontend/chatbot-integration.md) for the precise upstream commits, behavior mapping and live API boundaries. The guide, portfolio and order actions now live inside Trade's existing expanding chat rather than opening the removed simulator.

Start the original local recommendation service with `npm run chatbot`. Run `npm run test:chatbot-live` against it to check seller discovery/drafting and buyer portfolio/route ranking. Free-form responses require the service's optional OpenRouter configuration; guided actions do not.
