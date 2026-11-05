"""Deterministic recommendation engine.

The LLM never does reward math and never sees cards outside the user's
portfolio: every public function takes a user_id and filters to that user's
cards BEFORE computing anything.
"""
import json
import math
import os
import re
import threading
from pathlib import Path
from urllib.parse import quote

import matrix

ROOT = Path(__file__).parent
DATA = json.loads((ROOT / "data" / "cards.json").read_text(encoding="utf-8"))
CARDS = {c["id"]: c for c in DATA["cards"]}
ROUTES = DATA["routes"]
MAX_DENOM = DATA["_meta"]["max_voucher_denomination"]
PORTALS_DATA = json.loads((ROOT / "data" / "portals.json").read_text(encoding="utf-8"))
PORTALS = PORTALS_DATA["portals"]
STATE_FILE = ROOT / "state" / "portfolios.json"
MATRIX_CHECKED_ON = "2026-11-05"
MAX_AMOUNT = 100_000_000  # Rs 10 crore sanity cap

_LOCK = threading.RLock()  # portfolio read-modify-write must not interleave across requests

POINT_VALUE = {"travel": 1.0, "statement": 0.30}  # Rs per point (Infinia)


# ---------- helpers ----------

def _clean_amount(amount, required=False):
    """Return (float|None, error|None)."""
    if amount is None or amount == "":
        return (None, "amount is required") if required else (None, None)
    try:
        a = float(amount)
    except (TypeError, ValueError):
        return None, f"amount '{amount}' is not a number"
    if not math.isfinite(a) or a <= 0:
        return None, "amount must be a positive number"
    if a > MAX_AMOUNT:
        return None, "amount is unrealistically large"
    return a, None


def _norm(text):
    return re.sub(r"[^a-z0-9. ]", " ", str(text).lower()).strip()


def _portal(card):
    """Bank voucher portal for this card's issuer, or None (e.g. SBI: no link on file)."""
    p = PORTALS.get(card.get("issuer"))
    return {"name": p["name"], "url": p["url"], "note": p["note"]} if p else None


def _cred():
    c = dict(PORTALS_DATA["cred"])
    c["url"] = os.environ.get("CRED_URL", c["url"])
    return c


# ---------- portfolio (per user) ----------

def _load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {}


def _save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    os.replace(tmp, STATE_FILE)  # atomic: a crash never leaves a half-written portfolio file


def get_portfolio(user_id):
    pf = _load_state().get(user_id, {})
    return {"cards": list(pf.get("cards", [])), "caps_used": dict(pf.get("caps_used", {})),
            "region": pf.get("region", "IN")}


def save_portfolio(user_id, pf):
    with _LOCK:
        state = _load_state()
        state[user_id] = pf
        _save_state(state)


def find_card(text):
    """Match free text to a catalogue card (whole-word, longest match wins)."""
    t = _norm(text)
    if not t:
        return None
    best = None
    for c in CARDS.values():
        for n in [c["name"]] + c["aliases"]:
            n = _norm(n)
            if re.search(r"(?<![a-z0-9])" + re.escape(n) + r"(?![a-z0-9])", t):
                if best is None or len(n) > best[0]:
                    best = (len(n), c)
    return best[1] if best else None


def add_card(user_id, text):
    card = find_card(text)
    if not card:
        return {"ok": False, "error": f"'{text}' is not in the card catalogue yet."}
    with _LOCK:
        pf = get_portfolio(user_id)
        if card["id"] not in pf["cards"]:
            pf["cards"].append(card["id"])
        save_portfolio(user_id, pf)
    return {"ok": True, "added": card["name"], "portfolio": [CARDS[i]["name"] for i in pf["cards"]]}


def remove_card(user_id, text):
    card = find_card(text)
    with _LOCK:
        pf = get_portfolio(user_id)
        if not card or card["id"] not in pf["cards"]:
            return {"ok": False, "error": "That card is not in the portfolio."}
        pf["cards"].remove(card["id"])
        save_portfolio(user_id, pf)
    return {"ok": True, "removed": card["name"], "portfolio": [CARDS[i]["name"] for i in pf["cards"]]}


