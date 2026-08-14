from tournament.admin_auth import (
    AdminAuthError,
    hash_password,
    issue_session,
    verify_password,
    verify_session,
)
import pytest


def test_password_round_trip():
    stored = hash_password("correct-horse")
    assert stored.startswith("pbkdf2:")
    assert verify_password("correct-horse", stored)
    assert not verify_password("wrong", stored)
    assert not verify_password("correct-horse", "")
    assert not verify_password("", stored)


def test_session_round_trip():
    secret = "session-secret"
    token = issue_session(secret, now=1_000_000, ttl=60)
    exp = verify_session(token, secret, now=1_000_010)
    assert exp == 1_000_060


def test_session_rejects_tamper_and_expiry():
    secret = "session-secret"
    token = issue_session(secret, now=1_000_000, ttl=10)
    with pytest.raises(AdminAuthError):
        verify_session(token + "x", secret, now=1_000_001)
    with pytest.raises(AdminAuthError):
        verify_session(token, secret, now=1_000_011)
    with pytest.raises(AdminAuthError):
        verify_session("", secret)


def test_session_accepts_optional_bearer_prefix():
    secret = "session-secret"
    token = issue_session(secret, now=50, ttl=30)
    assert verify_session(f"Bearer {token}", secret, now=60) == 80
