# NetPositive AI chatbot (branch `ai-chatbot`)

Per-user, portfolio-filtered card recommendations for both sides of the voucher swap, plus the browser-extension and website flows.

## Two flows, one engine

| Flow | Entry point | What it does |
|---|---|---|
| **Extension** (any shopping site) | `POST /recommend` -> `engine.recommend_for_merchant` | Domain -> category/MCC -> ranks **only the user's cards** by reward. No vouchers, no LLM. |
| **Website** ("Nike shoes from Amazon") | `POST /chat` (LLM) or `POST /plan` (no LLM) -> `engine.plan_voucher_purchase` | Store -> voucher brand -> `redirect.url` = the **best card's bank portal** (landing page; user picks the brand there) + steps + CRED as `second_option`. `voucher_rail_url` is a separate placeholder for our own request page. |

### Request lifecycle (seller of crypto -> buyer of crypto)

1. **Seller** types what they want. `POST /merchants/suggest {"query"}` (`flow.suggest_merchants`): "shoes" -> ranked merchant tiles (big players first, only merchants with a voucher); "nike shoes" -> stores that sell Nike; "nike shoes from amazon" -> Amazon locked + alternatives; unknown product -> Amazon/Flipkart fallback. One merchant per request.
2. **Seller** picks one + amount. `POST /request/draft {"merchant","amount","item"?}` -> the request payload (voucher brand, amount, suggested split). Nothing is posted: the backend posts it and locks the crypto in escrow.
3. **Buyer** accepts. `POST /request/fulfil {"user_id","brand","amount"}` (`flow.fulfil_request`) -> ranked options from the buyer's own cards, **best first (`best: true`), verified before unverified**, each with its own bank-portal `link`, steps, source/date, plus `must_match` (brand + total the code must match), CRED as `second_option`, and next steps.
4. **Buyer** opens a link, buys the voucher, submits the code (backend). **Seller** then verifies it with the browser extension (`backend/extension`) using `POST /request/verify_guide` / `verify_received_voucher` (steps, expected paise, limits), and confirms or disputes.

The LLM never computes rewards and never sees cards outside the caller's portfolio. `user_id` is bound in code, not passed by the model.

## Files

- `data/cards.json` - card catalogue (35 cards, each mapped to the MCC matrix), hand-researched voucher routes (SmartBuy/InstaDeals/iShop...), seller options.
- `data/mcc_matrix.json` - **630 rows = 30 cards x 21 categories**, parsed from `card-mcc-reward-matrix-v2.pdf` by `tools/parse_mcc_matrix.py` (validated: every card has all 21 categories).
- `data/portals.json` - bank voucher portal landing pages (HDFC/ICICI/Axis/Amex/Kotak; SBI has none yet) and the CRED second option (no reward data, so none is claimed).
- `data/backend_brands.json` - copy of the brands the escrow backend accepts. The chatbot only offers/drafts these; a contract test in `backend/scripts/integration-sim.js` fails if it drifts from backend `BRANDS`.
- `data/merchants.json` - domains/aliases -> category group, voucher brand, merchant-specific offers (Amazon Pay ICICI @ Amazon, Flipkart Axis, Tata Neu).
- `matrix.py` - matrix lookups + merchant resolution (dot-boundary domain matching, so `amazon.in.evil.com` does not match).
- `engine.py` - all recommendation logic and per-user portfolios (thread-safe, atomic writes).
- `llm.py` - OpenRouter client with tool calling. `server.py` - JSON API. `cli.py` - terminal chat.

## Run

```
cp .env.example .env        # add OPENROUTER_API_KEY and JWT_SECRET (git-ignored)
python server.py            # http://127.0.0.1:8787 (needs JWT_SECRET, or CHATBOT_AUTH=off for local dev only)
python cli.py saad buyer    # terminal chat
python -m unittest discover -s tests          # offline tests (no network)
PYTHONIOENCODING=utf-8 python tests/live_test2.py   # live LLM test
```

## Login (who is calling)

User-specific endpoints (`/portfolio*`, `/recommend`, `/plan`, `/request/fulfil`, `/chat`) need the **backend's login token**:
`Authorization: Bearer <token from POST /auth/verify>`. The chatbot checks it with the same `JWT_SECRET` as the backend
(`auth.py`: HS256 only, `exp` required, `sub` must be a wallet address) and uses the wallet in the token as the user.
A `user_id` in the request is optional; if present it must be that same wallet, otherwise `403`. No token or a bad one is `401`.
Public (no token): `/health`, `/merchants/suggest`, `/request/draft`, `/request/verify_guide`.
The server refuses to start without `JWT_SECRET` (set `CHATBOT_AUTH=off` only for local development).

Example:

```js
fetch("http://127.0.0.1:8787/recommend", {method: "POST",
  headers: {"Content-Type": "application/json", "Authorization": "Bearer " + backendToken},
  body: JSON.stringify({url: location.href, amount: 10000, prime: true})})
```

## Status codes in results (from the matrix)

`V` verified from issuer terms | `S` secondary source, confirm | `A` base rate **assumed** for this MCC (394 of 630 rows) | `X` excluded | `U` unknown.
Rankings use the stated %, ties broken by confidence; `A`/`S` results are always flagged. Weekend-only boosts rank on the weekday rate. `has_cap` flags mean a monthly/cycle cap applies; caps already used are not tracked in the extension flow yet.

> **Open item: the INR<->USDC rate and the 1% fee are not implemented anywhere yet.** See [docs/open-items.md](../docs/open-items.md) for what the walkthrough specifies, what the code does, and the decisions needed.

## Known gaps / before production

- **Login is a token check only**: the chatbot does not ask the backend whether the user is banned or unknown, and has no per-user rate limit (each wallet is capped at 50 chat turns per session). Rotate `JWT_SECRET` (the old one leaked in git history). Deployment (HTTPS, CORS origins) is still to do.
- Merchant -> category map is best-effort (MCC is set by the acquirer). Only ~20 merchants are mapped; unknown sites need a category.
- Portal links are landing pages only (no per-brand deep links known). HDFC uses the GyFTR instant-vouchers page as requested, though research says the accelerated 5X route is inside SmartBuy. SBI has no link. `CRED_URL` defaults to https://cred.club (confirm). `voucher_brand` availability is not verified; `VOUCHER_RAIL_URL` is a placeholder.
- The 'split into vouchers' size (Rs 5,000) is an assumption from the Lifestyle example.
- Cards with no matrix data: ICICI Coral, Axis Magnus Burgundy, Flipkart SBI (reported as `no_data_for_cards`).
- Seller side only knows Voucher Rail and Crypto.com Obsidian (EEA-only).
- 62% of matrix rows are assumed base rates; SECONDARY/PENDING rows need official re-verification (see `data/research` README).
