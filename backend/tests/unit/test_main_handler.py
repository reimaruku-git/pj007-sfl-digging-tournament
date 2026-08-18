"""Drive the shipped HTTP router — not a reimplementation."""

import importlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from tournament.scoring import score_grid
from tournament.sync import apply_computed_score, refresh_leaderboard

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
    module.FARM_SYNC_FUNCTION = ""
    module._store = None
    module._registry = None
    module._lambda = None
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
    assert payload["config"]["status"] == "scheduled"
    assert not payload["config"].get("start_at")
    listed = _json(app.lambda_handler(_event("GET", "/tournaments"), None))
    assert listed["tournaments"] == []
    assert listed["count"] == 0


def test_leaderboard_cached_score_is_json_number(aws_env, monkeypatch):
    """GET /leaderboard must emit score as a float after a Dynamo cache read."""
    app = _load_app(aws_env, monkeypatch)
    store = app._get_store()
    store.put_config(
        {
            "start_at": "2026-08-01T00:00:00+00:00",
            "end_at": "2026-08-31T00:00:00+00:00",
            "duration_days": 30,
            "prize_amount": "30",
            "status": "active",
            "current_tournament_id": "20260801T000000Z_30d",
        }
    )
    store.put_score(
        {
            "farm_id": "99",
            "name": "rmr",
            "status": "completed",
            "digs_to_third_op": 12,
            "otter_count": 3,
            "total_digs": 70,
            "digs_today": 0,
            "invalidated": False,
        }
    )
    app.lambda_handler(_event("POST", "/admin/farms", {"farm_id": "99", "name": "rmr"}), None)
    refresh_leaderboard(store, now=datetime(2026, 8, 15, tzinfo=timezone.utc))
    cached = store.get_leaderboard_cache()
    assert cached is not None
    assert cached["entries"]

    board = app.lambda_handler(_event("GET", "/leaderboard"), None)
    assert board["statusCode"] == 200
    score = _json(board)["entries"][0]["score"]
    assert type(score) is float
    assert score == 0.4


