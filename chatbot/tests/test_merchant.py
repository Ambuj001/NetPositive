import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import engine  # noqa: E402
import matrix  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        engine.STATE_FILE = Path(tempfile.mkdtemp()) / "pf.json"

    def cards(self, user, *names):
        for n in names:
            self.assertTrue(engine.add_card(user, n)["ok"], n)

    def top(self, res):
        return res["recommended"][0]


class DataIntegrity(unittest.TestCase):
    def test_every_catalogue_matrix_key_has_all_21_groups(self):
        for c in engine.CARDS.values():
            if c.get("matrix"):
                for g in matrix.GROUPS:
                    self.assertIsNotNone(matrix.row_for(c["matrix"], g), (c["id"], g))
        self.assertEqual(len(matrix.GROUPS), 21)
        self.assertEqual(len(matrix.INDEX), 630)

    def test_mcc_codes_were_unmangled(self):
        self.assertEqual(matrix.GROUPS["DINE"]["mccs"], "5812,5814")
        self.assertEqual(matrix.GROUPS["GAME"]["mccs"], "5816,7993,7994")
        self.assertEqual(matrix.GROUPS["WALLET"]["mccs"], "6540,6541")

    def test_merchants_reference_valid_groups_and_unique_domains(self):
        seen = set()
        for m in matrix.MERCHANTS.values():
            self.assertTrue(m["group"] is None or m["group"] in matrix.GROUPS, m["id"])
            for d in m["domains"]:
                self.assertNotIn(d, seen)
                seen.add(d)
        for o in matrix.OFFERS:
            self.assertIn(o["card_id"], engine.CARDS)
            for mid in o.get("merchants", []):
                self.assertIn(mid, matrix.MERCHANTS)


class Resolve(unittest.TestCase):
    def test_domains(self):
        for t in ["https://www.amazon.in/dp/B0123?x=1", "amazon.in", "smile.amazon.in", "AMAZON.IN:443/x"]:
            self.assertEqual(matrix.resolve(t)["merchant"]["id"], "amazon", t)

    def test_lookalike_domains_do_not_match(self):
        for t in ["notamazon.in", "amazon.in.evil.com", "amazon-in.com", "evilamazon.in"]:
            self.assertEqual(matrix.resolve(t)["kind"], "unknown_domain", t)

    def test_names_and_store_after_from(self):
        self.assertEqual(matrix.resolve("Nike shoes from Amazon")["merchant"]["id"], "amazon")
        self.assertEqual(matrix.resolve("order on swiggy")["merchant"]["id"], "swiggy")
        self.assertEqual(matrix.resolve("nike")["merchant"]["id"], "nike")

    def test_category_keywords_and_unknowns(self):
        r = matrix.resolve("I need to buy groceries")
        self.assertEqual((r["kind"], r["group"]), ("category", "GROC"))
        self.assertEqual(matrix.resolve("petrol")["group"], "FUEL")
        self.assertIsNone(matrix.resolve("zzz qqq")["kind"])
        self.assertIsNone(matrix.resolve("")["kind"])

    def test_bare_host_forms(self):
        self.assertIsNone(matrix.host_of("not a domain"))
        self.assertIsNone(matrix.host_of("192.168.0.1"))
        self.assertIsNone(matrix.host_of("localhost"))