def list_portfolio(user_id):
    pf = get_portfolio(user_id)
    return {"cards": [CARDS[i]["name"] for i in pf["cards"]], "region": pf.get("region", "IN")}


# ---------- category / merchant recommendation (browser extension + website) ----------

_WEEKEND = re.compile(r"(\d+)X weekends only", re.I)


def _offer_for(card_id, merchant, prime):
    """Merchant-specific offer for this card, if any. Returns (pct, status, note, source) or None."""
    if not merchant:
        return None
    for o in matrix.OFFERS:
        if o["card_id"] != card_id:
            continue
        if merchant["id"] in o.get("merchants", []) or set(o.get("tags", [])) & set(merchant.get("tags", [])):
            if "reward_pct" in o:
                return o["reward_pct"], o["status"], o["note"], o["source"]
            pct = o["reward_pct_prime"] if prime else o["reward_pct_nonprime"]
            note = o["note"] + ("" if prime is not None else " Showing the non-Prime rate; Prime members get more.")
            return pct, o["status"], note, o["source"]
    return None


def recommend_for_merchant(user_id, query=None, amount=None, prime=None, category=None):
    """Best cards in THIS user's portfolio for a purchase at a merchant/domain/category.

    query: URL, domain, merchant name or category phrase. category: optional matrix group code
    (e.g. 'ONLINE', 'DINE') used only when the query can't be resolved.
    """
    amt, err = _clean_amount(amount)
    if err:
        return {"error": err}
    pf = get_portfolio(user_id)
    held = pf["cards"]
    if not held:
        return {"error": "Portfolio is empty. Ask the user to add their cards first."}

    res = matrix.resolve(query or "")
    category_source = "merchant_map" if res["kind"] == "merchant" else "keyword" if res["kind"] == "category" else None
    group = res["group"]
    if group is None and res["kind"] != "merchant" and category:
        c = str(category).upper()
        if c not in matrix.GROUPS:
            return {"error": f"unknown category '{category}'", "valid_categories": sorted(matrix.GROUPS)}
        group, category_source = c, "caller_supplied"
    if res["kind"] == "merchant" and group is None:
        return {"error": "no_category_data", "merchant": res["merchant"]["name"],
                "message": res["merchant"].get("note", "No category data for this merchant.")}
    if group is None:
        return {"error": "unknown_merchant", "matched": res["matched"],
                "message": "Could not map this site/merchant to a spend category. Ask the user what kind of purchase it is, "
                           "then call again with a category.", "valid_categories": sorted(matrix.GROUPS)}

    merchant = res["merchant"]
    ginfo = matrix.GROUPS[group]
    ranked, not_rec, no_data = [], [], []
    for cid in held:
        card = CARDS[cid]
        row = matrix.row_for(card.get("matrix"), group)
        if row is None:
            no_data.append(card["name"])
            continue
        st = row["status"]
        base = {"card": card["name"], "status": st, "status_label": matrix.STATUS_LABEL[st],
                "note": row["note"], "source": row["source"]}
        if st == "X":
            not_rec.append({**base, "reason": row["note"] or "excluded"})
            continue
        if st == "U" or row["reward_pct"] is None:
            not_rec.append({**base, "reason": "No confirmed data. " + row["note"]})
            continue
        pct, flags, offer_used = row["reward_pct"], [], False
        offer = _offer_for(cid, merchant, prime)
        if offer:
            pct, st, onote, osrc = offer
            base.update(status=st, status_label=matrix.STATUS_LABEL[st], note=onote, source=osrc)
            flags.append("merchant_offer")
            offer_used = True
        wk = _WEEKEND.search(base["note"]) if not offer_used else None
        if wk:  # e.g. Diners Black dining: 2X only on weekends -> rank on the weekday base
            mult = int(wk.group(1))
            flags.append(f"weekend_only_boost:{round(pct, 2)}%_on_weekends")
            pct = round(pct / mult, 2)
        if re.search(r"\bcap\b", base["note"], re.I):
            flags.append("has_cap")
        if st == "A":
            flags.append("assumed_rate")
        entry = {**base, "reward_pct": pct, "flags": flags}
        if amt is not None:
            entry["est_value_rupees"] = round(amt * pct / 100, 2)
        ranked.append(entry)
    ranked.sort(key=lambda r: (-r["reward_pct"], -matrix.STATUS_CONFIDENCE[r["status"]], r["card"]))
    out = {
        "merchant": merchant["name"] if merchant else None,
        "category": ginfo["label"], "category_code": group, "mccs": ginfo["mccs"],
        "category_source": category_source, "amount": amt,
        "recommended": ranked, "not_recommended": not_rec, "no_data_for_cards": no_data,
        "disclaimers": [
            "reward_pct is the estimated value at each card's best official redemption rate, not a guaranteed cash amount.",
            matrix.MCC_DISCLAIMER,
            "Monthly/cycle caps already used are not tracked in this view: check has_cap notes.",
        ],
    }
    if category_source == "caller_supplied":
        out["disclaimers"].append("Category was supplied by the caller because the merchant is not in our map - confirm it.")
    return out


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


