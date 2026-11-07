"""Authentication tests for the chatbot server: token verification (unit), every endpoint over real HTTP,
forged/expired/odd tokens, identity mixing, fail-closed startup, fuzzing, concurrency, and a token minted by the
backend's real jsonwebtoken library (skipped if backend/node_modules is not installed)."""
import base64
import hashlib
import hmac
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import auth  # noqa: E402
import engine  # noqa: E402
import server  # noqa: E402

SECRET = "s" * 40
OTHER_SECRET = "t" * 40
ALICE = "0x" + "a1" * 20
BOB = "0x" + "b2" * 20
B64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731


def forge(payload, secret=SECRET, header=None, sign=True):
    head = B64(json.dumps(header or {"alg": "HS256", "typ": "JWT"}).encode())
    body = B64(json.dumps(payload).encode())
    sig = B64(hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()) if sign else ""
    return f"{head}.{body}.{sig}"


def good(addr=ALICE, **over):
    p = {"sub": addr, "iat": int(time.time()), "exp": int(time.time()) + 600}
    p.update(over)
    return forge(p)


class FakeChat:
    """Stands in for llm.Chat so /chat can be tested without an API key."""
    instances = []

    def __init__(self, uid, role):
        self.uid, self.role, self.tool_log, self.sent = uid, role, [], []
        FakeChat.instances.append(self)

    def send(self, msg):
        self.sent.append(msg)
        return f"reply-to:{self.uid}:{self.role}:{len(self.sent)}"


