# Integrated Trade chatbot

## Source and scope

- Guided frontend reference: `origin/backend-_ui`, commit `36f95eb4b2f614d6a5ac58c1b5c27c1f17b4a68b`, fetched 6 November 2026.
- Recommendation service: original `chatbot/` from `origin/ai-chatbot`, commit `de3ab7babc41e4876f42edfdfc79882678b4d7df`.
- Existing light design, expanding chat, Buy / Pay with crypto switch, market/limit controls, slippage and calculator are retained. No merge from the backend branches is required.

## Preserved guided paths

`UpstreamAssistant.tsx` retains the original `backend-_ui` Assistant conversation instead of reimplementing its state machine. The source snapshot is kept in `tests/fixtures/backend-ui-Assistant.tsx`; parity tests compare search, store selection, amount validation, card add/remove, request selection, AI fallback, retry, input dispatch, quick replies and active-block rules.

Seller: original greeting → store shortcuts or product search → locked store / alternatives / fallback tiles → selected store → amount (₹250–₹2,00,000) → backend voucher draft and denomination split → Lock & post → Follow the trade.

Buyer: service portfolio → original quick-add cards or typed card name → Continue / show requests → pick request → ranked researched routes, source/date badges, steps and portal links → Accept & open trade.

There is one chatbot panel in the Trade workspace, beside the current order ticket. The previous empty “Your next trade” panel and added inline checklist, voucher-entry and lifecycle screens are not rendered in chat. My orders remains accessible separately. The source message animation, typing indicator, autoscroll, restart, close, quick replies and block enablement are retained. A scoped stylesheet applies the current light theme.

The recommendations use the unchanged deterministic Python service. Free-form AI uses the original optional OpenRouter configuration and original missing-key reply. No replacement local parser intercepts the original dispatch. Card add/remove also updates the app portfolio; store/draft/request selection updates the existing ticket without changing the conversation step.

Each role keeps its own mounted conversation after first use. Wallet changes remount it; anonymous sessions use an isolated guest identifier. Upstream action handling and validation are retained, including its original limitations.

## App handoffs

The original post action is connected to the current `Home` callback rather than the upstream mock-wallet store. It opens wallet connection when necessary, creates an authenticated request when the account service is available, or saves a labelled preview without moving funds. Posting errors remain errors. A live request still requires its escrow deposit; a successful create call is not presented as funded settlement.

The original Follow the trade / Accept & open trade buttons open the existing `OrderLifecycle` in a separate trade-details dialog. This replaces navigation to the upstream trade page, since the simulator route is removed here. Voucher codes, PINs and tracking controls do not appear as chatbot messages or additional conversation steps.

The order book reads `GET /requests` every 15 seconds and labels its fallback as sample data. My orders reads the requester/fulfiller split every 10 seconds after sign-in. The separate live trade-details UI uses the current account API for create/deposit, accept, submit code/PIN, reveal, confirm, cancel and dispute actions. Backend errors never advance live status.

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

The frontend workflow runs the build, frontend logic and source-parity tests, all 72 upstream Python tests and a real local guided-service integration test. Browser visual QA and real wallet/World/Arc settlement verification are distinct checks; they are not established by these tests.
