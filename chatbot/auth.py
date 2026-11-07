"""Verifies the backend's login token (JWT, HS256) with the standard library only.

The backend issues `{"sub": "<wallet address>", "exp": ...}` signed with JWT_SECRET after a wallet signature.
The chatbot uses the same secret to check the token, then treats `sub` (the wallet) as the user.
Strict on purpose: only HS256 is accepted ("none" and every other algorithm are rejected), `exp` is required,
`sub` must be a wallet address, and the signature is compared in constant time.
"""
import base64
import hashlib
import hmac
import json
import re
import time

WALLET_RE = re.compile(r"0x[0-9a-fA-F]{40}")  # used with fullmatch: "$" would accept a trailing newline
MIN_SECRET_LEN = 32  # same minimum the backend enforces
MAX_TOKEN_LEN = 4096
LEEWAY_SECONDS = 5


class AuthError(Exception):
    pass


def _b64url_decode(part):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", part or ""):
        raise AuthError("malformed token")
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def verify_token(token, secret, now=None):
    """Return the wallet address (lower-case) the token belongs to, or raise AuthError."""
    if not isinstance(secret, str) or len(secret) < MIN_SECRET_LEN:
        raise AuthError("server auth is not configured")
    if not isinstance(token, str) or not token or len(token) > MAX_TOKEN_LEN:
        raise AuthError("missing or oversized token")
    parts = token.split(".")
    if len(parts) != 3:
        raise AuthError("malformed token")
    try:
        header = json.loads(_b64url_decode(parts[0]))
        payload = json.loads(_b64url_decode(parts[1]))
        sig = _b64url_decode(parts[2])
    except (ValueError, UnicodeDecodeError):
        raise AuthError("malformed token")
    if not isinstance(header, dict) or not isinstance(payload, dict):
        raise AuthError("malformed token")
    if header.get("alg") != "HS256":
        raise AuthError("unsupported algorithm")
    want = hmac.new(secret.encode("utf-8"), f"{parts[0]}.{parts[1]}".encode("ascii"), hashlib.sha256).digest()
    if not hmac.compare_digest(want, sig):
        raise AuthError("bad signature")
    t = time.time() if now is None else now
    exp = payload.get("exp")
    if isinstance(exp, bool) or not isinstance(exp, (int, float)):
        raise AuthError("token has no expiry")
    if t > exp + LEEWAY_SECONDS:
        raise AuthError("token expired")
    nbf = payload.get("nbf")
    if nbf is not None and (isinstance(nbf, bool) or not isinstance(nbf, (int, float)) or t + LEEWAY_SECONDS < nbf):
        raise AuthError("token not valid yet")
    sub = payload.get("sub")
    if not isinstance(sub, str) or not WALLET_RE.fullmatch(sub):
        raise AuthError("token subject is not a wallet address")
    return sub.lower()


def make_token(address, secret, ttl=3600, now=None):
    """Test helper: same format as the backend's jsonwebtoken output."""
    def enc(obj):
        return base64.urlsafe_b64encode(json.dumps(obj, separators=(",", ":")).encode()).rstrip(b"=").decode()
    t = int(time.time() if now is None else now)
    head = enc({"alg": "HS256", "typ": "JWT"})
    body = enc({"sub": address, "iat": t, "exp": t + ttl})
    sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    return f"{head}.{body}.{sig}"
