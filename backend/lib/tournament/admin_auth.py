"""Master-admin password + HMAC session tokens.

The browser sends the raw token in ``Authorization`` (no ``Bearer `` prefix).
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time

PBKDF2_ITERATIONS = 200_000
SESSION_TTL_SECONDS = 12 * 3600


class AdminAuthError(Exception):
    def __init__(self, message: str, status_code: int = 401) -> None:
        super().__init__(message)
        self.status_code = status_code


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    """Return ``pbkdf2$iterations$salt_hex$hash_hex``."""
    if not password:
        raise ValueError("password is required")
    salt_bytes = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt_bytes, PBKDF2_ITERATIONS
    )
    # Use ':' so SAM/shell parameter-overrides cannot eat `$N` fragments.
    return f"pbkdf2:{PBKDF2_ITERATIONS}:{salt_bytes.hex()}:{digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if not password or not stored:
        return False
    separator = ":" if stored.startswith("pbkdf2:") else "$"
    parts = stored.split(separator)
    if len(parts) != 4 or parts[0] != "pbkdf2":
        return False
    try:
        iterations = int(parts[1])
        salt = bytes.fromhex(parts[2])
        expected = bytes.fromhex(parts[3])
    except ValueError:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual, expected)


def issue_session(secret: str, *, now: int | None = None, ttl: int = SESSION_TTL_SECONDS) -> str:
    if not secret:
        raise AdminAuthError("admin session secret is not configured", status_code=500)
    issued = now if now is not None else int(time.time())
    exp = issued + ttl
    nonce = secrets.token_hex(16)
    payload = f"{exp}.{nonce}"
    sig = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_session(token: str, secret: str, *, now: int | None = None) -> int:
    """Return expiry unix seconds, or raise AdminAuthError."""
    if not secret:
        raise AdminAuthError("admin session secret is not configured", status_code=500)
    if not token:
        raise AdminAuthError("missing admin session", status_code=401)
    cleaned = token.strip()
    if cleaned.lower().startswith("bearer "):
        cleaned = cleaned[7:].strip()
    parts = cleaned.split(".")
    if len(parts) != 3:
        raise AdminAuthError("invalid admin session", status_code=401)
    exp_raw, nonce, sig = parts
    payload = f"{exp_raw}.{nonce}"
    expected = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise AdminAuthError("invalid admin session", status_code=401)
    try:
        exp = int(exp_raw)
    except ValueError as exc:
        raise AdminAuthError("invalid admin session", status_code=401) from exc
    clock = now if now is not None else int(time.time())
    if clock >= exp:
        raise AdminAuthError("admin session expired", status_code=401)
    return exp


def configured_password_hash() -> str:
    return os.environ.get("ADMIN_PASSWORD_HASH", "")


def configured_session_secret() -> str:
    return os.environ.get("ADMIN_SESSION_SECRET", "")
