import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import engine  # noqa: E402
import flow  # noqa: E402
import matrix  # noqa: E402


def names(tiles):
    return [t["name"] for t in tiles]


class Suggest(unittest.TestCase):
    def test_generic_product_gives_ranked_tiles(self):
        r = flow.suggest_merchants("shoes")
        self.assertEqual((r["mode"], names(r["tiles"])), ("tiles", ["Amazon", "Flipkart", "Myntra"]))  # AJIO is not supported by the escrow
        self.assertIsNone(r["selected"])
        self.assertTrue(all(t["requestable"] for t in r["tiles"]))

    def test_brand_query_only_offers_supported_stores(self):
        r = flow.suggest_merchants("nike shoes")
        self.assertEqual(r["mode"], "tiles")
        self.assertEqual(set(names(r["tiles"])), {"Amazon", "Myntra", "Flipkart"})
        self.assertNotIn("Nike", names(r["tiles"]))  # Nike's own store is not supported by the escrow backend
        self.assertLessEqual(len(r["tiles"]), flow.MAX_TILES)

    def test_unsupported_named_store_is_not_requestable(self):
        for q, store in [("shoes from ajio", "AJIO"), ("croma", "Croma"), ("jewellery from tanishq", "Tanishq")]:
            r = flow.suggest_merchants(q)
            self.assertEqual((r["mode"], r["selected"]["name"], r["requestable"]), ("store_locked", store, False), q)
            self.assertTrue(any("can't be requested yet" in n for n in r["notes"]), q)
            self.assertTrue(all(t["requestable"] for t in r["alternatives"]), q)

    def test_known_product_with_no_supported_store(self):
        for q in ["movies", "jewellery", "hotel"]:
            r = flow.suggest_merchants(q)
            self.assertEqual((r["mode"], r["tiles"]), ("no_requestable_store", []), q)
            self.assertTrue(any("None of the stores that sell this can be requested yet" in n for n in r["notes"]), q)

    def test_named_store_is_locked_with_alternatives(self):
        r = flow.suggest_merchants("Nike shoes from Amazon")
        self.assertEqual((r["mode"], r["selected"]["name"], r["item"], r["voucher_available"]), ("store_locked", "Amazon", "nike shoes", True))
        self.assertNotIn("Amazon", names(r["alternatives"]))
        self.assertIn("Myntra", names(r["alternatives"]))
        self.assertEqual(flow.suggest_merchants("order on swiggy")["selected"]["name"], "Swiggy")
        self.assertEqual(flow.suggest_merchants("iphone from croma")["selected"]["name"], "Croma")

    def test_store_only_queries(self):
        self.assertEqual(flow.suggest_merchants("amazon")["selected"]["name"], "Amazon")
        self.assertEqual(flow.suggest_merchants("https://www.myntra.com/x")["selected"]["name"], "Myntra")

    def test_brand_alone_is_not_treated_as_store(self):
        r = flow.suggest_merchants("nike")
        self.assertEqual(r["mode"], "tiles")  # Nike the brand -> stores that sell it (Nike's own store is one tile)
        self.assertIn("Myntra", names(r["tiles"]))

    def test_plurals_and_variants(self):
        for q in ["t-shirts", "sneakers", "SHOES", "I want some shoes please"]:
            self.assertEqual(flow.suggest_merchants(q)["mode"], "tiles", q)

    def test_store_without_voucher_cannot_be_requested(self):
        r = flow.suggest_merchants("shoes from blinkit")
        self.assertEqual((r["mode"], r["voucher_available"]), ("store_locked", False))
        self.assertTrue(any("No voucher" in n for n in r["notes"]))
        self.assertIn("Amazon", names(r["alternatives"]))

    def test_unknown_store_and_weak_cues(self):
        r = flow.suggest_merchants("shoes from zzzstore")
        self.assertEqual(r["mode"], "tiles")
        self.assertTrue(any("zzzstore" in n for n in r["notes"]))
        r2 = flow.suggest_merchants("shoes on sale")  # 'on' is a weak cue: no bogus unknown-store note
        self.assertEqual(r2["mode"], "tiles")
        self.assertFalse(any("sale" in n for n in r2["notes"][1:]))

    def test_unknown_product_falls_back_to_big_stores(self):
        r = flow.suggest_merchants("quantum flux capacitor")
        self.assertEqual((r["mode"], names(r["tiles"])), ("fallback", ["Amazon", "Flipkart"]))

    def test_validation(self):
        for bad in [None, "", "   ", 123, "x" * 201]:
            self.assertIn("error", flow.suggest_merchants(bad), bad)

    def test_every_tile_is_redeemable_and_lists_are_valid(self):
        for table in (flow.PRODUCTS, flow.BRANDS):
            for kw, mids in table.items():
                for mid in mids:
                    self.assertIn(mid, matrix.MERCHANTS, (kw, mid))
        for q in list(flow.PRODUCTS) + list(flow.BRANDS):
            r = flow.suggest_merchants(q)
            for t in r.get("tiles", []) + r.get("alternatives", []):
                self.assertTrue(t["voucher_brand"], (q, t))
                self.assertIn(t["merchant_id"], flow.BACKEND_BRANDS, (q, t))  # never offer what the backend would reject
                self.assertTrue(t["requestable"], (q, t))
            self.assertTrue(r.get("tiles") or r.get("selected") or r["mode"] == "no_requestable_store", q)

    def test_backend_brand_copy_is_valid(self):
        for b in flow.BACKEND_BRANDS:
            self.assertIn(b, matrix.MERCHANTS, b)  # every backend brand maps to a chatbot merchant


