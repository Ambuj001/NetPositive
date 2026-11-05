# NetPositive AI chatbot (branch `ai-chatbot`)

Per-user, portfolio-filtered card recommendations for both sides of the voucher swap, plus the browser-extension and website flows.

## Two flows, one engine

| Flow | Entry point | What it does |
|---|---|---|
| **Extension** (any shopping site) | `POST /recommend` -> `engine.recommend_for_merchant` | Domain -> category/MCC -> ranks **only the user's cards** by reward. No vouchers, no LLM. |
| **Website** ("Nike shoes from Amazon") | `POST /chat` (LLM) or `POST /plan` (no LLM) -> `engine.plan_voucher_purchase` | Store -> voucher brand -> redirect link + best of the user's cards/channels to buy that voucher. |

The LLM never computes rewards and never sees cards outside the caller's portfolio. `user_id` is bound in code, not passed by the model.

## Files

- `data/cards.json` - card catalogue (35 cards, each mapped to the MCC matrix), hand-researched voucher routes (SmartBuy/InstaDeals/iShop...), seller options.
- `data/mcc_matrix.json` - **630 rows = 30 cards x 21 categories**, parsed from `card-mcc-reward-matrix-v2.pdf` by `tools/parse_mcc_matrix.py` (validated: every card has all 21 categories).
- `data/merchants.json` - domains/aliases -> category group, voucher brand, merchant-specific offers (Amazon Pay ICICI @ Amazon, Flipkart Axis, Tata Neu).
- `matrix.py` - matrix lookups + merchant resolution (dot-boundary domain matching, so `amazon.in.evil.com` does not match).
- `engine.py` - all recommendation logic and per-user portfolios (thread-safe, atomic writes).
- `llm.py` - OpenRouter client with tool calling. `server.py` - JSON API. `cli.py` - terminal chat.

## Run

```
cp .env.example .env        # add OPENROUTER_API_KEY (git-ignored)
python server.py            # http://127.0.0.1:8787
python cli.py saad buyer    # terminal chat
python -m unittest discover -s tests          # offline tests (no network)
PYTHONIOENCODING=utf-8 python tests/live_test2.py   # live LLM test
```

Extension example:

```js
fetch("http://127.0.0.1:8787/recommend", {method: "POST", headers: {"Content-Type": "application/json"},
  body: JSON.stringify({user_id: "saad", url: location.href, amount: 10000, prime: true})})
```

## Status codes in results (from the matrix)

`V` verified from issuer terms | `S` secondary source, confirm | `A` base rate **assumed** for this MCC (394 of 630 rows) | `X` excluded | `U` unknown.
Rankings use the stated %, ties broken by confidence; `A`/`S` results are always flagged. Weekend-only boosts rank on the weekday rate. `has_cap` flags mean a monthly/cycle cap applies; caps already used are not tracked in the extension flow yet.

## Known gaps / before production

- **No auth**: `user_id` is trusted. Add real auth before exposing the API.
- Merchant -> category map is best-effort (MCC is set by the acquirer). Only ~20 merchants are mapped; unknown sites need a category.
- `voucher_brand` availability is not verified against a voucher catalogue; the redirect URL (`VOUCHER_RAIL_URL`) is a placeholder.
- Cards with no matrix data: ICICI Coral, Axis Magnus Burgundy, Flipkart SBI (reported as `no_data_for_cards`).
- Seller side only knows Voucher Rail and Crypto.com Obsidian (EEA-only).
- 62% of matrix rows are assumed base rates; SECONDARY/PENDING rows need official re-verification (see `data/research` README).
