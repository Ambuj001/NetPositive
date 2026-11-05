"""OpenRouter chat client with tool calling. Stdlib only.

user_id is bound in code (not a tool argument), so the model can never read
or recommend from another user's portfolio.
"""
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

import engine

API_URL = "https://openrouter.ai/api/v1/chat/completions"
ROOT = Path(__file__).parent


def _load_env():
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_env()
MODEL = os.environ.get("OPENROUTER_MODEL", "nvidia/nemotron-3.5-super-vl:free")

COMMON_RULES = """You are the card-optimisation assistant inside a crypto<->gift-voucher swap app.
Hard rules:
- Never do reward math yourself. Always call a tool and quote its numbers exactly.
- Only talk about cards returned by tools. If a card is not in the user's portfolio, do not suggest or compare it. Never mention cards the tools did not return.
- If the user asks about a card that is not in their portfolio, say it is not in their portfolio (do not say you lack data) and ask whether they actually hold it; only if they confirm, call add_card and re-run the recommendation. Never reveal what that card would earn before it is added.
- If the portfolio is empty, ask which cards the user holds and call add_card for each.
- Show the source grade (OFFICIAL/SECONDARY) and 'checked on' date for numbers you quote. Anything in needs_reverification must be called out as unverified/stale.
- If a card earns nothing (not_recommended), say so plainly and say which held card is better, if any.
- Say points are 'expected', not earned, until they post.
- Be concise, friendly, and answer in the user's language (English/Hinglish).
"""

BUYER_PROMPT = COMMON_RULES + """
You are talking to a BUYER of crypto: they pay for a gift voucher with their card and receive crypto in return.
Goal: tell them the best card + channel to buy the requested voucher, with exact steps, using recommend_voucher_routes.
Ask for brand/amount if missing, and whether they prefer travel-value or statement-credit redemption (default travel)."""

SELLER_PROMPT = COMMON_RULES + """
You are talking to a SELLER of crypto: they hold crypto and want a gift voucher/shopping.
Goal: use recommend_seller_options to compare the Voucher Rail (1% fee) with crypto-card options in THEIR portfolio only, respecting region limits."""

T_LIST = {"type": "function", "function": {"name": "list_my_cards", "description": "List the cards in this user's portfolio.", "parameters": {"type": "object", "properties": {}}}}
T_ADD = {"type": "function", "function": {"name": "add_card", "description": "Add a card to this user's portfolio by name.", "parameters": {"type": "object", "properties": {"card_name": {"type": "string"}}, "required": ["card_name"]}}}
T_REM = {"type": "function", "function": {"name": "remove_card", "description": "Remove a card from this user's portfolio.", "parameters": {"type": "object", "properties": {"card_name": {"type": "string"}}, "required": ["card_name"]}}}
T_BUY = {"type": "function", "function": {"name": "recommend_voucher_routes", "description": "Rank the best card+channel routes to buy a voucher, using only the user's own cards.", "parameters": {"type": "object", "properties": {"brand": {"type": "string"}, "amount": {"type": "number", "description": "INR"}, "value_mode": {"type": "string", "enum": ["travel", "statement"]}}, "required": ["brand", "amount"]}}}
T_SELL = {"type": "function", "function": {"name": "recommend_seller_options", "description": "Compare Voucher Rail with crypto-card options in the user's portfolio.", "parameters": {"type": "object", "properties": {"amount_inr": {"type": "number"}}, "required": ["amount_inr"]}}}

TOOLS = {"buyer": [T_LIST, T_ADD, T_REM, T_BUY], "seller": [T_LIST, T_ADD, T_REM, T_SELL]}


def run_tool(user_id, name, args):
    if name == "list_my_cards":
        return engine.list_portfolio(user_id)
    if name == "add_card":
        return engine.add_card(user_id, args.get("card_name", ""))
    if name == "remove_card":
        return engine.remove_card(user_id, args.get("card_name", ""))
    if name == "recommend_voucher_routes":
        return engine.recommend_voucher_routes(user_id, args.get("brand", "voucher"), float(args["amount"]), args.get("value_mode", "travel"))
    if name == "recommend_seller_options":
        return engine.recommend_seller_options(user_id, float(args["amount_inr"]))
    return {"error": f"unknown tool {name}"}


def _post(payload, retries=3):
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY missing (put it in chatbot/.env)")
    body = json.dumps(payload).encode()
    for attempt in range(retries):
        req = urllib.request.Request(API_URL, data=body, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            if e.code in (429, 502, 503) and attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
                continue
            raise RuntimeError(f"OpenRouter HTTP {e.code}: {detail}")


class Chat:
    def __init__(self, user_id, role):
        assert role in ("buyer", "seller")
        self.user_id, self.role = user_id, role
        self.messages = [{"role": "system", "content": BUYER_PROMPT if role == "buyer" else SELLER_PROMPT}]
        self.tool_log = []

    def send(self, text, max_steps=6):
        self.messages.append({"role": "user", "content": text})
        for _ in range(max_steps):
            data = _post({"model": MODEL, "messages": self.messages, "tools": TOOLS[self.role], "temperature": 0.2})
            if "choices" not in data:
                raise RuntimeError(f"Bad response: {str(data)[:300]}")
            msg = data["choices"][0]["message"]
            calls = msg.get("tool_calls") or []
            self.messages.append({k: v for k, v in msg.items() if k in ("role", "content", "tool_calls")})
            if not calls:
                return msg.get("content") or ""
            for c in calls:
                fn = c["function"]
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                    result = run_tool(self.user_id, fn["name"], args)
                except Exception as e:  # tool errors go back to the model, not the user
                    args, result = fn.get("arguments"), {"error": str(e)}
                self.tool_log.append((fn["name"], args))
                self.messages.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(result)})
        return "(stopped: too many tool steps)"
