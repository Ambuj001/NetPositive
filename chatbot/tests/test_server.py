import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import engine  # noqa: E402
import server  # noqa: E402


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        engine.STATE_FILE = Path(tempfile.mkdtemp()) / "pf.json"
        cls.srv = server.make_server("127.0.0.1", 0)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def call(self, method, path, body=None, headers=None, raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read()), r.headers
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read()), e.headers

    def test_flow_extension_and_isolation(self):
        self.assertEqual(self.call("GET", "/health")[0], 200)
        self.assertTrue(self.call("POST", "/portfolio/add", {"user_id": "saad", "card": "HDFC Infinia"})[1]["ok"])
        self.assertTrue(self.call("POST", "/portfolio/add", {"user_id": "shivam", "card": "Emeralde"})[1]["ok"])
        self.assertEqual(self.call("GET", "/portfolio?user_id=saad")[1]["cards"], ["HDFC Infinia"])
        st, res, _ = self.call("POST", "/recommend", {"user_id": "saad", "url": "https://www.amazon.in/dp/1", "amount": 10000})
        self.assertEqual(st, 200)
        self.assertEqual(res["recommended"][0]["card"], "HDFC Infinia")
        self.assertNotIn("Emeralde", json.dumps(res))
        res2 = self.call("POST", "/recommend", {"user_id": "shivam", "url": "amazon.in"})[1]
        self.assertNotIn("Infinia", json.dumps(res2))
        self.assertEqual(self.call("POST", "/portfolio/remove", {"user_id": "shivam", "card": "Emeralde"})[1]["removed"], "ICICI Emeralde Private Metal")

    def test_plan(self):
        self.call("POST", "/portfolio/add", {"user_id": "p1", "card": "Infinia"})
        res = self.call("POST", "/plan", {"user_id": "p1", "store": "Nike shoes from Amazon", "amount": 10000, "item": "Nike shoes"})[1]
        self.assertEqual(res["voucher_brand"], "Amazon")
        self.assertTrue(res["voucher_rail_url"].startswith("/voucher-rail?"))
        self.assertEqual(res["redirect"]["url"], "https://www.gyftr.com/instantvouchers")
        self.assertEqual(res["redirect"]["second_option"]["name"], "CRED")

    def test_verify_guide_endpoint(self):
        st, g, _ = self.call("POST", "/request/verify_guide", {"brand": "Amazon", "amount": 5000})
        self.assertEqual((st, g["check_each_voucher"][0]["expected_paise"]), (200, 500000))
        self.assertEqual(self.call("POST", "/request/verify_guide", {"brand": "Amazon"})[0], 400)

    def test_request_flow_endpoints(self):
        st, r, _ = self.call("POST", "/merchants/suggest", {"query": "shoes"})
        self.assertEqual((st, r["mode"], r["tiles"][0]["name"]), (200, "tiles", "Amazon"))
        d = self.call("POST", "/request/draft", {"merchant": "amazon", "amount": 10000, "item": "shoes"})[1]
        self.assertEqual(d["request"]["voucher_brand"], "Amazon")
        self.call("POST", "/portfolio/add", {"user_id": "buyer1", "card": "Infinia"})
        f = self.call("POST", "/request/fulfil", {"user_id": "buyer1", "brand": "Amazon", "amount": 10000})[1]
        self.assertTrue(f["options"][0]["best"])
        self.assertEqual(f["options"][0]["link"], "https://www.gyftr.com/instantvouchers")
        self.assertEqual(self.call("POST", "/request/fulfil", {"brand": "Amazon", "amount": 1})[0], 400)  # user_id required
        self.assertIn("error", self.call("POST", "/merchants/suggest", {})[1])

    def test_bad_inputs(self):
        self.assertEqual(self.call("POST", "/recommend", {"user_id": "../etc", "url": "amazon.in"})[0], 400)
        self.assertEqual(self.call("POST", "/recommend", {"url": "amazon.in"})[0], 400)
        self.assertEqual(self.call("POST", "/recommend", raw=b"{not json")[0], 400)
        self.assertEqual(self.call("POST", "/recommend", raw=b"[1,2]")[0], 400)
        self.assertEqual(self.call("POST", "/recommend", {"user_id": "x", "url": "amazon.in", "prime": "yes"})[0], 400)
        self.assertEqual(self.call("POST", "/recommend", raw=b"x" * (server.MAX_BODY + 1))[0], 413)
        self.assertEqual(self.call("GET", "/nope")[0], 404)
        self.assertEqual(self.call("POST", "/nope", {})[0], 404)
        self.assertEqual(self.call("GET", "/portfolio?user_id=")[0], 400)
        st, res, _ = self.call("POST", "/recommend", {"user_id": "empty-user", "url": "amazon.in"})
        self.assertEqual((st, "error" in res), (200, True))

    def test_cors_allowlist(self):
        _, _, h = self.call("GET", "/health", headers={"Origin": "chrome-extension://abcdefghijklmnop"})
        self.assertEqual(h.get("Access-Control-Allow-Origin"), "chrome-extension://abcdefghijklmnop")
        _, _, h = self.call("GET", "/health", headers={"Origin": "http://localhost:3000"})
        self.assertEqual(h.get("Access-Control-Allow-Origin"), "http://localhost:3000")
        for evil in ["https://evil.com", "http://localhost.evil.com", "http://127.0.0.1.evil.com", "chrome-extension://abc.evil"]:
            _, _, h = self.call("GET", "/health", headers={"Origin": evil})
            self.assertIsNone(h.get("Access-Control-Allow-Origin"), evil)

    def test_chat_validation_without_llm(self):
        self.assertEqual(self.call("POST", "/chat", {"user_id": "u", "role": "admin", "message": "hi"})[0], 400)
        self.assertEqual(self.call("POST", "/chat", {"user_id": "u", "role": "buyer", "message": "  "})[0], 400)
        self.assertEqual(self.call("POST", "/chat", {"user_id": "u", "role": "buyer", "message": "x" * 2001})[0], 400)
        self.assertEqual(self.call("POST", "/chat", {"user_id": "u", "role": "buyer", "reset": True})[1], {"ok": True, "reset": True})


if __name__ == "__main__":
    unittest.main()
