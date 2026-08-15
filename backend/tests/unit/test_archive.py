"""Ended tournaments are frozen in S3 and stay readable after a new window."""

from tournament.sync import apply_computed_score, refresh_leaderboard
from tournament.scoring import score_grid


def test_ended_window_is_archived_and_survives_new_event(aws_env, monkeypatch):
    import importlib
    import json
    import sys
    from datetime import datetime, timezone
    from pathlib import Path

    ROOT = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(ROOT / "lambda_functions" / "main_function"))
    monkeypatch.setenv("DATA_BUCKET", aws_env["bucket"])
    monkeypatch.setenv("CONFIG_TABLE", aws_env["config_table"])
    monkeypatch.setenv("SCORES_TABLE", aws_env["scores_table"])
    monkeypatch.setenv("SUBMISSIONS_TABLE", aws_env["submissions_table"])
    monkeypatch.setenv("ALLOWED_ORIGIN", "*")
    monkeypatch.setenv("FARM_SYNC_FUNCTION", "")
    if "app" in sys.modules:
        del sys.modules["app"]
    app = importlib.import_module("app")
    app.DATA_BUCKET = aws_env["bucket"]
    app.CONFIG_TABLE = aws_env["config_table"]
    app.SCORES_TABLE = aws_env["scores_table"]
    app.SUBMISSIONS_TABLE = aws_env["submissions_table"]
    app.FARM_SYNC_FUNCTION = ""
    app._store = None
    app._registry = None

    store = app._get_store()
    store.put_config(
        {
            "start_at": "2026-07-01T00:00:00+00:00",
            "end_at": "2026-07-08T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
            "status": "ended",
        }
    )
    now = datetime(2026, 7, 10, tzinfo=timezone.utc)
    computed = score_grid(
        [{"dugAt": int(datetime(2026, 7, 2, tzinfo=timezone.utc).timestamp() * 1000), "items": {"Otter Pebble": 3}, "tool": "Sand Shovel"}],
        now=now,
    )
    apply_computed_score(store, farm_id="99", name="rmr", computed=computed)
    refresh_leaderboard(store, now=now)

    listed = app.lambda_handler(
        {
            "rawPath": "/tournaments",
            "requestContext": {"http": {"method": "GET"}, "stage": "dev"},
            "headers": {},
            "body": None,
            "pathParameters": {},
        },
        None,
    )
    assert listed["statusCode"] == 200
    payload = json.loads(listed["body"])
    assert payload["count"] == 1
    tournament_id = payload["tournaments"][0]["tournament_id"]
    assert tournament_id
    assert payload["tournaments"][0]["count"] == 1

    detail = app.lambda_handler(
        {
            "rawPath": f"/tournaments/{tournament_id}",
            "requestContext": {"http": {"method": "GET"}, "stage": "dev"},
            "headers": {},
            "body": None,
            "pathParameters": {"tournament_id": tournament_id},
        },
        None,
    )
    assert detail["statusCode"] == 200
    frozen = json.loads(detail["body"])["tournament"]
    assert frozen["entries"][0]["farm_id"] == "99"
    assert frozen["config"]["start_at"].startswith("2026-07-01")

    new_window = app.lambda_handler(
        {
            "rawPath": "/admin/config",
            "requestContext": {"http": {"method": "PUT"}, "stage": "dev"},
            "headers": {},
            "body": json.dumps(
                {
                    "start_at": "2026-08-01T00:00:00+00:00",
                    "duration_days": 7,
                    "prize_amount": "30",
                }
            ),
            "pathParameters": {},
        },
        None,
    )
    assert new_window["statusCode"] == 200
    still = app.lambda_handler(
        {
            "rawPath": f"/tournaments/{tournament_id}",
            "requestContext": {"http": {"method": "GET"}, "stage": "dev"},
            "headers": {},
            "body": None,
            "pathParameters": {"tournament_id": tournament_id},
        },
        None,
    )
    assert still["statusCode"] == 200
    again = json.loads(still["body"])["tournament"]
    assert again["entries"][0]["farm_id"] == "99"
    live = json.loads(app.lambda_handler(
        {
            "rawPath": "/leaderboard",
            "requestContext": {"http": {"method": "GET"}, "stage": "dev"},
            "headers": {},
            "body": None,
            "pathParameters": {},
        },
        None,
    )["body"])
    assert live["config"]["start_at"].startswith("2026-08-01")
