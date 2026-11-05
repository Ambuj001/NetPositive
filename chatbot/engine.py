"""Deterministic recommendation engine.

The LLM never does reward math and never sees cards outside the user's
portfolio: every function here takes a user's portfolio and filters first.
"""
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).parent
DATA = json.loads((ROOT / "data" / "cards.json").read_text(encoding="utf-8"))
CARDS = {c["id"]: c for c in DATA["cards"]}
ROUTES = DATA["routes"]
MAX_DENOM = DATA["_meta"]["max_voucher_denomination"]
STATE_FILE = ROOT / "state" / "portfolios.json"

POINT_VALUE = {"travel": 1.0, "statement": 0.30}  # Rs per point (Infinia)


# ---------- portfolio (per user) ----------

def _load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {}


def _save_state(state):
    STATE_FILE.parent.mkdir(exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def get_portfolio(user_id):
    return _load_state().get(user_id, {"cards": [], "caps_used": {}, "region": "IN"})


def save_portfolio(user_id, pf):
    state = _load_state()
    state[user_id] = pf
    _save_state(state)


def find_card(text):
    """Match free text to a catalogue card. Returns card dict or None."""
    t = re.sub(r"[^a-z0-9. ]", " ", text.lower()).strip()
    best = None
    for c in CARDS.values():
        names = [c["name"].lower()] + c["aliases"]
        for n in names:
            if n == t:
                return c
            if n in t and (best is None or len(n) > best[0]):
                best = (len(n), c)
    return best[1] if best else None


def add_card(user_id, text):
    card = find_card(text)
    if not card:
        return {"ok": False, "error": f"'{text}' is not in the card catalogue yet."}
    pf = get_portfolio(user_id)
    if card["id"] not in pf["cards"]:
        pf["cards"].append(card["id"])
    save_portfolio(user_id, pf)
    return {"ok": True, "added": card["name"], "portfolio": [CARDS[i]["name"] for i in pf["cards"]]}


def remove_card(user_id, text):
    card = find_card(text)
    pf = get_portfolio(user_id)
    if not card or card["id"] not in pf["cards"]:
        return {"ok": False, "error": "That card is not in the portfolio."}
    pf["cards"].remove(card["id"])
    save_portfolio(user_id, pf)
    return {"ok": True, "removed": card["name"], "portfolio": [CARDS[i]["name"] for i in pf["cards"]]}


def list_portfolio(user_id):
    pf = get_portfolio(user_id)
    return {"cards": [CARDS[i]["name"] for i in pf["cards"]], "region": pf.get("region", "IN")}


# ---------- buyer side: best way to buy a voucher ----------

def _split(amount):
    n, rem = divmod(int(amount), MAX_DENOM)
    return [MAX_DENOM] * n + ([rem] if rem else [])


def _compute(route, amount, value_mode, cap_used):
    kind = route["kind"]
    out = {"value_rupees": None, "value_pct": None, "points": None, "pay": amount, "bonus_points_used": 0}
    if kind == "flat_pct":
        out["value_pct"] = route["reward_pct"]
        out["value_rupees"] = round(amount * route["reward_pct"] / 100, 2)
        return out
    if kind != "points":
        return out
    disc = route.get("discount_pct", 0)
    pay = 0
    base_total = 0
    for v in _split(amount):
        paid = v * (1 - disc / 100)
        pay += paid
        base_total += math.floor(paid / route["unit"]) * route["base_pts"]  # per-transaction rounding
    mult = route.get("mult", 1)
    total_pts = base_total * mult
    bonus = total_pts - base_total
    cap = route.get("bonus_cap_pts")
    if cap is not None:
        allowed = max(0, min(bonus, cap - cap_used))
        out["bonus_points_used"] = allowed
        total_pts = base_total + allowed
    else:
        out["bonus_points_used"] = bonus
    pv = POINT_VALUE[value_mode]
    value = total_pts * pv + (amount - pay)
    out.update(points=total_pts, pay=round(pay, 2), value_rupees=round(value, 2),
               value_pct=round(value / amount * 100, 2))
    return out


def recommend_voucher_routes(user_id, brand, amount, value_mode="travel"):
    """Rank (card x channel) routes for ONLY the cards in this user's portfolio."""
    pf = get_portfolio(user_id)
    held = set(pf["cards"])
    if not held:
        return {"error": "Portfolio is empty. Ask the user to add their cards first."}
    ranked, unverified, excluded, uncovered = [], [], [], []
    caps_used = pf.get("caps_used", {})
    covered = set()
    for r in ROUTES:
        if r["card_id"] not in held:
            continue  # <- the portfolio filter: nothing outside the portfolio gets past here
        covered.add(r["card_id"])
        base = {"card": CARDS[r["card_id"]]["name"], "channel": r["channel"], "grade": r["status"],
                "source": r["source"], "checked_on": r["checked"], "note": r.get("note", ""),
                "steps": r.get("steps", [])}
        if r["kind"] == "excluded":
            excluded.append({**base, "reason": r["note"]})
            continue
        if r["kind"] == "unknown":
            excluded.append({**base, "reason": "No confirmed number: " + r["note"]})
            continue
        calc = _compute(r, amount, value_mode, caps_used.get(r.get("cap_group", r["id"]), 0))
        row = {**base, **calc, "value_mode": value_mode}
        (ranked if r["verified"] else unverified).append(row)
    for cid in held - covered:
        uncovered.append(CARDS[cid]["name"])
    ranked.sort(key=lambda x: -x["value_rupees"])
    unverified.sort(key=lambda x: -x["value_rupees"])
    return {"brand": brand, "amount": amount, "value_mode": value_mode,
            "recommended": ranked, "needs_reverification": unverified,
            "not_recommended": excluded, "no_data_for_cards": uncovered,
            "split_into_vouchers": _split(amount)}


# ---------- seller side ----------

def recommend_seller_options(user_id, amount_inr):
    pf = get_portfolio(user_id)
    held = set(pf["cards"])
    region = pf.get("region", "IN")
    opts = []
    for o in DATA["seller_options"]:
        if o["id"] == "voucher_rail":
            opts.append({"option": o["name"], "cost_pct": o["fee_pct"], "note": o["note"]})
            continue
        if o["id"] not in held:
            continue  # not in portfolio
        if "regions" in o and region not in o["regions"]:
            opts.append({"option": o["name"], "available": False,
                         "reason": f"Not available in region {region}: {o['note']}"})
            continue
        opts.append({"option": o["name"], "reward_pct": o["reward_pct"], "note": o["note"]})
    return {"amount_inr": amount_inr, "region": region, "options": opts}
