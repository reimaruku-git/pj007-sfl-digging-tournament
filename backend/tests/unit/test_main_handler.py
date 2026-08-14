"""Drive the shipped HTTP router — not a reimplementation."""

import importlib
import json
import os
import sys
from pathlib import Path

from tournament.admin_auth import hash_password, issue_session

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lambda_functions" / "main_function"))

PASSWORD = "master-admin-test"
HASH = hash_password(PASSWORD)
SECRET = "unit-test-session-secret"


def _load_app(aws_env, monkeypatch):
    monkeypatch.setenv("DATA_BUCKET", aws_env["bucket"])
    monkeypatch.setenv("CONFIG_TABLE", aws_env["config_table"])
    monkeypatch.setenv("SCORES_TABLE", aws_env["scores_table"])
    monkeypatch.setenv("SUBMISSIONS_TABLE", aws_env["submissions_table"])
    monkeypatch.setenv("ADMIN_PASSWORD_HASH", HASH)
    monkeypatch.setenv("ADMIN_SESSION_SECRET", SECRET)
    monkeypatch.setenv("SFL_API_KEY", "test-key")
    monkeypatch.setenv("ALLOWED_ORIGIN", "*")
    if "app" in sys.modules:
        del sys.modules["app"]
    module = importlib.import_module("app")
    module.DATA_BUCKET = aws_env["bucket"]
    module.CONFIG_TABLE = aws_env["config_table"]
    module.SCORES_TABLE = aws_env["scores_table"]
    module.SUBMISSIONS_TABLE = aws_env["submissions_table"]
    module.SFL_API_KEY = "test-key"
    module._store = None
    module._registry = None
    return module


def _event(method: str, path: str, body=None, token: str | None = None, farm_id=None):
    headers = {"origin": "http://localhost:5173"}
    if token:
        headers["authorization"] = token
    event = {
        "rawPath": path,
        "requestContext": {"http": {"method": method}, "stage": "dev"},
        "headers": headers,
        "body": json.dumps(body) if body is not None else None,
        "pathParameters": {"farm_id": farm_id} if farm_id else {},
    }
    return event


def _json(response):
    return json.loads(response["body"])


def test_health_and_public_leaderboard(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    health = app.lambda_handler(_event("GET", "/health"), None)
    assert health["statusCode"] == 200
    assert _json(health) == {"status": "healthy"}

    board = app.lambda_handler(_event("GET", "/leaderboard"), None)
    assert board["statusCode"] == 200
    payload = _json(board)
    assert payload["entries"] == []
    assert payload["count"] == 0
    assert payload["config"]["prize_amount"] == "30"


def test_submit_then_admin_approve(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    created = app.lambda_handler(
        _event("POST", "/submissions", {"farm_id": "3666918801844311", "name": "rmr"}),
        None,
    )
    assert created["statusCode"] == 201
    duplicate = app.lambda_handler(
        _event("POST", "/submissions", {"farm_id": "3666918801844311"}),
        None,
    )
    assert duplicate["statusCode"] == 409

    login = app.lambda_handler(_event("POST", "/admin/login", {"password": PASSWORD}), None)
    assert login["statusCode"] == 200
    token = _json(login)["token"]

    listed = app.lambda_handler(_event("GET", "/admin/submissions", token=token), None)
    assert listed["statusCode"] == 200
    assert _json(listed)["count"] == 1

    approved = app.lambda_handler(
        _event(
            "POST",
            "/admin/submissions/3666918801844311/approve",
            token=token,
            farm_id="3666918801844311",
        ),
        None,
    )
    assert approved["statusCode"] == 200
    farms = app.lambda_handler(_event("GET", "/admin/farms", token=token), None)
    assert _json(farms)["farms"][0]["farm_id"] == "3666918801844311"

    board = _json(app.lambda_handler(_event("GET", "/leaderboard"), None))
    assert board["count"] == 1
    assert board["entries"][0]["status"] == "not_started"


def test_admin_routes_require_session(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    denied = app.lambda_handler(_event("GET", "/admin/farms"), None)
    assert denied["statusCode"] == 401
    bad = app.lambda_handler(_event("POST", "/admin/login", {"password": "nope"}), None)
    assert bad["statusCode"] == 401


def test_admin_override_score(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    token = issue_session(SECRET)
    add = app.lambda_handler(
        _event("POST", "/admin/farms", {"farm_id": "42", "name": "x"}, token=token),
        None,
    )
    assert add["statusCode"] == 201
    updated = app.lambda_handler(
        _event(
            "PUT",
            "/admin/scores/42",
            {"override_digs_to_third_op": 11, "override_reason": "manual"},
            token=token,
            farm_id="42",
        ),
        None,
    )
    assert updated["statusCode"] == 200
    assert _json(updated)["score"]["override_digs_to_third_op"] == 11
    board = _json(app.lambda_handler(_event("GET", "/leaderboard"), None))
    assert board["entries"][0]["digs_to_third_op"] == 11
    assert board["entries"][0]["status"] == "completed"


def test_unknown_route(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    response = app.lambda_handler(_event("GET", "/nope"), None)
    assert response["statusCode"] == 404
