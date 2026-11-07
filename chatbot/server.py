"""Local JSON API for the browser extension and the website.

Run:  python server.py            (127.0.0.1:8787)
Auth: user-specific endpoints need `Authorization: Bearer <backend login token>` (see auth.py). The user is the
wallet inside the token; a user_id in the request, if sent, must match it (403 otherwise). Set JWT_SECRET to the
backend's secret. Without it the server refuses to start unless CHATBOT_AUTH=off (local development only).
Public (no token): /health, /merchants/suggest, /request/draft, /request/verify_guide.

GET  /health
GET  /portfolio?user_id=saad
POST /portfolio/add     {"user_id","card"}
POST /portfolio/remove  {"user_id","card"}
POST /recommend         {"user_id","url" | "query", "amount"?, "prime"?, "category"?}   <- extension
POST /plan              {"user_id","store","amount","item"?,"value_mode"?}               <- website, no LLM
POST /merchants/suggest {"query"}                                      <- seller: "shoes" -> merchant tiles
POST /request/draft     {"merchant","amount","item"?}                  <- seller: summary of the request to post
POST /request/fulfil    {"user_id","brand","amount","value_mode"?}     <- buyer: ranked options, best first, each with a link
POST /request/verify_guide {"brand","amount","vouchers"?}  <- seller: how to check the submitted voucher with the extension
POST /chat              {"user_id","role":"buyer|seller","message"}                       <- website chatbot
"""
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import auth
import engine
import flow

MAX_BODY = 64 * 1024
MAX_TURNS = 50
MAX_SESSIONS = 500
USER_RE = re.compile(r"[A-Za-z0-9_.\-]{1,64}")  # always used with fullmatch: "$" would also accept a trailing newline
ORIGIN_RE = re.compile(r"^(chrome-extension|moz-extension)://[a-z0-9\-]+$|^https?://(localhost|127\.0\.0\.1)(:\d+)?$")

# Endpoints that read or change one user's data (or spend LLM budget on their behalf).
PROTECTED = {"/portfolio", "/portfolio/add", "/portfolio/remove", "/recommend", "/plan", "/request/fulfil", "/chat"}

_sessions = {}
_sessions_lock = threading.Lock()


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def _user(body, caller=None):
    """The acting user. With a verified token it is the token's wallet and any user_id sent must match it."""
    claimed = body.get("user_id")
    if caller is not None:
        if claimed is not None and (not isinstance(claimed, str) or claimed.lower() != caller):
            raise ApiError(403, "user_id does not match the signed-in wallet")
        return caller
    if not isinstance(claimed, str) or not USER_RE.fullmatch(claimed):
        raise ApiError(400, "user_id must be 1-64 chars of letters, digits, _ . -")
    return claimed


def _chat(body, caller=None):
    from llm import Chat  # imported lazily so the non-LLM endpoints work without an API key
    uid = _user(body, caller)
    role = body.get("role")
    if role not in ("buyer", "seller"):
        raise ApiError(400, "role must be 'buyer' or 'seller'")
    msg = body.get("message")
    if not isinstance(msg, str) or not msg.strip() or len(msg) > 2000:
        raise ApiError(400, "message must be a non-empty string up to 2000 chars")
    key = (uid, role)
    with _sessions_lock:
        if key not in _sessions:
            if len(_sessions) >= MAX_SESSIONS:
                raise ApiError(503, "too many active chat sessions")
            _sessions[key] = {"chat": Chat(uid, role), "turns": 0, "lock": threading.Lock()}
        sess = _sessions[key]
    with sess["lock"]:  # one message at a time per conversation
        if sess["turns"] >= MAX_TURNS:
            raise ApiError(400, "session too long; send reset=true to start a new one")
        sess["turns"] += 1
        before = len(sess["chat"].tool_log)
        try:
            reply = sess["chat"].send(msg.strip())
        except RuntimeError as e:
            raise ApiError(502, f"LLM backend error: {e}")
        tools = [n for n, _ in sess["chat"].tool_log[before:]]
    return {"reply": reply, "tools_used": tools}