_GROUP_CHANNEL = {"GVP": "Bank voucher portal (merchant-portal MCC)", "GVD": "Direct from brand/aggregator"}


def _matrix_voucher_rows(card, amount):
    """Fallback for cards that have no hand-researched voucher route: use the MCC matrix GVP/GVD rows."""
    rows = []
    for g in ("GVP", "GVD"):
        r = matrix.row_for(card.get("matrix"), g)
        if r is None:
            continue
        base = {"card": card["name"], "channel": _GROUP_CHANNEL[g], "grade": matrix.STATUS_LABEL[r["status"]],
                "source": f"MCC matrix v2: {r['source']}", "checked_on": MATRIX_CHECKED_ON,
                "note": r["note"], "steps": [], "portal": _portal(card)}
        if r["status"] == "X":
            rows.append(("excluded", {**base, "reason": r["note"] or "excluded"}))
        elif r["status"] == "U" or r["reward_pct"] is None:
            rows.append(("excluded", {**base, "reason": "No confirmed number: " + r["note"]}))
        else:
            rows.append(("verified" if r["status"] == "V" else "unverified",
                         {**base, "value_pct": r["reward_pct"], "value_rupees": round(amount * r["reward_pct"] / 100, 2),
                          "points": None, "pay": amount, "bonus_points_used": 0}))
    return rows