class Draft(unittest.TestCase):
    def test_by_id_and_by_name(self):
        for m in ["amazon", "Amazon", "Myntra"]:
            self.assertTrue(flow.draft_request(m, 10000, "Nike shoes")["ok"], m)
        d = flow.draft_request("amazon", 10000, "Nike shoes")
        self.assertEqual(d["request"], {"voucher_brand": "Amazon", "merchant": "Amazon", "merchant_id": "amazon",
                                        "item": "Nike shoes", "amount_inr": 10000.0, "suggested_split": [5000, 5000]})
        self.assertIsNone(flow.draft_request("amazon", 100, "  ")["request"]["item"])

    def test_errors(self):
        self.assertEqual(flow.draft_request("nope store", 1000)["error"], "unknown_merchant")
        self.assertEqual(flow.draft_request("blinkit", 1000)["error"], "no_voucher")
        for unsupported in ["ajio", "nike", "Tata CLiQ", "croma", "tanishq"]:  # have vouchers, but the escrow backend rejects them
            self.assertEqual(flow.draft_request(unsupported, 1000)["error"], "not_requestable", unsupported)
        self.assertEqual(flow.draft_request(None, 1000)["error"], "unknown_merchant")
        for bad in [None, 0, -5, "abc", float("inf")]:
            self.assertIn("error", flow.draft_request("amazon", bad), bad)


class SellerVerify(unittest.TestCase):
    def test_guide_amounts_and_limits(self):
        g = flow.verify_received_voucher("Amazon", 10000, [5000, 5000])
        self.assertEqual([x["expected_paise"] for x in g["check_each_voucher"]], [500000, 500000])
        self.assertEqual([x["expected_paise"] for x in flow.verify_received_voucher("Amazon", 999)["check_each_voucher"]], [99900])
        self.assertTrue(any("woohoo" in l.lower() for l in g["limits"]) and any("brand" in l for l in g["limits"]))
        self.assertTrue(any("dispute" in s for s in g["steps"]))

    def test_never_asks_for_the_code(self):
        self.assertNotIn("paste", json.dumps(flow.verify_received_voucher("Amazon", 500)).lower())

    def test_bad_input(self):
        for b, a in [(None, 100), ("", 100), ("Amazon", 0), ("Amazon", "x"), ("Amazon", None)]:
            self.assertIn("error", flow.verify_received_voucher(b, a), (b, a))
        self.assertEqual(len(flow.verify_received_voucher("Amazon", 100, [-1, "x", True])["check_each_voucher"]), 1)


