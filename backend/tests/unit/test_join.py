"""Drive the shipped public submit/join path."""

import importlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from tournament.membership import first_day_join_cutoff, is_joinable

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


def _create_joinable(app, *, name, start, end):
    created = app.lambda_handler(
        _event(
            "POST",
            "/admin/tournaments",
            {
                "name": name,
                "start_at": start,
                "end_at": end,
                "prize_amount": "30",
            },
        ),
        None,
    )
    assert created["statusCode"] == 201, created
    return _json(created)["tournament"]


def test_submit_without_tournament_id_is_invalid(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    missing = app.lambda_handler(
        _event("POST", "/submissions", {"farm_id": "3666918801844311", "name": "rmr"}),
        None,
    )
    assert missing["statusCode"] == 400
    body = _json(missing)
    assert body["error"] == "VALIDATION_ERROR"
    assert "tournament_id" in body["message"]


def test_submit_one_or_many_joinable_creates_pending(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Live cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
    )
    later = _create_joinable(
        app,
        name="September cup",
        start="2026-09-01T00:00:00+00:00",
        end="2026-09-08T00:00:00+00:00",
    )

    one = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "name": "rmr",
                "tournament_id": live["tournament_id"],
            },
        ),
        None,
    )
    assert one["statusCode"] == 201
    payload = _json(one)
    assert payload["count"] == 1
    assert payload["submissions"][0]["farm_id"] == "3666918801844311"
    assert payload["submissions"][0]["tournament_id"] == live["tournament_id"]
    assert payload["submissions"][0]["status"] == "pending"

    many = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "2791164672544774",
                "name": "bob",
                "tournament_ids": [live["tournament_id"], later["tournament_id"]],
            },
        ),
        None,
    )
    assert many["statusCode"] == 201
    many_body = _json(many)
    assert many_body["count"] == 2
    ids = {row["tournament_id"] for row in many_body["submissions"]}
    assert ids == {live["tournament_id"], later["tournament_id"]}


def test_tracked_farm_can_request_another_tournament(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Live cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
    )
    later = _create_joinable(
        app,
        name="September cup",
        start="2026-09-01T00:00:00+00:00",
        end="2026-09-08T00:00:00+00:00",
    )
    added = app.lambda_handler(
        _event("POST", "/admin/farms", {"farm_id": "3666918801844311", "name": "rmr"}),
        None,
    )
    assert added["statusCode"] == 201

    joined = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "name": "rmr",
                "tournament_ids": [later["tournament_id"]],
            },
        ),
        None,
    )
    assert joined["statusCode"] == 201
    assert _json(joined)["submissions"][0]["tournament_id"] == later["tournament_id"]

    also_live = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "tournament_id": live["tournament_id"],
            },
        ),
        None,
    )
    assert also_live["statusCode"] == 201


def test_duplicate_pending_or_enrolled_pair_is_409(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Live cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
    )
    first = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "3666918801844311", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert first["statusCode"] == 201
    pending_dup = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "3666918801844311", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert pending_dup["statusCode"] == 409
    assert _json(pending_dup)["error"] == "CONFLICT"

    approved = app.lambda_handler(
        _event(
            "POST",
            f"/admin/submissions/3666918801844311/{live['tournament_id']}/approve",
        ),
        None,
    )
    assert approved["statusCode"] == 200
    enrolled_dup = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "3666918801844311", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert enrolled_dup["statusCode"] == 409
    assert _json(enrolled_dup)["error"] == "CONFLICT"


def test_first_day_join_cutoff_is_2230_utc_on_start_date():
    row = {
        "status": "active",
        "start_at": "2026-08-17T00:00:00+00:00",
    }
    cutoff = first_day_join_cutoff(row)
    assert cutoff == datetime(2026, 8, 17, 22, 30, tzinfo=timezone.utc)
    assert is_joinable(row, now=datetime(2026, 8, 17, 22, 29, 59, tzinfo=timezone.utc)) is True
    assert is_joinable(row, now=datetime(2026, 8, 17, 22, 30, tzinfo=timezone.utc)) is False
    assert is_joinable(row, now=datetime(2026, 8, 18, 10, 0, tzinfo=timezone.utc)) is False
    scheduled = {
        "status": "scheduled",
        "start_at": "2026-08-24T00:00:00+00:00",
    }
    assert is_joinable(scheduled, now=datetime(2026, 8, 18, 23, 0, tzinfo=timezone.utc)) is True


def test_submit_rejects_active_event_at_first_day_2230(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Creators Digging Tournament",
        start="2026-08-17T00:00:00+00:00",
        end="2026-08-24T00:00:00+00:00",
    )
    later = _create_joinable(
        app,
        name="Test Tournament 3",
        start="2026-08-24T00:00:00+00:00",
        end="2026-08-31T00:00:00+00:00",
    )
    monkeypatch.setattr(
        "tournament.membership.utc_clock",
        lambda now=None: datetime(2026, 8, 17, 22, 29, tzinfo=timezone.utc),
    )
    before = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "1111111111111111",
                "name": "early",
                "tournament_id": live["tournament_id"],
            },
        ),
        None,
    )
    assert before["statusCode"] == 201

    monkeypatch.setattr(
        "tournament.membership.utc_clock",
        lambda now=None: datetime(2026, 8, 17, 22, 30, tzinfo=timezone.utc),
    )
    closed = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "2222222222222222", "name": "late", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert closed["statusCode"] == 400
    assert _json(closed)["error"] == "VALIDATION_ERROR"
    assert "22:30" in _json(closed)["message"]

    scheduled = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3333333333333333",
                "name": "soon",
                "tournament_id": later["tournament_id"],
            },
        ),
        None,
    )
    assert scheduled["statusCode"] == 201

    listed = app.lambda_handler(
        _event("GET", f"/admin/tournaments/{live['tournament_id']}/roster"),
        None,
    )
    members = _json(listed)["members"]
    assert any(row["farm_id"] == "1111111111111111" for row in members)


def test_already_enrolled_farm_stays_after_join_closes(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-17T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Creators Digging Tournament",
        start="2026-08-17T00:00:00+00:00",
        end="2026-08-24T00:00:00+00:00",
    )
    submitted = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "3666918801844311", "name": "rmr", "tournament_id": live["tournament_id"]},
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
    monkeypatch.setattr(
        "tournament.membership.utc_clock",
        lambda now=None: datetime(2026, 8, 17, 22, 30, tzinfo=timezone.utc),
    )
    roster = _json(
        app.lambda_handler(
            _event("GET", f"/admin/tournaments/{live['tournament_id']}/roster"),
            None,
        )
    )
    assert roster["members"][0]["farm_id"] == "3666918801844311"
    assert roster["members"][0]["status"] == "enrolled"


def test_public_tournament_hides_joins_after_first_day_2230(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Creators Digging Tournament",
        start="2026-08-17T00:00:00+00:00",
        end="2026-08-24T00:00:00+00:00",
    )
    from tournament.catalog import get_public_tournament

    store = app._get_store()
    open_payload = get_public_tournament(
        store, live["tournament_id"], now=datetime(2026, 8, 17, 16, 0, tzinfo=timezone.utc)
    )
    assert open_payload["accepts_joins"] is True
    closed_payload = get_public_tournament(
        store, live["tournament_id"], now=datetime(2026, 8, 17, 22, 30, tzinfo=timezone.utc)
    )
    assert closed_payload["accepts_joins"] is False
