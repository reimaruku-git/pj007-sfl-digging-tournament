"""Drive shipped admin approve/reject and tournament add/remove paths."""

import importlib
import json
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
    module.FARM_SYNC_FUNCTION = ""
    module._store = None
    module._registry = None
    module._lambda = None
    return module


def _event(method: str, path: str, body=None):
    return {
        "rawPath": path,
        "requestContext": {"http": {"method": method}, "stage": "dev"},
        "headers": {"origin": "http://localhost:5173"},
        "body": json.dumps(body) if body is not None else None,
        "pathParameters": {},
    }


def _json(response):
    return json.loads(response["body"])


def _create(app, name, start, end):
    created = app.lambda_handler(
        _event(
            "POST",
            "/admin/tournaments",
            {"name": name, "start_at": start, "end_at": end, "prize_amount": "30"},
        ),
        None,
    )
    assert created["statusCode"] == 201, created
    return _json(created)["tournament"]


def test_approve_enrolls_only_named_tournament(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    live = _create(app, "Live cup", "2026-08-10T00:00:00+00:00", "2026-08-20T00:00:00+00:00")
    later = _create(app, "September cup", "2026-09-01T00:00:00+00:00", "2026-09-08T00:00:00+00:00")
    submitted = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "name": "rmr",
                "tournament_ids": [live["tournament_id"], later["tournament_id"]],
            },
        ),
        None,
    )
    assert submitted["statusCode"] == 201

    approved = app.lambda_handler(
        _event(
            "POST",
            f"/admin/submissions/3666918801844311/{live['tournament_id']}/approve",
        ),
        None,
    )
    assert approved["statusCode"] == 200
    assert _json(approved)["farm"]["farm_id"] == "3666918801844311"

    roster_live = _json(
        app.lambda_handler(
            _event("GET", f"/admin/tournaments/{live['tournament_id']}/roster"), None
        )
    )
    roster_later = _json(
        app.lambda_handler(
            _event("GET", f"/admin/tournaments/{later['tournament_id']}/roster"), None
        )
    )
    live_status = {row["farm_id"]: row["status"] for row in roster_live["members"]}
    later_status = {row["farm_id"]: row["status"] for row in roster_later["members"]}
    assert live_status["3666918801844311"] == "enrolled"
    assert later_status["3666918801844311"] == "pending"

    pending = _json(app.lambda_handler(_event("GET", "/admin/submissions"), None))
    assert pending["count"] == 1
    assert pending["submissions"][0]["tournament_id"] == later["tournament_id"]


def test_reject_leaves_other_pending_and_enrolled_rows(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    live = _create(app, "Live cup", "2026-08-10T00:00:00+00:00", "2026-08-20T00:00:00+00:00")
    later = _create(app, "September cup", "2026-09-01T00:00:00+00:00", "2026-09-08T00:00:00+00:00")
    app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "tournament_ids": [live["tournament_id"], later["tournament_id"]],
            },
        ),
        None,
    )
    app.lambda_handler(
        _event(
            "POST",
            f"/admin/submissions/3666918801844311/{live['tournament_id']}/approve",
        ),
        None,
    )
    rejected = app.lambda_handler(
        _event("DELETE", f"/admin/submissions/3666918801844311/{later['tournament_id']}"),
        None,
    )
    assert rejected["statusCode"] == 200
    assert _json(rejected) == {"ok": True}

    live_roster = _json(
        app.lambda_handler(
            _event("GET", f"/admin/tournaments/{live['tournament_id']}/roster"), None
        )
    )
    later_roster = _json(
        app.lambda_handler(
            _event("GET", f"/admin/tournaments/{later['tournament_id']}/roster"), None
        )
    )
    assert live_roster["members"][0]["status"] == "enrolled"
    assert later_roster["count"] == 0
    pending = _json(app.lambda_handler(_event("GET", "/admin/submissions"), None))
    assert pending["count"] == 0


