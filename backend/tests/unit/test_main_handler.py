"""Drive the shipped HTTP router — not a reimplementation."""

import importlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lambda_functions" / "main_function"))


def _load_app(aws_env, monkeypatch):
    monkeypatch.setenv("DATA_BUCKET", aws_env["bucket"])
    monkeypatch.setenv("CONFIG_TABLE", aws_env["config_table"])
    monkeypatch.setenv("SCORES_TABLE", aws_env["scores_table"])
    monkeypatch.setenv("SUBMISSIONS_TABLE", aws_env["submissions_table"])
    monkeypatch.setenv("SFL_API_KEY", "test-key")
    monkeypatch.setenv("ALLOWED_ORIGIN", "*")
    monkeypatch.setenv("FARM_SYNC_FUNCTION", "")
    if "app" in sys.modules:
        del sys.modules["app"]
    module = importlib.import_module("app")
    module.DATA_BUCKET = aws_env["bucket"]
    module.CONFIG_TABLE = aws_env["config_table"]
    module.SCORES_TABLE = aws_env["scores_table"]
    module.SUBMISSIONS_TABLE = aws_env["submissions_table"]
    module.SFL_API_KEY = "test-key"
    module.FARM_SYNC_FUNCTION = ""
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

    listed = app.lambda_handler(_event("GET", "/admin/submissions"), None)
    assert listed["statusCode"] == 200
    assert _json(listed)["count"] == 1

    approved = app.lambda_handler(
        _event(
            "POST",
            "/admin/submissions/3666918801844311/approve",
            farm_id="3666918801844311",
        ),
        None,
    )
    assert approved["statusCode"] == 200
    farms = app.lambda_handler(_event("GET", "/admin/farms"), None)
    assert _json(farms)["farms"][0]["farm_id"] == "3666918801844311"

    board = _json(app.lambda_handler(_event("GET", "/leaderboard"), None))
    assert board["count"] == 1
    assert board["entries"][0]["status"] == "not_started"


def test_admin_override_score(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    add = app.lambda_handler(
        _event("POST", "/admin/farms", {"farm_id": "42", "name": "x"}),
        None,
    )
    assert add["statusCode"] == 201
    updated = app.lambda_handler(
        _event(
            "PUT",
            "/admin/scores/42",
            {"override_digs_to_third_op": 11, "override_reason": "manual"},
            farm_id="42",
        ),
        None,
    )
    assert updated["statusCode"] == 200
    assert _json(updated)["score"]["override_digs_to_third_op"] == 11
    board = _json(app.lambda_handler(_event("GET", "/leaderboard"), None))
    assert board["entries"][0]["digs_to_third_op"] == 11
    assert board["entries"][0]["status"] == "completed"


def test_admin_get_config_is_public_shape(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    response = app.lambda_handler(_event("GET", "/admin/config"), None)
    assert response["statusCode"] == 200
    config = _json(response)["config"]
    assert "pk" not in config
    assert "leader_farm_id" not in config
    assert {"start_at", "end_at", "prize_amount", "status"} <= set(config)


def test_admin_put_config_rescores_from_snapshot(aws_env, monkeypatch):
    from datetime import datetime, timezone

    from tournament.scoring import score_grid
    from tournament.sync import apply_computed_score

    app = _load_app(aws_env, monkeypatch)
    added = app.lambda_handler(
        _event("POST", "/admin/farms", {"farm_id": "99", "name": "rmr"}),
        None,
    )
    assert added["statusCode"] == 201

    store = app._get_store()
    early = int(datetime(2026, 8, 2, tzinfo=timezone.utc).timestamp() * 1000)
    late = int(datetime(2026, 8, 15, tzinfo=timezone.utc).timestamp() * 1000)
    grid = [
        {"dugAt": early, "items": {"Otter Pebble": 1}, "tool": "Sand Shovel"},
        {"dugAt": early, "items": {"Otter Pebble": 1}, "tool": "Sand Shovel"},
        {"dugAt": late, "items": {"Otter Pebble": 1}, "tool": "Sand Shovel"},
    ]
    computed = score_grid(
        grid,
        now=datetime(2026, 8, 16, tzinfo=timezone.utc),
        window_start=datetime(2026, 8, 1, tzinfo=timezone.utc),
        window_end=datetime(2026, 8, 20, tzinfo=timezone.utc),
    )
    apply_computed_score(store, farm_id="99", name="rmr", computed=computed)
    store.write_snapshot("99", {"farm_id": "99", "grid": grid, "score": computed.to_dict()})

    updated = app.lambda_handler(
        _event(
            "PUT",
            "/admin/config",
            {
                "start_at": "2026-08-01T00:00:00+00:00",
                "end_at": "2026-08-10T00:00:00+00:00",
                "prize_amount": "30",
            },
        ),
        None,
    )
    assert updated["statusCode"] == 200
    payload = _json(updated)
    assert "pk" not in payload["config"]
    assert payload["rescore"]["rescored"] == 1
    assert payload["rescore"]["missing_snapshots"] == 0
    row = store.get_score("99")
    assert row["otter_count"] == 2
    assert row["digs_to_third_op"] is None


def test_admin_update_farm_route_is_wired(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    app.lambda_handler(_event("POST", "/admin/farms", {"farm_id": "7", "name": "a"}), None)
    updated = app.lambda_handler(
        _event("PUT", "/admin/farms/7", {"name": "b", "active": False}, farm_id="7"),
        None,
    )
    assert updated["statusCode"] == 200
    assert _json(updated)["farm"]["name"] == "b"
    assert _json(updated)["farm"]["active"] is False


def test_unknown_route(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    response = app.lambda_handler(_event("GET", "/nope"), None)
    assert response["statusCode"] == 404