def test_submit_then_admin_approve(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    opened = _open_live_cup(app)
    created = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "name": "rmr",
                "tournament_id": opened["tournament_id"],
            },
        ),
        None,
    )
    assert created["statusCode"] == 201
    duplicate = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "3666918801844311", "tournament_id": opened["tournament_id"]},
        ),
        None,
    )
    assert duplicate["statusCode"] == 409

    listed = app.lambda_handler(_event("GET", "/admin/submissions"), None)
    assert listed["statusCode"] == 200
    assert _json(listed)["count"] == 1
    assert _json(listed)["submissions"][0]["tournament_id"] == opened["tournament_id"]

    approved = app.lambda_handler(
        _event(
            "POST",
            f"/admin/submissions/3666918801844311/{opened['tournament_id']}/approve",
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
    opened = app.lambda_handler(
        _event(
            "POST",
            "/admin/tournaments",
            {
                "name": "Override cup",
                "start_at": "2026-08-10T00:00:00+00:00",
                "end_at": "2026-08-20T00:00:00+00:00",
                "prize_amount": "30",
            },
        ),
        None,
    )
    assert opened["statusCode"] == 201
    tid = _json(opened)["tournament"]["tournament_id"]
    enrolled = app.lambda_handler(
        _event("POST", f"/admin/tournaments/{tid}/farms", {"farm_ids": ["42"]}),
        None,
    )
    assert enrolled["statusCode"] == 200
    board = _json(app.lambda_handler(_event("GET", "/leaderboard"), None))
    assert board["entries"][0]["digs_to_third_op"] == 11
    assert board["entries"][0]["status"] == "completed"


def _open_live_cup(app):
    created = app.lambda_handler(
        _event(
            "POST",
            "/admin/tournaments",
            {
                "name": "Live cup",
                "start_at": "2026-08-10T00:00:00+00:00",
                "end_at": "2026-08-20T00:00:00+00:00",
                "prize_amount": "30",
            },
        ),
        None,
    )
    assert created["statusCode"] == 201
    return _json(created)["tournament"]


def _enroll(app, tournament_id, farm_ids):
    response = app.lambda_handler(
        _event(
            "POST",
            f"/admin/tournaments/{tournament_id}/farms",
            {"farm_ids": farm_ids},
        ),
        None,
    )
    assert response["statusCode"] == 200
    return response


def test_untracked_farm_is_purged_from_leaderboard(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    cup = _open_live_cup(app)
    store = app._get_store()
    store.put_score(
        {
            "farm_id": "ghost",
            "name": "ghost",
            "status": "completed",
            "digs_to_third_op": 8,
            "otter_count": 3,
            "total_digs": 8,
            "digs_today": 0,
            "invalidated": False,
        }
    )
    app.lambda_handler(_event("POST", "/admin/farms", {"farm_id": "42", "name": "kept"}), None)
    _enroll(app, cup["tournament_id"], ["42"])
    board = _json(app.lambda_handler(_event("GET", "/leaderboard"), None))
    ids = [row["farm_id"] for row in board["entries"]]
    assert "ghost" not in ids
    assert "42" in ids
    assert store.get_score("ghost") is None


def test_remove_farm_deletes_score_and_board_row(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    cup = _open_live_cup(app)
    added = app.lambda_handler(_event("POST", "/admin/farms", {"farm_id": "42", "name": "x"}), None)
    assert added["statusCode"] == 201
    _enroll(app, cup["tournament_id"], ["42"])
    store = app._get_store()
    store.put_score(
        {
            "farm_id": "42",
            "name": "x",
            "status": "completed",
            "digs_to_third_op": 9,
            "otter_count": 3,
            "total_digs": 9,
            "digs_today": 0,
            "invalidated": False,
        }
    )
    removed = app.lambda_handler(_event("DELETE", "/admin/farms/42", farm_id="42"), None)
    assert removed["statusCode"] == 200
    assert store.get_score("42") is None
    board = _json(app.lambda_handler(_event("GET", "/leaderboard"), None))
    assert [row["farm_id"] for row in board["entries"]] == []


def test_disabled_farm_hidden_from_board_but_score_kept(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    cup = _open_live_cup(app)
    app.lambda_handler(_event("POST", "/admin/farms", {"farm_id": "42", "name": "x"}), None)
    _enroll(app, cup["tournament_id"], ["42"])
    store = app._get_store()
    store.put_score(
        {
            "farm_id": "42",
            "name": "x",
            "status": "completed",
            "digs_to_third_op": 9,
            "otter_count": 3,
            "total_digs": 9,
            "digs_today": 0,
            "invalidated": False,
        }
    )
    updated = app.lambda_handler(
        _event("PUT", "/admin/farms/42", {"active": False}, farm_id="42"),
        None,
    )
    assert updated["statusCode"] == 200
    board = _json(app.lambda_handler(_event("GET", "/leaderboard"), None))
    assert [row["farm_id"] for row in board["entries"]] == []
    assert store.get_score("42") is not None


def test_admin_get_config_is_public_shape(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    response = app.lambda_handler(_event("GET", "/admin/config"), None)
    assert response["statusCode"] == 200
    config = _json(response)["config"]
    assert "pk" not in config
    assert "leader_farm_id" not in config
    assert {"prize_amount", "status"} <= set(config)
    assert config["status"] == "scheduled"
    assert not config.get("start_at")
    assert not config.get("end_at")


def test_admin_put_config_rescores_from_snapshot(aws_env, monkeypatch):
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
    apply_computed_score(
        store,
        farm_id="99",
        name="rmr",
        computed=computed,
        now=datetime(2026, 8, 16, tzinfo=timezone.utc),
        grid=grid,
    )
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


def test_admin_put_config_duration_days_sets_end_and_public_config(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    saved = app.lambda_handler(
        _event(
            "PUT",
            "/admin/config",
            {
                "start_at": "2026-08-01T00:00:00+00:00",
                "duration_days": 30,
                "prize_amount": "30",
            },
        ),
        None,
    )
    assert saved["statusCode"] == 200
    config = _json(saved)["config"]
    assert config["duration_days"] == 30
    assert config["start_at"].startswith("2026-08-01")
    assert config["end_at"].startswith("2026-08-31")
    public = _json(app.lambda_handler(_event("GET", "/config"), None))
    assert public["start_at"] == config["start_at"]
    assert public["end_at"] == config["end_at"]
    assert public["duration_days"] == 30
    board = _json(app.lambda_handler(_event("GET", "/leaderboard"), None))
    assert board["config"]["start_at"] == config["start_at"]
    assert board["config"]["end_at"] == config["end_at"]


def test_admin_put_config_rejects_short_duration(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    response = app.lambda_handler(
        _event(
            "PUT",
            "/admin/config",
            {"start_at": "2026-08-01T00:00:00+00:00", "duration_days": 0},
        ),
        None,
    )
    assert response["statusCode"] == 400


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


class FakeLambda:
    def __init__(self):
        self.calls: list[dict] = []

    def invoke(self, **kwargs):
        self.calls.append(kwargs)
        return {"StatusCode": 202}


def test_http_handler_does_not_import_sfl_client(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    assert not hasattr(app, "_get_client")
    assert "RateLimitedSFLClient" not in dir(app)
    source = (ROOT / "lambda_functions" / "main_function" / "app.py").read_text()
    assert "sync_one_farm" not in source
    assert "community/farms" not in source
    assert "RateLimitedSFLClient" not in source


def test_admin_refresh_accepts_and_does_not_call_sfl(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    app.FARM_SYNC_FUNCTION = "pj007-test-farm-sync"
    fake = FakeLambda()
    app._lambda = fake

    def boom(*_args, **_kwargs):
        raise AssertionError("HTTP must not construct an SFL client")

    monkeypatch.setattr("tournament.sfl_client.RateLimitedSFLClient", boom)

    added = app.lambda_handler(
        _event("POST", "/admin/farms", {"farm_id": "99", "name": "rmr"}),
        None,
    )
    assert added["statusCode"] == 201
    refreshed = app.lambda_handler(
        _event("POST", "/admin/farms/99/refresh", farm_id="99"),
        None,
    )
    assert refreshed["statusCode"] == 202
    body = _json(refreshed)
    assert body["accepted"] is True
    assert body["farm_id"] == "99"
    assert "score" not in body
    assert len(fake.calls) == 1
    assert fake.calls[0]["FunctionName"] == "pj007-test-farm-sync"
    assert fake.calls[0]["InvocationType"] == "Event"
    payload = json.loads(fake.calls[0]["Payload"])
    assert payload == {"source": "admin-refresh", "farm_id": "99"}


def test_admin_refresh_untracked_does_not_invoke(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    app.FARM_SYNC_FUNCTION = "pj007-test-farm-sync"
    fake = FakeLambda()
    app._lambda = fake
    response = app.lambda_handler(
        _event("POST", "/admin/farms/missing/refresh", farm_id="missing"),
        None,
    )
    assert response["statusCode"] == 404
    assert fake.calls == []


def test_admin_sync_accepts_without_farm_id(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    app.FARM_SYNC_FUNCTION = "pj007-test-farm-sync"
    fake = FakeLambda()
    app._lambda = fake
    response = app.lambda_handler(_event("POST", "/admin/sync"), None)
    assert response["statusCode"] == 202
    assert _json(response) == {"accepted": True}
    payload = json.loads(fake.calls[0]["Payload"])
    assert payload == {"source": "admin"}
    assert "farm_id" not in payload


def test_unknown_route(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    response = app.lambda_handler(_event("GET", "/nope"), None)
    assert response["statusCode"] == 404
