"""Local JSON API for the browser extension and the website.

Run:  python server.py            (127.0.0.1:8787)
No auth yet: user_id is trusted as given. Put real auth in front before any public deployment.

GET  /health
GET  /portfolio?user_id=saad
POST /portfolio/add     {"user_id","card"}
POST /portfolio/remove  {"user_id","card"}
POST /recommend         {"user_id","url" | "query", "amount"?, "prime"?, "category"?}   <- extension
POST /plan              {"user_id","store","amount","item"?,"value_mode"?}               <- website, no LLM
POST /chat              {"user_id","role":"buyer|seller","message"}                       <- website chatbot
"""
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import engine

MAX_BODY = 64 * 1024
MAX_TURNS = 50
MAX_SESSIONS = 500
USER_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")
ORIGIN_RE = re.compile(r"^(chrome-extension|moz-extension)://[a-z0-9\-]+$|^https?://(localhost|127\.0\.0\.1)(:\d+)?$")

_sessions = {}
_sessions_lock = threading.Lock()


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def _user(body):
    uid = body.get("user_id")
    if not isinstance(uid, str) or not USER_RE.match(uid):
        raise ApiError(400, "user_id must be 1-64 chars of letters, digits, _ . -")
    return uid


def _chat(body):
    from llm import Chat  # imported lazily so the non-LLM endpoints work without an API key
    uid = _user(body)
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


def route(method, path, query, body):
    if method == "GET" and path == "/health":
        return {"ok": True, "model": os.environ.get("OPENROUTER_MODEL", "")}
    if method == "GET" and path == "/portfolio":
        uid = (query.get("user_id") or [""])[0]
        if not USER_RE.match(uid):
            raise ApiError(400, "user_id must be 1-64 chars of letters, digits, _ . -")
        return engine.list_portfolio(uid)
    if method != "POST":
        raise ApiError(404, "not found")
    if path == "/portfolio/add":
        return engine.add_card(_user(body), str(body.get("card", "")))
    if path == "/portfolio/remove":
        return engine.remove_card(_user(body), str(body.get("card", "")))
    if path == "/recommend":
        q = body.get("url") or body.get("query") or ""
        if not isinstance(q, str):
            raise ApiError(400, "url/query must be a string")
        prime = body.get("prime")
        if prime is not None and not isinstance(prime, bool):
            raise ApiError(400, "prime must be true/false")
        return engine.recommend_for_merchant(_user(body), q, body.get("amount"), prime, body.get("category"))
    if path == "/plan":
        return engine.plan_voucher_purchase(_user(body), str(body.get("store", "")), body.get("amount"),
                                            body.get("item"), body.get("value_mode", "travel"))
    if path == "/chat":
        if body.get("reset"):
            with _sessions_lock:
                _sessions.pop((body.get("user_id"), body.get("role")), None)
            if not body.get("message"):
                return {"ok": True, "reset": True}
        return _chat(body)
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
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
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

    def _handle(self, method):
        try:
            u = urlparse(self.path)
            body = {}
            if method == "POST":
                try:
                    n = int(self.headers.get("Content-Length") or 0)
                except ValueError:
                    raise ApiError(400, "bad Content-Length")
                if n > MAX_BODY:
                    raise ApiError(413, "body too large")
                raw = self.rfile.read(n) if n else b"{}"
                try:
                    body = json.loads(raw or b"{}")
                except (ValueError, UnicodeDecodeError):
                    raise ApiError(400, "body must be valid JSON")
                if not isinstance(body, dict):
                    raise ApiError(400, "body must be a JSON object")
            result = route(method, u.path, parse_qs(u.query), body)
            self._send(200, result)  # domain-level problems come back as {"error": ...} with 200 so clients handle them uniformly
        except ApiError as e:
            self._send(e.status, {"error": e.message})
        except Exception:  # never leak internals
            self._send(500, {"error": "internal error"})

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")


def make_server(host="127.0.0.1", port=8787):
    return ThreadingHTTPServer((host, port), Handler)


if __name__ == "__main__":
    import llm  # noqa: F401  (loads .env)
    port = int(os.environ.get("PORT", "8787"))
    srv = make_server("127.0.0.1", port)
    print(f"NetPositive API on http://127.0.0.1:{port}")
    srv.serve_forever()