def route(method, path, query, body, caller=None):
    if method == "GET" and path == "/health":
        return {"ok": True, "model": os.environ.get("OPENROUTER_MODEL", "")}
    if method == "GET" and path == "/portfolio":
        claimed = (query.get("user_id") or [None])[0]
        return engine.list_portfolio(_user({"user_id": claimed} if claimed is not None else {}, caller))
    if method != "POST":
        raise ApiError(404, "not found")
    if path == "/portfolio/add":
        return engine.add_card(_user(body, caller), str(body.get("card", "")))
    if path == "/portfolio/remove":
        return engine.remove_card(_user(body, caller), str(body.get("card", "")))
    if path == "/recommend":
        q = body.get("url") or body.get("query") or ""
        if not isinstance(q, str):
            raise ApiError(400, "url/query must be a string")
        prime = body.get("prime")
        if prime is not None and not isinstance(prime, bool):
            raise ApiError(400, "prime must be true/false")
        return engine.recommend_for_merchant(_user(body, caller), q, body.get("amount"), prime, body.get("category"))
    if path == "/plan":
        return engine.plan_voucher_purchase(_user(body, caller), str(body.get("store", "")), body.get("amount"),
                                            body.get("item"), body.get("value_mode", "travel"))
    if path == "/merchants/suggest":
        return flow.suggest_merchants(body.get("query"))
    if path == "/request/draft":
        return flow.draft_request(body.get("merchant"), body.get("amount"), body.get("item"))
    if path == "/request/fulfil":
        return flow.fulfil_request(_user(body, caller), body.get("brand"), body.get("amount"), body.get("value_mode", "travel"))
    if path == "/request/verify_guide":
        return flow.verify_received_voucher(body.get("brand"), body.get("amount"), body.get("vouchers"))
    if path == "/chat":
        if body.get("reset"):
            uid = _user(body, caller)
            with _sessions_lock:
                _sessions.pop((uid, body.get("role")), None)
            if not body.get("message"):
                return {"ok": True, "reset": True}
        return _chat(body, caller)
    raise ApiError(404, "not found")


class Handler(BaseHTTPRequestHandler):
    server_version = "NetPositiveAPI/1"

    def log_message(self, fmt, *args):  # keep request bodies/user ids out of logs
        pass

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if ORIGIN_RE.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _send(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _reject_unread_body(self):
        """Read (a bounded amount of) the request body we will not use, so the client reliably receives our 401."""
        try:
            left = min(int(self.headers.get("Content-Length") or 0), 1024 * 1024)
        except ValueError:
            left = 0
        while left > 0:
            chunk = self.rfile.read(min(65536, left))
            if not chunk:
                break
            left -= len(chunk)
        self.close_connection = True

    def _handle(self, method):
        try:
            u = urlparse(self.path)
            caller = None
            if u.path in PROTECTED and not self.server.insecure_dev:
                header = self.headers.get("Authorization") or ""
                scheme, _, token = header.partition(" ")
                if scheme != "Bearer" or not token:
                    self._reject_unread_body()
                    raise ApiError(401, "sign in first: send Authorization: Bearer <token>")
                try:
                    caller = auth.verify_token(token.strip(), self.server.jwt_secret)
                except auth.AuthError as e:
                    self._reject_unread_body()
                    raise ApiError(401, f"invalid token: {e}")
            body = {}
            if method == "POST":
                try:
                    n = int(self.headers.get("Content-Length") or 0)
                except ValueError:
                    raise ApiError(400, "bad Content-Length")
                if n > MAX_BODY:
                    left = min(n, 1024 * 1024)  # drain (bounded) so the client sees the 413 instead of a connection reset
                    while left > 0:
                        chunk = self.rfile.read(min(65536, left))
                        if not chunk:
                            break
                        left -= len(chunk)
                    self.close_connection = True
                    raise ApiError(413, "body too large")
                raw = self.rfile.read(n) if n else b"{}"
                try:
                    body = json.loads(raw or b"{}")
                except (ValueError, UnicodeDecodeError):
                    raise ApiError(400, "body must be valid JSON")
                if not isinstance(body, dict):
                    raise ApiError(400, "body must be a JSON object")
            result = route(method, u.path, parse_qs(u.query), body, caller)
            self._send(200, result)  # domain-level problems come back as {"error": ...} with 200 so clients handle them uniformly
        except ApiError as e:
            self._send(e.status, {"error": e.message})
        except Exception:  # never leak internals
            self._send(500, {"error": "internal error"})

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")


def make_server(host="127.0.0.1", port=8787, jwt_secret=None, insecure_dev=False):
    """Fail closed: a server needs either the backend's JWT secret or an explicit insecure_dev=True."""
    if not insecure_dev and not (isinstance(jwt_secret, str) and len(jwt_secret) >= auth.MIN_SECRET_LEN):
        raise ValueError(f"jwt_secret (>= {auth.MIN_SECRET_LEN} chars) is required unless insecure_dev=True")
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.jwt_secret, srv.insecure_dev = jwt_secret, bool(insecure_dev)
    return srv


if __name__ == "__main__":
    import llm  # noqa: F401  (loads .env)
    port = int(os.environ.get("PORT", "8787"))
    secret = os.environ.get("JWT_SECRET", "")
    dev = os.environ.get("CHATBOT_AUTH", "").lower() == "off"
    if not dev and len(secret) < auth.MIN_SECRET_LEN:
        raise SystemExit("Set JWT_SECRET (the backend's secret, >= 32 chars) or, for local development only, CHATBOT_AUTH=off")
    srv = make_server("127.0.0.1", port, jwt_secret=secret, insecure_dev=dev)
    print(f"NetPositive API on http://127.0.0.1:{port}" + ("  [AUTH OFF: development only]" if dev else "  [auth: backend login token required]"), flush=True)
    srv.serve_forever()