class MerchantRecs(Base):
    def test_amazon_non_prime_infinia_beats_amazon_pay(self):
        self.cards("u", "Infinia", "Amazon Pay ICICI", "Axis Magnus")
        res = engine.recommend_for_merchant("u", "https://www.amazon.in/x", 10000)
        self.assertEqual(res["merchant"], "Amazon")
        self.assertEqual(res["category_code"], "ONLINE")
        self.assertEqual(self.top(res)["card"], "HDFC Infinia")
        self.assertEqual(self.top(res)["reward_pct"], 3.33)
        self.assertEqual(self.top(res)["est_value_rupees"], 333.0)
        self.assertIn("assumed_rate", self.top(res)["flags"])
        ap = [r for r in res["recommended"] if r["card"] == "Amazon Pay ICICI"][0]
        self.assertEqual(ap["reward_pct"], 3.0)
        self.assertIn("merchant_offer", ap["flags"])

    def test_amazon_prime_amazon_pay_wins(self):
        self.cards("u", "Infinia", "Amazon Pay ICICI")
        res = engine.recommend_for_merchant("u", "amazon.in", 10000, prime=True)
        self.assertEqual(self.top(res)["card"], "Amazon Pay ICICI")
        self.assertEqual(self.top(res)["reward_pct"], 5.0)
        self.assertEqual(self.top(res)["est_value_rupees"], 500.0)

    def test_flipkart_axis_offer_only_at_flipkart_group(self):
        self.cards("u", "Infinia", "Flipkart Axis")
        fk = engine.recommend_for_merchant("u", "flipkart.com")
        self.assertEqual((self.top(fk)["card"], self.top(fk)["reward_pct"]), ("Flipkart Axis", 5.0))
        az = engine.recommend_for_merchant("u", "amazon.in")
        fa = [r for r in az["recommended"] if r["card"] == "Flipkart Axis"][0]
        self.assertEqual(fa["reward_pct"], 1.0)  # base only away from Flipkart

    def test_tata_neu_offer_on_tata_brand_only(self):
        self.cards("u", "Tata Neu", "Infinia")
        croma = engine.recommend_for_merchant("u", "croma.com")
        self.assertEqual((self.top(croma)["card"], self.top(croma)["reward_pct"]), ("HDFC Tata Neu Infinity", 5.0))
        nike = engine.recommend_for_merchant("u", "nike.com")
        self.assertEqual(self.top(nike)["card"], "HDFC Infinia")

    def test_diners_black_weekend_boost_not_used_for_ranking(self):
        self.cards("u", "Diners Black")
        res = engine.recommend_for_merchant("u", "swiggy.com", 1000)
        r = self.top(res)
        self.assertAlmostEqual(r["reward_pct"], 3.33, delta=0.011)
        self.assertTrue(any(f.startswith("weekend_only_boost") for f in r["flags"]))

    def test_excluded_and_unknown_go_to_not_recommended(self):
        self.cards("u", "Infinia", "Magnus", "Amex Gold Charge")
        fuel = engine.recommend_for_merchant("u", "petrol")
        self.assertEqual(fuel["recommended"][0]["card"], "Amex Gold Charge")  # Amex Gold has base rate on fuel (A)
        names = {r["card"] for r in fuel["not_recommended"]}
        self.assertEqual(names, {"HDFC Infinia", "Axis Magnus"})
        util = engine.recommend_for_merchant("u", "electricity")
        self.assertIn("Amex Gold Charge", {r["card"] for r in util["not_recommended"]})  # status U

    def test_cap_flag(self):
        self.cards("u", "SBI Cashback")
        res = engine.recommend_for_merchant("u", "amazon.in", 10000)
        self.assertEqual(self.top(res)["reward_pct"], 5.0)
        self.assertIn("has_cap", self.top(res)["flags"])

    def test_ranking_prefers_higher_confidence_on_ties(self):
        self.cards("u", "Rubyx", "Sapphiro", "Millennia")
        res = engine.recommend_for_merchant("u", "bookmyshow.com")
        pcts = [r["reward_pct"] for r in res["recommended"]]
        self.assertEqual(pcts, sorted(pcts, reverse=True))

    def test_unknown_domain_needs_category_then_works(self):
        self.cards("u", "Infinia")
        r = engine.recommend_for_merchant("u", "example.com", 500)
        self.assertEqual(r["error"], "unknown_merchant")
        ok = engine.recommend_for_merchant("u", "example.com", 500, category="dine")
        self.assertEqual(ok["category_code"], "DINE")
        self.assertEqual(ok["category_source"], "caller_supplied")
        self.assertTrue(any("not in our map" in d for d in ok["disclaimers"]))
        bad = engine.recommend_for_merchant("u", "example.com", 500, category="NOPE")
        self.assertIn("error", bad)

    def test_merchant_without_category_data(self):
        self.cards("u", "Infinia")
        r = engine.recommend_for_merchant("u", "makemytrip.com")
        self.assertEqual(r["error"], "no_category_data")

    def test_cards_without_matrix_data_are_reported_not_ranked(self):
        self.cards("u", "Infinia", "Coral", "Flipkart SBI")
        res = engine.recommend_for_merchant("u", "amazon.in")
        self.assertEqual(sorted(res["no_data_for_cards"]), ["Flipkart SBI", "ICICI Coral"])
        self.assertEqual(len(res["recommended"]), 1)

    def test_portfolio_filter_and_user_isolation(self):
        self.cards("saad", "Infinia")
        self.cards("shivam", "Emeralde", "Magnus")
        a = json.dumps(engine.recommend_for_merchant("saad", "amazon.in", 1000))
        for w in ("Emeralde", "Magnus", "ICICI", "Axis"):
            self.assertNotIn(w, a)
        b = json.dumps(engine.recommend_for_merchant("shivam", "amazon.in", 1000))
        self.assertNotIn("Infinia", b)

    def test_validation(self):
        self.cards("u", "Infinia")
        for bad in ["abc", -5, 0, float("nan"), float("inf"), 10**12]:
            self.assertIn("error", engine.recommend_for_merchant("u", "amazon.in", bad), bad)
        self.assertIn("error", engine.recommend_for_merchant("nobody", "amazon.in"))
        self.assertNotIn("error", engine.recommend_for_merchant("u", "amazon.in"))  # amount optional

    def test_no_amount_means_no_rupee_estimate(self):
        self.cards("u", "Infinia")
        self.assertNotIn("est_value_rupees", self.top(engine.recommend_for_merchant("u", "amazon.in")))


