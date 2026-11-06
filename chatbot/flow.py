"""Request lifecycle helpers (no state kept here; the backend owns requests/escrow).

Seller of crypto : suggest_merchants -> (pick one) -> draft_request
Buyer of crypto  : fulfil_request (ranked options, best first, each with its own link)
"""
import json
import re
from pathlib import Path

import engine
import matrix

_P = json.loads((Path(__file__).parent / "data" / "products.json").read_text(encoding="utf-8"))
PRODUCTS, BRANDS = _P["products"], _P["brands"]
MAX_TILES = _P["_meta"]["max_tiles"]
FALLBACK = _P["_meta"]["fallback"]
MAX_QUERY = 200
_CUE = re.compile(r"\b(from|on|at|via|through)\b")
_STRONG_CUES = {"from", "via", "through"}
# Brands the escrow backend accepts. A seller must never be offered anything else (it would fail at POST /requests).
BACKEND_BRANDS = frozenset(json.loads((Path(__file__).parent / "data" / "backend_brands.json").read_text(encoding="utf-8"))["brands"])


def _requestable(m):
    """Can a seller actually post a request for this merchant? Needs a voucher AND backend support."""
    return bool(m["voucher_brand"]) and m["id"] in BACKEND_BRANDS


def _tile(m):
    g = matrix.GROUPS.get(m["group"]) if m["group"] else None
    return {"merchant_id": m["id"], "name": m["name"], "voucher_brand": m["voucher_brand"],
            "category": g["label"] if g else None, "site": m["domains"][0], "requestable": _requestable(m)}


def _norm_query(q):
    t = engine._norm(q)
    return re.sub(r"\bt shirts?\b", "tshirt", t)


def _word(kw, text):
    kw = engine._norm(kw)
    return re.search(r"(?<![a-z0-9])" + re.escape(kw) + r"s?(?![a-z0-9])", text)  # tolerate simple plurals


def _product_tiles(text, exclude=()):
    scores, order = {}, {}
    for table in (BRANDS, PRODUCTS):
        for kw, mids in table.items():
            if _word(kw, text):
                for i, mid in enumerate(mids):
                    scores[mid] = scores.get(mid, 0) + (len(mids) - i)
                    order.setdefault(mid, len(order))
    ranked = sorted(scores, key=lambda mid: (-scores[mid], order[mid]))
    tiles = [_tile(matrix.MERCHANTS[mid]) for mid in ranked
             if mid in matrix.MERCHANTS and mid not in exclude and _requestable(matrix.MERCHANTS[mid])]
    return tiles[:MAX_TILES], bool(scores)


def suggest_merchants(query):
    """Seller side. 'shoes' -> tiles; 'nike shoes from amazon' -> Amazon locked, others as alternatives."""
    if not isinstance(query, str) or not query.strip():
        return {"error": "query is required"}
    if len(query) > MAX_QUERY:
        return {"error": f"query is too long (max {MAX_QUERY} characters)"}
    text = _norm_query(query)
    notes = [_P["_meta"]["warning"]]

    store, item = None, None
    cues = list(_CUE.finditer(text))
    if cues:
        tail = text[cues[-1].end():].strip()
        r = matrix.resolve(tail)
        if r["kind"] == "merchant":
            store, item = r["merchant"], text[:cues[-1].start()].strip() or None
        elif tail and cues[-1].group(1) in _STRONG_CUES:  # "from X" names a store; "on sale"/"at a discount" does not
            notes.append(f"I don't know the store '{tail}', so I'm showing stores that sell the item instead.")
            text = text[:cues[-1].start()].strip() or text
    if store is None and not cues:
        r = matrix.resolve(query)
        is_site = bool(matrix.host_of(query))
        is_brand = any(_word(b, text) for b in BRANDS)  # "nike" is a brand: show who sells it, don't lock onto nike.com
        if r["kind"] == "merchant" and (is_site or (not is_brand and text in {engine._norm(a) for a in r["merchant"]["aliases"]})):
            store = r["merchant"]  # the whole query is just a store name / site

    if store:
        tiles, _ = _product_tiles(_norm_query(item or ""), exclude={store["id"]})
        sel = _tile(store)
        out = {"query": query, "item": item, "mode": "store_locked", "selected": sel,
               "voucher_available": bool(store["voucher_brand"]), "requestable": _requestable(store),
               "alternatives": tiles, "notes": notes}
        if not store["voucher_brand"]:
            out["notes"].append(f"No voucher is mapped for {store['name']}, so it can't be requested yet. Pick another store.")
        elif not _requestable(store):
            out["notes"].append(f"{store['name']} can't be requested yet: the escrow doesn't support it. Pick another store.")
        return out

    tiles, matched = _product_tiles(text)
    if tiles:
        return {"query": query, "item": text or None, "mode": "tiles", "selected": None, "tiles": tiles, "notes": notes}
    if matched:  # we know the product, but none of the stores that sell it can be requested yet
        notes.append("None of the stores that sell this can be requested yet (not supported by the escrow). Ask the seller for another item.")
        return {"query": query, "item": text or None, "mode": "no_requestable_store", "selected": None, "tiles": [], "notes": notes}
    tiles = [_tile(matrix.MERCHANTS[m]) for m in FALLBACK if _requestable(matrix.MERCHANTS[m])]
    notes.append("I couldn't tell what product this is, so these are the biggest general stores. Ask the user what they want to buy.")
    return {"query": query, "item": text or None, "mode": "fallback", "selected": None, "tiles": tiles, "notes": notes}


