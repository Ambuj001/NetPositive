"""MCC reward matrix + merchant resolution (data access only; no user portfolios here)."""
import json
import re
from pathlib import Path
from urllib.parse import urlparse

DATA_DIR = Path(__file__).parent / "data"
_rows = json.loads((DATA_DIR / "mcc_matrix.json").read_text(encoding="utf-8"))
_m = json.loads((DATA_DIR / "merchants.json").read_text(encoding="utf-8"))

# (bank, matrix card name, group) -> row
INDEX = {(r["bank"], r["card"], r["group"]): r for r in _rows}
GROUPS = {}
for r in _rows:
    GROUPS.setdefault(r["group"], {"label": r["category"], "mccs": r["mccs"]})

MERCHANTS = {x["id"]: x for x in _m["merchants"]}
OFFERS = _m["offers"]
MCC_DISCLAIMER = _m["_meta"]["mcc_disclaimer"]
VOUCHER_DISCLAIMER = _m["_meta"]["voucher_disclaimer"]
CATEGORY_KEYWORDS = _m["category_keywords"]

STATUS_LABEL = {
    "V": "verified from issuer terms",
    "S": "secondary source - confirm on the issuer page",
    "A": "base rate assumed - not confirmed for this MCC",
    "X": "excluded - earns nothing",
    "U": "unknown - no confirmed data",
}
STATUS_CONFIDENCE = {"V": 3, "S": 2, "A": 1}


def row_for(matrix_key, group):
    if not matrix_key:
        return None
    return INDEX.get((matrix_key[0], matrix_key[1], group))


def _norm(text):
    return re.sub(r"[^a-z0-9. ]", " ", text.lower()).strip()


def host_of(text):
    """Return a lowercase hostname if text looks like a URL/domain, else None."""
    t = (text or "").strip().lower()
    if not t or " " in t:
        return None
    try:
        u = urlparse(t if "://" in t else "//" + t)
        host = (u.hostname or "").rstrip(".")
    except ValueError:
        return None
    if not host or "." not in host or re.fullmatch(r"[\d.]+", host):
        return None
    return host


def _by_domain(host):
    for m in MERCHANTS.values():
        for d in m["domains"]:
            if host == d or host.endswith("." + d):  # dot boundary: notamazon.in / amazon.in.evil.com don't match
                return m
    return None


def _word_find(alias, text):
    return re.search(r"(?<![a-z0-9])" + re.escape(alias) + r"(?![a-z0-9])", text)


def resolve(text):
    """Resolve a URL / domain / merchant name / category phrase.

    Returns {"kind": "merchant"|"category"|"unknown_domain"|None, "merchant": dict|None, "group": str|None, "matched": str}
    """
    host = host_of(text)
    if host:
        m = _by_domain(host)
        if m:
            return {"kind": "merchant", "merchant": m, "group": m["group"], "matched": host}
        return {"kind": "unknown_domain", "merchant": None, "group": None, "matched": host}
    t = _norm(text or "")
    if not t:
        return {"kind": None, "merchant": None, "group": None, "matched": ""}
    hits = []  # (position, alias_len, merchant)
    for m in MERCHANTS.values():
        for a in m["aliases"]:
            f = _word_find(_norm(a), t)
            if f:
                hits.append((f.start(), len(a), m))
    if hits:
        # "nike shoes from amazon" -> the store is the merchant after from/on/at/via
        cue = list(re.finditer(r"\b(from|on|at|via|through)\b", t))
        if len(hits) > 1 and cue:
            after = [h for h in hits if h[0] > cue[-1].start()]
            if after:
                hits = after
        hits.sort(key=lambda h: (-h[1], h[0]))
        m = hits[0][2]
        return {"kind": "merchant", "merchant": m, "group": m["group"], "matched": m["name"]}
    best = None
    for g, kws in CATEGORY_KEYWORDS.items():
        for kw in kws:
            if _word_find(_norm(kw), t) and (best is None or len(kw) > best[0]):
                best = (len(kw), g, kw)
    if best:
        return {"kind": "category", "merchant": None, "group": best[1], "matched": best[2]}
    return {"kind": None, "merchant": None, "group": None, "matched": t}