class VoucherFallbackAndPlan(Base):
    def test_matrix_fallback_for_cards_without_hand_routes(self):
        self.cards("u", "Diners Black", "Regalia Gold", "SBI Cashback", "Axis Magnus")
        res = engine.recommend_voucher_routes("u", "Lifestyle", 10000)
        unv = {(r["card"], r["channel"]): r for r in res["needs_reverification"]}
        dcb = unv[("HDFC Diners Club Black", "Bank voucher portal (merchant-portal MCC)")]
        self.assertEqual((dcb["value_pct"], dcb["value_rupees"]), (10.0, 1000.0))
        self.assertEqual(res["recommended"], [])  # nothing verified
        excl = [(r["card"], r["channel"]) for r in res["not_recommended"]]
        self.assertIn(("HDFC Regalia Gold", "Bank voucher portal (merchant-portal MCC)"), excl)  # status U
        self.assertIn(("SBI Cashback", "Direct from brand/aggregator"), excl)  # status U (5%, unverified claim)
        self.assertEqual(sum(1 for c, _ in excl if c == "Axis Magnus"), 1)  # exactly one exclusion, no fallback dupes
        self.assertEqual(res["no_data_for_cards"], [])

    def test_hand_routes_not_duplicated_by_fallback(self):
        self.cards("u", "Infinia")
        res = engine.recommend_voucher_routes("u", "Lifestyle", 10000)
        chans = [r["channel"] for r in res["recommended"]]
        self.assertEqual(len(chans), 3)
        self.assertNotIn("Direct from brand/aggregator", chans)

    def test_card_with_nothing_is_reported(self):
        self.cards("u", "Coral")
        res = engine.recommend_voucher_routes("u", "Amazon", 5000)
        self.assertEqual(len(res["recommended"]) + len(res["needs_reverification"]), 1)  # Coral has an iShop route
        self.cards("v", "Flipkart SBI")
        self.assertEqual(engine.recommend_voucher_routes("v", "Amazon", 5000)["recommended"], [])

    def test_plan_nike_shoes_from_amazon(self):
        self.cards("saad", "Infinia")
        p = engine.plan_voucher_purchase("saad", "Nike shoes from Amazon", 10000, item="Nike shoes")
        self.assertEqual((p["store"], p["voucher_brand"], p["voucher_available"]), ("Amazon", "Amazon", True))
        self.assertEqual(p["category"], "general online retail")
        self.assertEqual(p["redirect"]["url"], "/voucher-rail?brand=Amazon&amount=10000")
        self.assertEqual(p["routes"]["recommended"][0]["channel"], "HDFC SmartBuy (accelerated 5X)")

    def test_plan_redirect_is_url_encoded(self):
        self.cards("u", "Infinia")
        p = engine.plan_voucher_purchase("u", "Tata CLiQ", 5000)
        self.assertIn("brand=Tata%20CLiQ", p["redirect"]["url"])

    def test_plan_without_voucher_falls_back_to_direct(self):
        self.cards("u", "Infinia")
        p = engine.plan_voucher_purchase("u", "blinkit", 800)
        self.assertFalse(p["voucher_available"])
        self.assertEqual(p["direct_option"]["category_code"], "GROC")

    def test_plan_errors(self):
        self.cards("u", "Infinia")
        self.assertEqual(engine.plan_voucher_purchase("u", "some random shop", 100)["error"], "unknown_store")
        self.assertIn("error", engine.plan_voucher_purchase("u", "amazon", None))
        self.assertIn("error", engine.plan_voucher_purchase("u", "amazon", -1))
        self.assertIn("error", engine.plan_voucher_purchase("nobody", "amazon", 1000))


class FindCard(unittest.TestCase):
    def test_word_boundaries_and_new_cards(self):
        self.assertIsNone(engine.find_card("delite"))
        self.assertEqual(engine.find_card("SBI Cashback")["id"], "sbi_cashback")
        self.assertEqual(engine.find_card("Kotak Cashback+ Prime")["id"], "kotak_cashback_plus")
        self.assertEqual(engine.find_card("Axis Magnus Burgundy")["id"], "axis_magnus_burgundy")
        self.assertEqual(engine.find_card("my hdfc infinia metal card")["id"], "hdfc_infinia_metal")
        self.assertEqual(engine.find_card("Amex Platinum Travel")["id"], "amex_platinum_travel")
        self.assertIsNone(engine.find_card(""))


if __name__ == "__main__":
    unittest.main()