def draft_request(merchant, amount, item=None):
    """Seller side: turn the chosen tile into the request payload the backend will escrow against."""
    amt, err = engine._clean_amount(amount, required=True)
    if err:
        return {"error": err}
    m = matrix.MERCHANTS.get(str(merchant).lower()) if merchant else None
    if m is None:
        r = matrix.resolve(str(merchant or ""))
        m = r["merchant"] if r["kind"] == "merchant" else None
    if m is None:
        return {"error": "unknown_merchant", "message": "Pick one of the suggested merchants."}
    if not m["voucher_brand"]:
        return {"error": "no_voucher", "message": f"No voucher is mapped for {m['name']}."}
    if not _requestable(m):
        return {"error": "not_requestable", "message": f"{m['name']} can't be requested yet: the escrow doesn't support it. Pick another store."}
    return {"ok": True,
            "request": {"voucher_brand": m["voucher_brand"], "merchant": m["name"], "merchant_id": m["id"],
                        "item": item if isinstance(item, str) and item.strip() else None, "amount_inr": amt,
                        "suggested_split": engine._split(amt)},
            "next": "Show this summary and ask the seller to confirm. The backend then posts the request and locks the crypto in escrow.",
            "disclaimers": [matrix.VOUCHER_DISCLAIMER,
                            f"suggested_split assumes a max voucher size of Rs {engine.MAX_DENOM}; real denominations vary by brand."]}


def fulfil_request(buyer_id, brand, amount, value_mode="travel"):
    """Buyer side, after accepting a request: brand and amount are fixed; rank THIS buyer's options, best first."""
    amt, err = engine._clean_amount(amount, required=True)
    if err:
        return {"error": err}
    if not isinstance(brand, str) or not brand.strip():
        return {"error": "brand is required"}
    brand = brand.strip()
    routes = engine.recommend_voucher_routes(buyer_id, brand, amt, value_mode)
    cred = engine._cred()
    if "error" in routes:
        return {**routes, "second_option": cred}
    options = []
    for verified, bucket in ((True, routes["recommended"]), (False, routes["needs_reverification"])):
        for r in bucket:
            portal = r.get("portal")
            options.append({"rank": len(options) + 1, "card": r["card"], "channel": r["channel"],
                            "expected_value_rupees": r["value_rupees"], "expected_value_pct": r["value_pct"],
                            "points": r.get("points"), "verified": verified, "grade": r["grade"],
                            "link": portal["url"] if portal else None, "portal": portal["name"] if portal else None,
                            "portal_note": portal["note"] if portal else "", "steps": r["steps"], "note": r["note"],
                            "source": r["source"], "checked_on": r["checked_on"]})
    notes = []
    if options:
        options[0]["best"] = True
        if not options[0]["verified"]:
            notes.append("None of your options is fully verified: the top one is the best estimate. Check the bank page before paying.")
    else:
        notes.append("None of your cards has a usable route for this voucher. Try the second option.")
    return {"voucher_brand": brand, "amount_inr": amt, "value_mode": routes["value_mode"], "options": options,
            "not_recommended": routes["not_recommended"], "no_data_for_cards": routes["no_data_for_cards"],
            "second_option": cred, "notes": notes,
            "must_match": {"voucher_brand": brand, "total_amount_inr": amt, "suggested_split": routes["split_into_vouchers"],
                           "tip": "Buy exactly this brand and total value. The verification step checks brand, balance and expiry before the crypto is released.",
                           "split_note": routes["split_note"]},
            "next_steps": ["Choose an option (best is on top) and open its link.", "Pick the voucher brand shown in must_match and buy it.",
                           "Submit the voucher code(s) for verification; do not share them anywhere else."]}
