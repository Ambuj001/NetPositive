# NetPositive AI chatbot (branch `ai-chatbot`)

Per-user, portfolio-filtered card recommendations for both sides of the voucher swap.

- `data/cards.json` – structured card/route data built from `data/research/2026-11-05` (grades, sources, checked-on dates kept; stale ICICI iShop rows are flagged unverified).
- `engine.py` – deterministic math (per-transaction rounding, bonus caps, discounts) and the **portfolio filter**. The LLM never computes rewards.
- `llm.py` – OpenRouter client with tool calling. `user_id` is bound in code, so one user can never see another's portfolio.
- `cli.py` – interactive test: `python cli.py saad buyer` / `python cli.py shivam seller`.
- `tests/test_engine.py` – offline tests (`python -m unittest discover -s tests`).
- `tests/live_test.py` – live LLM test against OpenRouter.

Setup: copy `.env.example` to `.env` and add your OpenRouter key (`.env` is git-ignored).

Known gaps: seller side only has Voucher Rail + Crypto.com Obsidian; MCC matrix PDF not yet parsed; many SECONDARY/PENDING rows need official re-verification.