class Fulfil(unittest.TestCase):
    def setUp(self):
        engine.STATE_FILE = Path(tempfile.mkdtemp()) / "pf.json"

    def cards(self, u, *c):
        for x in c:
            engine.add_card(u, x)

    def test_ranked_best_first_each_with_link(self):
        self.cards("b", "Emeralde", "Infinia")
        r = flow.fulfil_request("b", "Lifestyle", 10000)
        o = r["options"]
        self.assertEqual([x["rank"] for x in o], list(range(1, len(o) + 1)))
        self.assertTrue(o[0]["best"])
        self.assertTrue(all("best" not in x for x in o[1:]))
        self.assertEqual((o[0]["card"], o[0]["channel"], o[0]["expected_value_pct"]), ("HDFC Infinia", "HDFC SmartBuy (accelerated 5X)", 16.5))
        self.assertEqual(o[0]["link"], "https://www.gyftr.com/instantvouchers")
        verified = [x["verified"] for x in o]
        self.assertEqual(verified, sorted(verified, reverse=True))  # verified before unverified
        em = [x for x in o if x["card"] == "ICICI Emeralde Private Metal"][0]
        self.assertFalse(em["verified"])
        self.assertIn("ishoprewards", em["link"])
        self.assertGreater(em["rank"], o[0]["rank"])
        self.assertEqual(r["second_option"]["name"], "CRED")
        self.assertEqual(r["must_match"]["voucher_brand"], "Lifestyle")
        self.assertEqual(r["must_match"]["total_amount_inr"], 10000.0)

    def test_buyer_output_has_no_verify_step(self):
        self.cards("b", "Infinia")
        self.assertNotIn("verify_before_submit", flow.fulfil_request("b", "Lifestyle", 10000))

    def test_values_within_verified_group_are_descending(self):
        self.cards("b", "Infinia")
        o = flow.fulfil_request("b", "Lifestyle", 10000)["options"]
        vals = [x["expected_value_rupees"] for x in o]
        self.assertEqual(vals, sorted(vals, reverse=True))

    def test_unverified_top_is_warned(self):
        self.cards("b", "Emeralde")
        r = flow.fulfil_request("b", "Amazon", 10000)
        self.assertTrue(r["options"][0]["best"])
        self.assertTrue(any("fully verified" in n for n in r["notes"]))

    def test_no_usable_route(self):
        self.cards("b", "Magnus")
        r = flow.fulfil_request("b", "Amazon", 10000)
        self.assertEqual(r["options"], [])
        self.assertTrue(any("second option" in n for n in r["notes"]))
        self.assertEqual(r["not_recommended"][0]["card"], "Axis Magnus")

    def test_missing_link_is_none_not_invented(self):
        self.cards("b", "SBI Aurum")
        o = flow.fulfil_request("b", "Amazon", 10000)["options"][0]
        self.assertIsNone(o["link"])
        self.assertIsNone(o["portal"])

    def test_buyers_are_isolated(self):
        self.cards("saad", "Infinia")
        self.cards("shivam", "Emeralde")
        a = json.dumps(flow.fulfil_request("saad", "Amazon", 5000))
        self.assertNotIn("Emeralde", a)
        self.assertNotIn("ICICI", a)
        b = json.dumps(flow.fulfil_request("shivam", "Amazon", 5000))
        self.assertNotIn("Infinia", b)

    def test_errors(self):
        self.assertIn("error", flow.fulfil_request("nobody", "Amazon", 1000))
        self.assertEqual(flow.fulfil_request("nobody", "Amazon", 1000)["second_option"]["name"], "CRED")
        self.cards("b", "Infinia")
        for brand in [None, "", "  ", 5]:
            self.assertIn("error", flow.fulfil_request("b", brand, 1000), brand)
        for amt in [None, 0, -1, "x", float("nan")]:
            self.assertIn("error", flow.fulfil_request("b", "Amazon", amt), amt)

    def test_whole_seller_to_buyer_flow(self):
        self.cards("buyer", "Infinia")
        tiles = flow.suggest_merchants("shoes")["tiles"]
        req = flow.draft_request(tiles[0]["merchant_id"], 10000, "shoes")["request"]
        out = flow.fulfil_request("buyer", req["voucher_brand"], req["amount_inr"])
        self.assertEqual(out["must_match"]["voucher_brand"], "Amazon")
        self.assertEqual(out["options"][0]["card"], "HDFC Infinia")


if __name__ == "__main__":
    unittest.main()
