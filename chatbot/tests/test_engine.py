import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import engine  # noqa: E402


class EngineTests(unittest.TestCase):
    def setUp(self):
        engine.STATE_FILE = Path(tempfile.mkdtemp()) / "pf.json"

    def names(self, res, key):
        return [r["card"] for r in res[key]]

    def test_walkthrough_numbers_infinia(self):
        engine.add_card("priya", "HDFC Infinia")
        res = engine.recommend_voucher_routes("priya", "Lifestyle", 10000)
        by = {r["channel"]: r for r in res["recommended"]}
        smart = by["HDFC SmartBuy (accelerated 5X)"]
        self.assertEqual(smart["points"], 1650)
        self.assertEqual(smart["value_pct"], 16.5)
        self.assertEqual(by["HDFC SmartBuy InstaDeals (GyFTR)"]["value_pct"], 10.5)
        self.assertEqual(by["Direct on merchant/brand site"]["value_pct"], 3.3)
        self.assertEqual(res["recommended"][0]["channel"], "HDFC SmartBuy (accelerated 5X)")

    def test_statement_credit_mode(self):
        engine.add_card("priya", "infinia")
        res = engine.recommend_voucher_routes("priya", "Lifestyle", 10000, "statement")
        self.assertEqual(res["recommended"][0]["channel"], "HDFC SmartBuy InstaDeals (GyFTR)")  # scenario E
        self.assertEqual(res["recommended"][0]["value_pct"], 8.4)  # 7.5% off + 300 pts x Rs0.30
        smart = [r for r in res["recommended"] if "5X" in r["channel"]][0]
        self.assertEqual(smart["value_pct"], 4.95)

    def test_bonus_cap_exhausted(self):
        engine.add_card("priya", "infinia")
        pf = engine.get_portfolio("priya")
        pf["caps_used"] = {"hdfc_smartbuy_voucher_bonus": 3000}
        engine.save_portfolio("priya", pf)
        res = engine.recommend_voucher_routes("priya", "Lifestyle", 10000)
        self.assertEqual(res["recommended"][0]["channel"], "HDFC SmartBuy InstaDeals (GyFTR)")  # scenario B

    def test_never_recommends_cards_outside_portfolio(self):
        engine.add_card("saad", "Infinia")
        engine.add_card("shivam", "Axis Magnus")
        res = engine.recommend_voucher_routes("saad", "Lifestyle", 10000)
        everything = str(res)
        for forbidden in ("Magnus", "ICICI", "SBI", "Emeralde"):
            self.assertNotIn(forbidden, everything)

    def test_users_are_isolated(self):
        engine.add_card("saad", "Infinia")
        engine.add_card("shivam", "Emeralde")
        self.assertEqual(engine.list_portfolio("saad")["cards"], ["HDFC Infinia"])
        self.assertEqual(engine.list_portfolio("shivam")["cards"], ["ICICI Emeralde Private Metal"])
        res = engine.recommend_voucher_routes("shivam", "Lifestyle", 10000)
        self.assertNotIn("Infinia", str(res))

    def test_excluded_card_says_so(self):
        engine.add_card("u", "Magnus")
        res = engine.recommend_voucher_routes("u", "Lifestyle", 10000)
        self.assertEqual(res["recommended"], [])
        self.assertIn("earn 0", res["not_recommended"][0]["reason"])

    def test_stale_data_is_not_top_recommendation(self):
        engine.add_card("u", "Emeralde")
        engine.add_card("u", "Infinia")
        res = engine.recommend_voucher_routes("u", "Lifestyle", 10000)
        self.assertEqual(res["recommended"][0]["card"], "HDFC Infinia")
        self.assertTrue(res["needs_reverification"])

    def test_empty_portfolio(self):
        self.assertIn("error", engine.recommend_voucher_routes("nobody", "Lifestyle", 10000))

    def test_seller_region_gate(self):
        engine.add_card("rohan", "Obsidian")
        res = engine.recommend_seller_options("rohan", 10000)  # region IN
        self.assertTrue(any(o.get("available") is False for o in res["options"]))


if __name__ == "__main__":
    unittest.main()