def recommend_voucher_routes(user_id, brand, amount, value_mode="travel"):
    """Rank (card x channel) routes for ONLY the cards in this user's portfolio."""
    amount, err = _clean_amount(amount, required=True)
    if err:
        return {"error": err}
    if value_mode not in POINT_VALUE:
        value_mode = "travel"
    pf = get_portfolio(user_id)
    held = set(pf["cards"])
    if not held:
        return {"error": "Portfolio is empty. Ask the user to add their cards first."}
    ranked, unverified, excluded, uncovered = [], [], [], []
    caps_used = pf.get("caps_used", {})
    covered = set()
    for cid in pf["cards"]:  # keeps the user's own card order
        card = CARDS[cid]
        croutes = [r for r in ROUTES if r["card_id"] == cid]
        if any(r["kind"] in ("points", "flat_pct", "excluded") for r in croutes):
            use = [r for r in croutes if r["kind"] != "unknown"]
        else:
            use = []  # nothing computable by hand: fall back to the MCC matrix below
        for r in use:
            covered.add(cid)
            base = {"card": card["name"], "channel": r["channel"], "grade": r["status"],
                    "source": r["source"], "checked_on": r["checked"], "note": r.get("note", ""),
                    "steps": r.get("steps", []), "portal": _portal(card)}
            if r["kind"] == "excluded":
                excluded.append({**base, "reason": r["note"]})
                continue
            calc = _compute(r, amount, value_mode, caps_used.get(r.get("cap_group", r["id"]), 0))
            row = {**base, **calc, "value_mode": value_mode}
            (ranked if r["verified"] else unverified).append(row)
        if not use:
            for bucket, row in _matrix_voucher_rows(card, amount):
                covered.add(cid)
                if bucket == "excluded":
                    excluded.append(row)
                elif bucket == "verified":
                    ranked.append(row)
                else:
                    unverified.append(row)
    for cid in pf["cards"]:
        if cid not in covered:
            uncovered.append(CARDS[cid]["name"])
    ranked.sort(key=lambda x: -x["value_rupees"])
    unverified.sort(key=lambda x: -x["value_rupees"])
    return {"brand": brand, "amount": amount, "value_mode": value_mode,
            "recommended": ranked, "needs_reverification": unverified,
            "not_recommended": excluded, "no_data_for_cards": uncovered,
            "split_into_vouchers": _split(amount), "second_option": _cred(),
            "split_note": f"Assumes a maximum voucher size of Rs {MAX_DENOM} (taken from the Lifestyle example). "
                          "Real denominations differ by brand and portal, and this split only affects per-voucher point rounding."}


def plan_voucher_purchase(user_id, store, amount, item=None, value_mode="travel", prime=None):
    """Website flow: 'Nike shoes from Amazon' -> which voucher to buy, where, and with which of THEIR cards."""
    amt, err = _clean_amount(amount, required=True)
    if err:
        return {"error": err}
    res = matrix.resolve(store or "")
    if res["kind"] != "merchant":
        return {"error": "unknown_store", "message": "I don't know this store yet. Ask the user which store they want to shop at.",
                "valid_stores": sorted(m["name"] for m in matrix.MERCHANTS.values())}
    m = res["merchant"]
    out = {"store": m["name"], "item": item, "amount": amt, "category": matrix.GROUPS[m["group"]]["label"] if m["group"] else None}
    if not m["voucher_brand"]:
        out.update(voucher_available=False,
                   message=f"No voucher brand mapped for {m['name']}. Showing the best direct-card option instead.",
                   direct_option=recommend_for_merchant(user_id, m["name"], amt, prime))
        return out
    routes = recommend_voucher_routes(user_id, m["voucher_brand"], amt, value_mode)
    if "error" in routes:
        return {**out, **routes}
    best = (routes["recommended"] or routes["needs_reverification"] or [None])[0]
    template = os.environ.get("VOUCHER_RAIL_URL", "/voucher-rail?brand={brand}&amount={amount}")
    redirect = {"voucher_brand": m["voucher_brand"], "second_option": routes["second_option"]}
    if best:
        portal = best.get("portal")
        redirect.update(via_card=best["card"], channel=best["channel"], portal=portal["name"] if portal else None,
                        url=portal["url"] if portal else None,
                        note=(f"Opens the {portal['name']} landing page: pick the {m['voucher_brand']} voucher there. {portal['note']}".strip()
                              if portal else f"No portal link on file for {best['card']}'s bank: follow the steps, or try the second option."))
    else:
        redirect.update(via_card=None, url=None, note="None of the user's cards has a usable voucher route: send them to the second option.")
    out.update(voucher_available=True, voucher_brand=m["voucher_brand"], redirect=redirect,
               voucher_rail_url=template.format(brand=quote(m["voucher_brand"]), amount=int(amt)),
               routes=routes, disclaimers=[matrix.VOUCHER_DISCLAIMER, matrix.MCC_DISCLAIMER])
    return out


# ---------- seller side ----------

def recommend_seller_options(user_id, amount_inr):
    amount_inr, err = _clean_amount(amount_inr, required=True)
    if err:
        return {"error": err}
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