def test_multi_add_and_remove_from_one_tournament_only(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    live = _create(app, "Live cup", "2026-08-10T00:00:00+00:00", "2026-08-20T00:00:00+00:00")
    later = _create(app, "September cup", "2026-09-01T00:00:00+00:00", "2026-09-08T00:00:00+00:00")
    for farm_id, name in (("111111", "alpha"), ("222222", "bravo"), ("333333", "charlie")):
        added = app.lambda_handler(
            _event("POST", "/admin/farms", {"farm_id": farm_id, "name": name}),
            None,
        )
        assert added["statusCode"] == 201

    enrolled_later = app.lambda_handler(
        _event(
            "POST",
            f"/admin/tournaments/{later['tournament_id']}/farms",
            {"farm_ids": ["111111", "222222"]},
        ),
        None,
    )
    assert enrolled_later["statusCode"] == 200
    assert _json(enrolled_later)["count"] == 2

    enrolled_live = app.lambda_handler(
        _event(
            "POST",
            f"/admin/tournaments/{live['tournament_id']}/farms",
            {"farm_ids": ["111111", "222222", "333333"]},
        ),
        None,
    )
    assert enrolled_live["statusCode"] == 200
    assert _json(enrolled_live)["count"] == 3

    removed = app.lambda_handler(
        _event("DELETE", f"/admin/tournaments/{live['tournament_id']}/farms/222222"),
        None,
    )
    assert removed["statusCode"] == 200

    live_roster = _json(
        app.lambda_handler(
            _event("GET", f"/admin/tournaments/{live['tournament_id']}/roster"), None
        )
    )
    later_roster = _json(
        app.lambda_handler(
            _event("GET", f"/admin/tournaments/{later['tournament_id']}/roster"), None
        )
    )
    live_ids = {row["farm_id"] for row in live_roster["members"] if row["status"] == "enrolled"}
    later_ids = {row["farm_id"] for row in later_roster["members"] if row["status"] == "enrolled"}
    assert live_ids == {"111111", "333333"}
    assert later_ids == {"111111", "222222"}

    farms = _json(app.lambda_handler(_event("GET", "/admin/farms"), None))
    assert {row["farm_id"] for row in farms["farms"]} == {"111111", "222222", "333333"}


def test_public_board_lists_only_enrolled_active_farms(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    live = _create(app, "Live cup", "2026-08-10T00:00:00+00:00", "2026-08-20T00:00:00+00:00")
    later = _create(app, "September cup", "2026-09-01T00:00:00+00:00", "2026-09-08T00:00:00+00:00")
    app.lambda_handler(_event("POST", "/admin/farms", {"farm_id": "111111", "name": "in"}), None)
    app.lambda_handler(_event("POST", "/admin/farms", {"farm_id": "222222", "name": "out"}), None)
    app.lambda_handler(_event("POST", "/admin/farms", {"farm_id": "333333", "name": "off"}), None)
    app.lambda_handler(
        _event(
            "POST",
            f"/admin/tournaments/{live['tournament_id']}/farms",
            {"farm_ids": ["111111", "333333"]},
        ),
        None,
    )
    app.lambda_handler(
        _event(
            "POST", f"/admin/tournaments/{later['tournament_id']}/farms", {"farm_ids": ["222222"]}
        ),
        None,
    )
    app.lambda_handler(_event("PUT", "/admin/farms/333333", {"active": False}), None)

    board = _json(app.lambda_handler(_event("GET", "/leaderboard"), None))
    assert [row["farm_id"] for row in board["entries"]] == ["111111"]

    scheduled = _json(
        app.lambda_handler(_event("GET", f"/tournaments/{later['tournament_id']}"), None)
    )
    ids = [row["farm_id"] for row in scheduled["tournament"]["entries"]]
    assert ids == ["222222"]
    assert "111111" not in ids
    assert "333333" not in ids
