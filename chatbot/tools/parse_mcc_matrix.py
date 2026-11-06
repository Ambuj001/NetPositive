"""Parse the MCC reward matrix PDF text (pdftotext -raw order) into structured JSON.

Usage: python tools/parse_mcc_matrix.py <raw.txt> <out.json>
Validates that every card has exactly one row for each of the 21 groups.
"""
import json
import re
import sys
from collections import Counter, defaultdict

GROUPS = {  # group: (category text as printed, canonical mccs)
    "GEN": ("other offline retail", "5310,5399,5699,5732 etc."),
    "ONLINE": ("general online retail", "5964,5999,5691 (online)"),
    "GROC": ("grocery", "5411"),
    "DEPT": ("department stores", "5311"),
    "DINE": ("dining & food delivery", "5812,5814"),
    "MOVIE": ("movies", "7832"),
    "FUEL": ("fuel", "5541,5542,5983,5172"),
    "UTIL": ("utilities", "4900"),
    "TEL": ("telecom/cable", "4814,4899"),
    "INS": ("insurance", "6300"),
    "RENT": ("rent", "6513"),
    "WALLET": ("wallet load", "6540,6541"),
    "EDU": ("education", "8211,8220,8241,8244,8249,8299"),
    "GOVT": ("government/tax", "9311,9399,9222"),
    "GAME": ("online gaming", "5816,7993,7994"),
    "JEWEL": ("jewellery/gold", "5944"),
    "RAIL": ("rail", "4112"),
    "AIR": ("airlines direct", "3000-3350,4511"),
    "HOTEL": ("hotels direct", "3501-3999,7011"),
    "GVP": ("gift voucher via bank portal", "portal merchant MCC"),
    "GVD": ("gift card bought from merchant/aggregator", "5947,5999,5311"),
}
BANKS = "HDFC|ICICI|SBI|Axis|Kotak|Amex"
GROUP_RE = re.compile(r"^(%s)\b" % "|".join(sorted(GROUPS, key=len, reverse=True)))
SOURCE_RE = re.compile(r"(HDFC MITC 31-Oct-2026.*|Millennia T&C 20-Jul-2026.*|MITC \+ cardadvisor|cardadvisor.*|SBI Aurum portal T&C|Axis MITC)\s*$")
TAIL_RE = re.compile(r"^(?:(?P<rate>\d+(?:\.\d+)?)\s*)?(?P<st>[AVSXU])\b\s*(?P<note>.*)$")


CARDS = {
    "HDFC": ["Infinia / Infinia Metal", "Diners Club Black Metal", "Regalia Gold", "Millennia", "Tata Neu Infinity"],
    "ICICI": ["Emeralde Private Metal", "Times Black", "Sapphiro", "Rubyx", "Amazon Pay ICICI"],
    "SBI": ["Cashback SBI", "SimplyCLICK", "ELITE", "PRIME", "AURUM"],
    "Axis": ["Magnus", "Atlas", "Select", "Flipkart Axis", "Airtel Axis"],
    "Kotak": ["White Reserve", "Solitaire", "Zen Signature", "Cashback+ Prime", "811 #DreamDifferent"],
    "Amex": ["Gold Charge", "Platinum Travel", "Membership Rewards (MRCC)", "SmartEarn", "Platinum Charge"],
}
_alt = "|".join("%s %s" % (re.escape(b), re.escape(c)) for b, cs in CARDS.items() for c in cs)
START_RE = re.compile(r"(?P<bc>%s)\s*(?P<grp>%s)(?=\s)" % (_alt, "|".join(sorted(GROUPS, key=len, reverse=True))))


def parse(lines):
    full = " ".join(lines)
    ms = list(START_RE.finditer(full))
    rows = []
    for k, m in enumerate(ms):
        end = ms[k + 1].start() if k + 1 < len(ms) else len(full)
        bank, card = m.group("bc").split(" ", 1)
        rows.append(_row(bank, card, m.group("grp") + " " + full[m.end():end].strip()))
    return rows


def _row(bank, card, text):
    group = GROUP_RE.match(text).group(1)
    rest = text[len(group):].strip()
    src = SOURCE_RE.search(rest)
    source = src.group(1).strip() if src else ""
    if src:
        rest = rest[:src.start()].strip()
    cat, mccs = GROUPS[group]
    rest = re.sub(r"^" + re.escape(cat), "", rest).strip()
    # mccs: printed form is mangled (comma-grouped numbers); strip the first token run
    if group == "EDU":
        rest = re.sub(r"^8211,8220,8241,8244,8249,8299", "", rest).strip()
    elif group == "GVP":
        rest = re.sub(r"^portal merchant MCC", "", rest).strip()
    elif group == "GEN":
        rest = re.sub(r"^5310,5399,5699,5732 etc\.", "", rest).strip()
    elif group == "ONLINE":
        rest = re.sub(r"^5964,5999,5691 \(online\)", "", rest).strip()
    else:
        rest = re.sub(r"^[\d,\-]+(?= |$)", "", rest).strip()
    t = TAIL_RE.match(rest)
    if not t:
        return {"bank": bank, "card": card, "group": group, "parse_error": rest, "source": source}
    return {"bank": bank, "card": card, "group": group, "category": cat, "mccs": mccs,
            "reward_pct": float(t["rate"]) if t["rate"] else None, "status": t["st"],
            "note": t["note"].strip(), "source": source}


if __name__ == "__main__":
    lines = [l.strip() for l in open(sys.argv[1], encoding="utf-8").read().splitlines() if l.strip()]
    lines = [l for l in lines if not l.startswith("bank card mcc_group")]
    rows = parse(lines)
    errs = [r for r in rows if "parse_error" in r]
    per_card = defaultdict(Counter)
    for r in rows:
        per_card[(r["bank"], r["card"])][r["group"]] += 1
    bad = {k: v for k, v in per_card.items() if len(v) != 21 or any(c != 1 for c in v.values())}
    print(f"rows={len(rows)} cards={len(per_card)} parse_errors={len(errs)} cards_not_21x1={len(bad)}")
    for e in errs[:10]:
        print("ERR", e)
    for k, v in bad.items():
        print("BAD", k, dict(v))
    missing_src = [r for r in rows if not r["source"]]
    print("rows without source:", len(missing_src))
    json.dump(rows, open(sys.argv[2], "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    for k in per_card:
        print(k)
