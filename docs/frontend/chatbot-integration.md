# Integrated Trade chatbot

## Source and scope

- Guided frontend reference: `origin/backend-_ui`, commit `36f95eb4b2f614d6a5ac58c1b5c27c1f17b4a68b`, fetched 6 November 2026.
- Recommendation service: original `chatbot/` from `origin/ai-chatbot`, commit `de3ab7babc41e4876f42edfdfc79882678b4d7df`.
- Existing light design, expanding chat, Buy / Pay with crypto switch, market/limit controls, slippage and calculator are retained. No merge from the backend branches is required.

## Preserved guided paths

Seller: store shortcuts or product search → locked store / alternatives / fallback tiles → selected store → amount (₹250–₹2,00,000) → backend voucher draft and denomination split → review/post → inline request tracker.

Buyer: wallet-scoped service portfolio → add/remove known cards or explicitly import saved cards → choose request → ranked researched routes, with source, date, confidence, steps and bank portal → ranked or custom card/portal → purchase checklist → code, PIN and future-month expiry → inline backend status.

The recommendations come from the original deterministic Python engine. No LLM calculates rewards. Missing free-form AI credentials do not disable merchant, portfolio, draft or fulfil endpoints. Cash/card order commands still update the existing ticket locally.

Portfolio changes also update the local card list. Cards absent from the local illustrative calculator keep their name without fabricated earning rules. Selecting a researched recommendation sends its value to the calculator with its explicit travel-value basis and checked date. Local cash/travel assumptions remain available separately.

Both roles keep their own conversation in the mounted Trade workspace. Changing wallets remounts the conversation. Stale asynchronous responses are ignored, action buttons on older blocks are disabled, and simultaneous actions are serialized. Restart clears the upstream role conversation and reinitializes the guided flow. Anonymous chats use an isolated session identifier, not a shared guest portfolio.

## Real requests and previews

The order book reads `GET /requests` every 15 seconds and labels a fallback as sample data. My orders loads the same requester/fulfiller split as the source Track page, every 10 seconds after sign-in. Inline live tracking uses the existing account API for create, deposit receipt registration, accept, submit code/PIN, reveal, confirm, cancel and dispute links. Backend errors never advance live status.

Preview posting and buyer continuation remain possible without funded escrow. They are labelled preview, do not invent verifier signatures or payouts, and never display sample transitions as real on-chain settlement. The removed autoplay simulator is not reintroduced.

## Current service boundaries

- The recommendation service is an unchanged loopback-only service; its upstream portfolio API trusts `user_id`. It requires an authentication boundary before any public hosting.
- Free-form answers require the upstream OpenRouter configuration; the guided endpoints work without it.
- Real account sign-in, World ID, escrow funding and settlement require the separate account backend and Arc deployment. No service signing keys are bundled in the frontend.
- The current account API accepts one code and optional PIN per request. The UI preserves multi-voucher details and expiry validation, but refuses to silently drop additional codes or expiry data when sending to that single-code API. Split live delivery needs backend support; expiry is currently checked locally.
- Voucher codes and PINs stay in component memory, never chat text, recommendation requests, localStorage, logs or commits. Actual delivery is made only by the authenticated submit-code endpoint over the configured account connection. The API is responsible for server-side encryption; the frontend does not claim client encryption that it has not implemented.
- Existing issuer data retains its supplied checked dates and grades. It is not a live offers feed.

## Local checks

```sh
npm run setup:frontend
npm run chatbot                 # terminal 1
npm run dev                     # terminal 2
npm test
npm run build
npm --prefix apps/web-v2 run test:chatbot-live
python3 -m unittest discover -s chatbot/tests -p 'test_*.py'
```

The frontend workflow runs the build, frontend logic tests, all 72 upstream Python tests and a real local guided-service integration test. Browser visual QA and real wallet/World/Arc settlement verification are distinct checks; they are not established by these tests.