class TokenUnitTests(unittest.TestCase):
    def test_valid_token_returns_lowercased_wallet(self):
        self.assertEqual(auth.verify_token(good("0x" + "AB" * 20), SECRET), "0x" + "ab" * 20)

    def test_make_token_round_trips(self):
        self.assertEqual(auth.verify_token(auth.make_token(ALICE, SECRET), SECRET), ALICE)

    def test_wrong_secret(self):
        with self.assertRaises(auth.AuthError):
            auth.verify_token(good(), OTHER_SECRET)

    def test_tampered_payload_keeps_old_signature(self):
        h, p, s = good(ALICE).split(".")
        evil = B64(json.dumps({"sub": BOB, "exp": int(time.time()) + 600}).encode())
        with self.assertRaises(auth.AuthError):
            auth.verify_token(f"{h}.{evil}.{s}", SECRET)

    def test_algorithm_none_and_other_algorithms_rejected(self):
        pl = {"sub": ALICE, "exp": int(time.time()) + 600}
        for alg in ["none", "None", "NONE", "HS384", "HS512", "RS256", "ES256", "", None, 5]:
            for sign in (True, False):
                with self.assertRaises(auth.AuthError, msg=f"alg={alg!r} sign={sign}"):
                    auth.verify_token(forge(pl, header={"alg": alg, "typ": "JWT"}, sign=sign), SECRET)

    def test_missing_alg_header(self):
        with self.assertRaises(auth.AuthError):
            auth.verify_token(forge({"sub": ALICE, "exp": int(time.time()) + 600}, header={"typ": "JWT"}), SECRET)

    def test_expiry_rules(self):
        now = 1_700_000_000
        pl = {"sub": ALICE}
        self.assertEqual(auth.verify_token(forge({**pl, "exp": now + 10}), SECRET, now=now), ALICE)
        with self.assertRaises(auth.AuthError):
            auth.verify_token(forge({**pl, "exp": now - 60}), SECRET, now=now)          # expired
        with self.assertRaises(auth.AuthError):
            auth.verify_token(forge(pl), SECRET, now=now)                              # no exp: never valid
        for bad in ["9999999999", None, True, [], {}]:
            with self.assertRaises(auth.AuthError, msg=f"exp={bad!r}"):
                auth.verify_token(forge({**pl, "exp": bad}), SECRET, now=now)

    def test_not_before(self):
        now = 1_700_000_000
        with self.assertRaises(auth.AuthError):
            auth.verify_token(forge({"sub": ALICE, "exp": now + 100, "nbf": now + 3600}), SECRET, now=now)
        self.assertEqual(auth.verify_token(forge({"sub": ALICE, "exp": now + 100, "nbf": now - 5}), SECRET, now=now), ALICE)

    def test_subject_must_be_a_wallet(self):
        for sub in [None, "", "alice", "saad", "0x123", "0x" + "g1" * 20, "0x" + "a1" * 21, " " + ALICE, ALICE + " ", ALICE + "\n", 12345, [ALICE], {"a": 1}, "../etc/passwd"]:
            with self.assertRaises(auth.AuthError, msg=f"sub={sub!r}"):
                auth.verify_token(forge({"sub": sub, "exp": int(time.time()) + 600}), SECRET)

    def test_garbage_tokens(self):
        for t in [None, "", " ", "a", "a.b", "a.b.c", "a.b.c.d", "...", "eyJ.eyJ.sig", "💥", "Bearer x", b"bytes", 123, "a.b.c\x00", "x" * 5000]:
            with self.assertRaises(auth.AuthError, msg=repr(t)[:40]):
                auth.verify_token(t, SECRET)

    def test_non_json_parts(self):
        head = B64(b'{"alg":"HS256"}')
        for body in [B64(b"not json"), B64(b"[1,2]"), B64(b"null"), B64(b'"str"')]:
            sig = B64(hmac.new(SECRET.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
            with self.assertRaises(auth.AuthError):
                auth.verify_token(f"{head}.{body}.{sig}", SECRET)

    def test_unconfigured_or_weak_secret_never_verifies(self):
        for sec in [None, "", "short", "x" * 31, 123]:
            with self.assertRaises(auth.AuthError):
                auth.verify_token(forge({"sub": ALICE, "exp": int(time.time()) + 600}, secret=sec if isinstance(sec, str) else ""), sec)

    def test_empty_signature_rejected(self):
        h, p, _ = good().split(".")
        with self.assertRaises(auth.AuthError):
            auth.verify_token(f"{h}.{p}.", SECRET)


class ServerAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        engine.STATE_FILE = Path(tempfile.mkdtemp()) / "pf.json"
        cls.fake_llm = types.ModuleType("llm")
        cls.fake_llm.Chat = FakeChat
        cls._saved_llm = sys.modules.get("llm")
        sys.modules["llm"] = cls.fake_llm
        cls.srv = server.make_server("127.0.0.1", 0, jwt_secret=SECRET)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        if cls._saved_llm is not None:
            sys.modules["llm"] = cls._saved_llm
        else:
            sys.modules.pop("llm", None)

    def call(self, method, path, body=None, token=None, headers=None, raw=None):
        h = {"Content-Type": "application/json", **(headers or {})}
        if token is not None:
            h["Authorization"] = f"Bearer {token}"
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read()), r.headers
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read()), e.headers

    def setUp(self):  # every test starts with empty portfolios
        engine.STATE_FILE.unlink(missing_ok=True)

    # ---- who needs a token
    PROTECTED_CALLS = [
        ("GET", "/portfolio", None),
        ("POST", "/portfolio/add", {"card": "HDFC Infinia"}),
        ("POST", "/portfolio/remove", {"card": "HDFC Infinia"}),
        ("POST", "/recommend", {"url": "amazon.in"}),
        ("POST", "/plan", {"store": "Amazon", "amount": 1000}),
        ("POST", "/request/fulfil", {"brand": "Amazon", "amount": 1000}),
        ("POST", "/chat", {"role": "buyer", "message": "hi"}),
        ("POST", "/chat", {"role": "buyer", "reset": True}),
    ]

    def test_every_protected_endpoint_rejects_missing_token(self):
        for m, p, b in self.PROTECTED_CALLS:
            body = {**(b or {}), "user_id": ALICE} if m == "POST" else None
            path = p + (f"?user_id={ALICE}" if m == "GET" else "")
            st, res, _ = self.call(m, path, body)
            self.assertEqual(st, 401, f"{m} {p}")
            self.assertIn("error", res)

    def test_the_old_attack_does_not_work(self):
        """Anyone claiming to be a user with just a user_id used to succeed; now it is a 401 and nothing is read or written."""
        self.call("POST", "/portfolio/add", {"user_id": ALICE, "card": "Axis Magnus"}, token=good(ALICE))
        st, res, _ = self.call("GET", f"/portfolio?user_id={ALICE}")
        self.assertEqual(st, 401)
        self.assertNotIn("Magnus", json.dumps(res))
        st, res, _ = self.call("POST", "/recommend", {"user_id": ALICE, "url": "amazon.in"})
        self.assertEqual(st, 401)

    def test_bad_tokens_rejected_on_every_protected_endpoint(self):
        bads = {
            "wrong secret": forge({"sub": ALICE, "exp": int(time.time()) + 600}, secret=OTHER_SECRET),
            "expired": good(exp=int(time.time()) - 3600),
            "no exp": forge({"sub": ALICE}),
            "alg none": forge({"sub": ALICE, "exp": int(time.time()) + 600}, header={"alg": "none"}, sign=False),
            "non-wallet sub": good("saad"),
            "garbage": "not.a.token",
        }
        for label, tok in bads.items():
            for m, p, b in self.PROTECTED_CALLS:
                path = p + ("?user_id=" + ALICE if m == "GET" else "")
                st, _, _ = self.call(m, path, ({**(b or {})} if m == "POST" else None), token=tok)
                self.assertEqual(st, 401, f"{label}: {m} {p}")

    def test_header_format_variants(self):
        tok = good()
        for hdr in [tok, f"Basic {tok}", f"Token {tok}", "Bearer", "Bearer ", f"bearer{tok}", ""]:
            st, _, _ = self.call("GET", "/portfolio", headers={"Authorization": hdr})
            self.assertEqual(st, 401, repr(hdr)[:30])
        st, _, _ = self.call("GET", f"/portfolio?token={tok}")  # tokens are not accepted in the URL
        self.assertEqual(st, 401)
        st, _, _ = self.call("POST", "/portfolio/add", {"card": "HDFC Infinia", "token": tok})  # nor in the body
        self.assertEqual(st, 401)

    def test_public_endpoints_need_no_token(self):
        self.assertEqual(self.call("GET", "/health")[0], 200)
        self.assertEqual(self.call("POST", "/merchants/suggest", {"query": "shoes"})[0], 200)
        self.assertEqual(self.call("POST", "/request/draft", {"merchant": "amazon", "amount": 1000})[0], 200)
        self.assertEqual(self.call("POST", "/request/verify_guide", {"brand": "Amazon", "amount": 5000})[0], 200)

    def test_even_public_endpoints_ignore_garbage_tokens(self):
        self.assertEqual(self.call("GET", "/health", token="garbage")[0], 200)

    def test_user_comes_from_the_token_when_user_id_is_omitted(self):
        t = good(ALICE)
        st, res, _ = self.call("POST", "/portfolio/add", {"card": "HDFC Infinia"}, token=t)
        self.assertEqual(st, 200)
        self.assertTrue(res["ok"])
        self.assertEqual(self.call("GET", "/portfolio", token=t)[1]["cards"], ["HDFC Infinia"])
        st, res, _ = self.call("POST", "/recommend", {"url": "https://www.amazon.in/dp/1", "amount": 10000}, token=t)
        self.assertEqual((st, res["recommended"][0]["card"]), (200, "HDFC Infinia"))
        self.call("POST", "/portfolio/remove", {"card": "Infinia"}, token=t)

    def test_matching_user_id_is_fine_case_insensitive(self):
        t = good("0x" + "AB" * 20)
        st, res, _ = self.call("POST", "/portfolio/add", {"user_id": "0x" + "ab" * 20, "card": "Axis Atlas"}, token=t)
        self.assertEqual(st, 200)
        self.assertEqual(self.call("GET", f"/portfolio?user_id=0x{'AB' * 20}", token=t)[0], 200)
        self.call("POST", "/portfolio/remove", {"card": "Atlas"}, token=t)

    def test_identity_is_always_the_lowercase_wallet_from_the_token_whatever_case_the_request_uses(self):
        low = "0x" + "ef" * 20
        self.call("POST", "/portfolio/add", {"user_id": low.upper().replace("0X", "0x"), "card": "Axis Atlas"}, token=good(low))
        self.call("POST", "/portfolio/add", {"card": "SBI Cashback"}, token=good(low.upper().replace("0X", "0x")))
        self.assertEqual(sorted(self.call("GET", "/portfolio", token=good(low))[1]["cards"]), ["Axis Atlas", "SBI Cashback"])
        saved = json.loads(engine.STATE_FILE.read_text(encoding="utf-8"))
        self.assertEqual(list(saved), [low])  # exactly one stored identity: the lowercase wallet

    def test_cannot_act_as_someone_else_even_with_a_valid_token(self):
        ta, tb = good(ALICE), good(BOB)
        self.call("POST", "/portfolio/add", {"card": "Axis Magnus"}, token=ta)
        self.call("POST", "/portfolio/add", {"card": "SBI Cashback"}, token=tb)
        for m, p, b in self.PROTECTED_CALLS:
            if m == "POST":
                st, res, _ = self.call(m, p, {**(b or {}), "user_id": ALICE}, token=tb)
                self.assertEqual(st, 403, f"{p}: {res}")
        st, res, _ = self.call("GET", f"/portfolio?user_id={ALICE}", token=tb)
        self.assertEqual(st, 403)
        self.assertNotIn("Magnus", json.dumps(res))
        self.assertEqual(self.call("GET", "/portfolio", token=tb)[1]["cards"], ["SBI Cashback"])   # Bob sees only his own
        self.assertEqual(self.call("GET", "/portfolio", token=ta)[1]["cards"], ["Axis Magnus"])
        for tok, card in ((ta, "Magnus"), (tb, "SBI")):
            self.call("POST", "/portfolio/remove", {"card": card}, token=tok)

    def test_weird_user_id_values_with_a_valid_token(self):
        t = good(ALICE)
        for bad in [BOB, "", "alice", None and 1, 123, ["x"], {"a": 1}, "../etc", ALICE + "x", "0x"]:
            if bad is None:
                continue
            st, _, _ = self.call("POST", "/portfolio/add", {"user_id": bad, "card": "Axis Atlas"}, token=t)
            self.assertEqual(st, 403, repr(bad))
        self.assertEqual(self.call("GET", "/portfolio", token=t)[1]["cards"], [])  # none of those attempts wrote anything

    def test_expired_token_stops_working_but_a_fresh_one_works(self):
        old = good(ALICE, exp=int(time.time()) - 100)
        self.assertEqual(self.call("GET", "/portfolio", token=old)[0], 401)
        self.assertEqual(self.call("GET", "/portfolio", token=good(ALICE))[0], 200)

    def test_chat_is_bound_to_the_wallet_and_sessions_are_separate(self):
        FakeChat.instances.clear()
        ta, tb = good(ALICE), good(BOB)
        r1 = self.call("POST", "/chat", {"role": "buyer", "message": "hello"}, token=ta)
        self.assertEqual((r1[0], r1[1]["reply"]), (200, f"reply-to:{ALICE}:buyer:1"))
        r2 = self.call("POST", "/chat", {"role": "buyer", "message": "hello"}, token=tb)
        self.assertEqual(r2[1]["reply"], f"reply-to:{BOB}:buyer:1")
        r3 = self.call("POST", "/chat", {"role": "buyer", "message": "again"}, token=ta)
        self.assertEqual(r3[1]["reply"], f"reply-to:{ALICE}:buyer:2")  # same session continues for the same wallet
        self.assertEqual({c.uid for c in FakeChat.instances}, {ALICE, BOB})
        st, _, _ = self.call("POST", "/chat", {"user_id": ALICE, "role": "buyer", "message": "i am alice"}, token=tb)
        self.assertEqual(st, 403)
        self.assertEqual(sum(len(c.sent) for c in FakeChat.instances if c.uid == ALICE), 2)  # Bob's attempt never reached Alice's chat

    def test_chat_reset_only_resets_your_own_session(self):
        ta, tb = good(ALICE), good(BOB)
        self.call("POST", "/chat", {"role": "seller", "message": "one"}, token=ta)
        self.call("POST", "/chat", {"role": "seller", "message": "one"}, token=tb)
        self.assertEqual(self.call("POST", "/chat", {"user_id": ALICE, "role": "seller", "reset": True}, token=tb)[0], 403)
        self.assertEqual(self.call("POST", "/chat", {"role": "seller", "reset": True}, token=ta)[1], {"ok": True, "reset": True})
        self.assertEqual(self.call("POST", "/chat", {"role": "seller", "message": "two"}, token=ta)[1]["reply"], f"reply-to:{ALICE}:seller:1")  # Alice restarted
        self.assertEqual(self.call("POST", "/chat", {"role": "seller", "message": "two"}, token=tb)[1]["reply"], f"reply-to:{BOB}:seller:2")  # Bob untouched

    def test_validation_still_applies_after_auth(self):
        t = good(ALICE)
        self.assertEqual(self.call("POST", "/chat", {"role": "admin", "message": "hi"}, token=t)[0], 400)
        self.assertEqual(self.call("POST", "/chat", {"role": "buyer", "message": "  "}, token=t)[0], 400)
        self.assertEqual(self.call("POST", "/recommend", raw=b"{nope", token=t)[0], 400)
        self.assertEqual(self.call("POST", "/recommend", raw=b"[1]", token=t)[0], 400)
        self.assertEqual(self.call("POST", "/recommend", raw=b"x" * (server.MAX_BODY + 1), token=t)[0], 413)

    def test_unauthenticated_oversized_body_gets_401_not_a_hang_or_reset(self):
        st, res, _ = self.call("POST", "/chat", raw=b"x" * (server.MAX_BODY + 5000))
        self.assertEqual(st, 401)
        st, res, _ = self.call("POST", "/portfolio/add", raw=b"{not json")
        self.assertEqual(st, 401)  # auth is checked before the body is even parsed

    def test_oversized_authorization_header_is_rejected(self):
        st, _, _ = self.call("GET", "/portfolio", token="a" * 6000)
        self.assertEqual(st, 401)

    def test_error_messages_do_not_echo_the_token_or_secret(self):
        tok = forge({"sub": ALICE, "exp": int(time.time()) + 600}, secret=OTHER_SECRET)
        st, res, _ = self.call("GET", "/portfolio", token=tok)
        text = json.dumps(res)
        self.assertEqual(st, 401)
        self.assertNotIn(tok, text)
        self.assertNotIn(SECRET, text)
        self.assertNotIn(OTHER_SECRET, text)

    def test_cors_preflight_allows_authorization_header_only_for_allowed_origins(self):
        req = urllib.request.Request(self.base + "/chat", method="OPTIONS", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Headers": "authorization,content-type"})
        with urllib.request.urlopen(req, timeout=10) as r:
            self.assertEqual(r.status, 204)
            self.assertIn("Authorization", r.headers.get("Access-Control-Allow-Headers", ""))
        req = urllib.request.Request(self.base + "/chat", method="OPTIONS", headers={"Origin": "https://evil.com"})
        with urllib.request.urlopen(req, timeout=10) as r:
            self.assertIsNone(r.headers.get("Access-Control-Allow-Origin"))

    def test_fuzzed_tokens_never_cause_a_500_or_a_pass(self):
        rnd = random.Random(1234)
        alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.=+/ "
        base = good(ALICE)
        for i in range(250):
            kind = i % 5
            if kind == 0:
                tok = "".join(rnd.choice(alphabet) for _ in range(rnd.randint(1, 300)))
            elif kind == 1:  # flip one char of a valid token
                j = rnd.randrange(len(base))
                tok = base[:j] + rnd.choice([c for c in alphabet if c != base[j]]) + base[j + 1:]
                if tok == base:
                    continue
            elif kind == 2:  # truncate
                tok = base[: rnd.randrange(1, len(base) - 1)]
            elif kind == 3:  # three random b64 segments
                tok = ".".join(B64(rnd.randbytes(rnd.randint(1, 40))) for _ in range(3))
            else:  # valid-looking structure, random payload
                tok = forge(rnd.choice([{}, {"sub": None}, {"exp": 1}, {"sub": ALICE}, [1], "x"]) if False else {"sub": rnd.choice([ALICE, 1, None, "x"]), "exp": rnd.choice([1, None, "z", 10**12])}, secret=OTHER_SECRET)
            st, res, _ = self.call("GET", "/portfolio", token=tok)
            self.assertEqual(st, 401, f"fuzz #{i}: {tok[:60]!r} -> {st} {res}")

    def test_concurrent_users_never_see_each_other(self):
        wallets = ["0x" + f"{i:02x}" * 20 for i in range(1, 13)]
        cards = ["HDFC Infinia", "Axis Magnus", "SBI Cashback", "Axis Atlas"]

        def work(i):
            w, tok = wallets[i], good(wallets[i])
            card = cards[i % len(cards)]
            out = []
            for _ in range(5):
                self.call("POST", "/portfolio/add", {"card": card}, token=tok)
                out.append(self.call("GET", "/portfolio", token=tok)[1]["cards"])
                other = wallets[(i + 1) % len(wallets)]
                out.append(self.call("GET", f"/portfolio?user_id={other}", token=tok)[0])
            return i, card, out

        with ThreadPoolExecutor(8) as ex:
            for i, card, out in ex.map(work, range(len(wallets))):
                for entry in out:
                    if isinstance(entry, int):
                        self.assertEqual(entry, 403)
                    else:
                        self.assertEqual(entry, [engine_name(card)])
        for i, w in enumerate(wallets):
            self.assertEqual(len(self.call("GET", "/portfolio", token=good(w))[1]["cards"]), 1)

    def test_users_with_the_same_card_do_not_share_state_across_case(self):
        self.call("POST", "/portfolio/add", {"card": "Axis Atlas"}, token=good("0x" + "CD" * 20))
        self.assertEqual(self.call("GET", "/portfolio", token=good("0x" + "cd" * 20))[1]["cards"], [engine_name("Axis Atlas")])
        self.call("POST", "/portfolio/remove", {"card": "Atlas"}, token=good("0x" + "cd" * 20))


def engine_name(card):
    return engine.resolve_card(card)["name"] if hasattr(engine, "resolve_card") else engine.add_card("__probe__", card)["added"]


class StartupTests(unittest.TestCase):
    def test_server_refuses_to_start_without_a_secret(self):
        for kw in [{}, {"jwt_secret": ""}, {"jwt_secret": "short"}, {"jwt_secret": None}]:
            with self.assertRaises(ValueError, msg=str(kw)):
                server.make_server("127.0.0.1", 0, **kw)

    def test_insecure_dev_must_be_explicit(self):
        s = server.make_server("127.0.0.1", 0, insecure_dev=True)
        self.assertTrue(s.insecure_dev)
        s.server_close()

    def test_main_process_refuses_to_start_without_secret_and_prints_how_to_fix_it(self):
        env = {k: v for k, v in os.environ.items() if k not in ("JWT_SECRET", "CHATBOT_AUTH")}
        env["PORT"] = "0"
        p = subprocess.run([sys.executable, "server.py"], cwd=Path(__file__).parent.parent, env=env, capture_output=True, text=True, timeout=30)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("JWT_SECRET", p.stderr + p.stdout)

    def test_main_process_with_auth_off_says_so(self):
        env = {k: v for k, v in os.environ.items() if k != "JWT_SECRET"}
        env.update({"CHATBOT_AUTH": "off", "PORT": "0"})
        p = subprocess.Popen([sys.executable, "server.py"], cwd=Path(__file__).parent.parent, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            line = p.stdout.readline()
        finally:
            p.kill()
            p.wait()
        self.assertIn("AUTH OFF", line)


@unittest.skipUnless((Path(__file__).parents[2] / "backend" / "node_modules" / "jsonwebtoken").exists() and shutil.which("node"), "backend dependencies not installed")
class BackendTokenInteropTests(unittest.TestCase):
    """The token must be exactly what the backend's own code (jsonwebtoken, HS256, sub=address, 12h) produces."""

    def mint(self, address, secret, ttl="12h"):
        code = "import jwt from 'jsonwebtoken'; process.stdout.write(jwt.sign({sub: process.argv[1]}, process.argv[2], {expiresIn: process.argv[3], algorithm: 'HS256'}))"
        backend = Path(__file__).parents[2] / "backend"
        out = subprocess.run(["node", "--input-type=module", "-e", code, address, secret, ttl], cwd=backend, capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return out.stdout.strip()

    def test_real_backend_token_is_accepted_with_checksummed_address(self):
        addr = "0xAbCdEf0123456789aBcDeF0123456789abcdef01"
        self.assertEqual(auth.verify_token(self.mint(addr, SECRET), SECRET), addr.lower())

    def test_real_backend_token_with_other_secret_or_expired_is_rejected(self):
        with self.assertRaises(auth.AuthError):
            auth.verify_token(self.mint(ALICE, OTHER_SECRET), SECRET)
        with self.assertRaises(auth.AuthError):
            auth.verify_token(self.mint(ALICE, SECRET, ttl="12h"), SECRET, now=time.time() + 13 * 3600)


if __name__ == "__main__":
    unittest.main()
