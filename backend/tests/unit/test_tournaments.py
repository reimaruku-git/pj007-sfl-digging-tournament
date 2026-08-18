"""Named tournament catalog: queue, overlap, and rollover."""

import importlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from tournament.catalog import (
    CatalogError,
    create_tournament,
    delete_tournament,
    list_public_tournaments,
    rollover,
    seed_catalog,
    update_tournament,
)
from tournament.store import Store
from tournament.sync import apply_computed_score, refresh_leaderboard
from tournament.scoring import score_grid


def _store(aws_env) -> Store:
    return Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )


def test_create_scheduled_and_reject_overlap(aws_env):
    store = _store(aws_env)
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    created = create_tournament(
        store,
        {
            "name": "September cup",
            "start_at": "2026-09-01T14:00:00+00:00",
            "end_at": "2026-09-08T14:00:00+00:00",
            "prize_amount": "45",
        },
        now=clock,
    )
    assert created["status"] == "scheduled"
    assert created["name"] == "September cup"
    assert created["prize_amount"] == "45"
    try:
        create_tournament(
            store,
            {
                "name": "clash",
                "start_at": "2026-09-04T00:00:00+00:00",
                "duration_days": 7,
                "prize_amount": "30",
            },
            now=clock,
        )
    except CatalogError as exc:
        assert exc.status == 409
    else:
        raise AssertionError("expected overlap conflict")


def test_one_day_tournament_is_allowed(aws_env):
    store = _store(aws_env)
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    created = create_tournament(
        store,
        {
            "name": "Sprint",
            "start_at": "2026-08-20T00:00:00+00:00",
            "duration_days": 1,
            "prize_amount": "10",
        },
        now=clock,
    )
    assert created["status"] == "scheduled"
    assert created["duration_days"] == 1
    assert created["end_at"].startswith("2026-08-21")


def test_empty_store_has_no_default_live(aws_env):
    store = _store(aws_env)
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    seed_catalog(store, now=clock)
    assert store.list_tournament_ids() == []
    assert list_public_tournaments(store, now=clock) == []
    assert not store.get_config().get("current_tournament_id")
    assert not store.get_config().get("start_at")


def test_can_edit_active_duration(aws_env):
    store = _store(aws_env)
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    live = create_tournament(
        store,
        {
            "name": "Now cup",
            "start_at": "2026-08-10T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        },
        now=clock,
    )
    assert live["status"] == "active"
    updated = update_tournament(
        store,
        live["tournament_id"],
        {
            "name": "Now cup long",
            "start_at": "2026-08-10T00:00:00+00:00",
            "duration_days": 14,
            "prize_amount": "45",
        },
        now=clock,
    )
    assert updated["status"] == "active"
    assert updated["name"] == "Now cup long"
    assert updated["duration_days"] == 14
    assert updated["prize_amount"] == "45"
    assert updated["end_at"].startswith("2026-08-24")
    assert store.get_config()["current_tournament_id"] == updated["tournament_id"]
    assert store.get_config()["duration_days"] == 14


def test_can_delete_active_and_scheduled(aws_env):
    store = _store(aws_env)
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    live = create_tournament(
        store,
        {
            "name": "Now cup",
            "start_at": "2026-08-10T00:00:00+00:00",
            "end_at": "2026-08-20T00:00:00+00:00",
            "prize_amount": "30",
        },
        now=clock,
    )
    assert live["status"] == "active"
    delete_tournament(store, live["tournament_id"], now=clock)
    assert store.get_tournament(live["tournament_id"]) is None
    assert not store.get_config().get("current_tournament_id")
    assert not store.get_config().get("start_at")

    upcoming = create_tournament(
        store,
        {
            "name": "Later",
            "start_at": "2026-09-01T00:00:00+00:00",
            "end_at": "2026-09-08T00:00:00+00:00",
            "prize_amount": "30",
        },
        now=clock,
    )
    assert upcoming["status"] == "scheduled"
    delete_tournament(store, upcoming["tournament_id"], now=clock)
    assert store.get_tournament(upcoming["tournament_id"]) is None


def test_rollover_archives_then_promotes_next(aws_env):
    store = _store(aws_env)
    start_live = datetime(2026, 8, 1, tzinfo=timezone.utc)
    store.put_config(
        {
            "start_at": "2026-08-01T00:00:00+00:00",
            "end_at": "2026-08-08T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
            "name": "August one",
            "status": "active",
        }
    )
    computed = score_grid(
        [
            {
                "dugAt": int(datetime(2026, 8, 2, tzinfo=timezone.utc).timestamp() * 1000),
                "items": {"Otter Pebble": 3},
                "tool": "Sand Shovel",
            }
        ],
        now=start_live,
        window_start=start_live,
        window_end=datetime(2026, 8, 8, tzinfo=timezone.utc),
    )
    apply_computed_score(store, farm_id="99", name="rmr", computed=computed, now=start_live)
    store.write_snapshot("99", {"grid": [{"items": {"Otter Pebble": 3}, "tool": "Sand Shovel"}]})
    refresh_leaderboard(store)

    later = datetime(2026, 8, 10, 15, tzinfo=timezone.utc)
    nxt = create_tournament(
        store,
        {
            "name": "August two",
            "start_at": "2026-08-08T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        },
        now=datetime(2026, 8, 7, tzinfo=timezone.utc),
    )
    assert nxt["status"] == "scheduled"

    result = rollover(store, now=later)
    assert result["archived"] is True
    assert result["promoted"] == nxt["tournament_id"]

    old_id = store.list_tournament_ids()
    ended = [store.get_tournament(tid) for tid in old_id]
    archived = next(row for row in ended if row and row["name"] == "August one")
    assert archived["status"] == "ended"
    freeze = store.read_archive(archived["tournament_id"])
    assert freeze is not None
    assert freeze["entries"][0]["farm_id"] == "99"
    assert store.read_archive_farm(archived["tournament_id"], "99") is not None
    live = store.get_config()
    assert live["current_tournament_id"] == nxt["tournament_id"]
    assert live["name"] == "August two"


def test_admin_http_create_and_cancel(aws_env, monkeypatch):
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "lambda_functions" / "main_function"))
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

    created = app.lambda_handler(
        {
            "rawPath": "/admin/tournaments",
            "requestContext": {"http": {"method": "POST"}, "stage": "dev"},
            "headers": {},
            "body": json.dumps(
                {
                    "name": "Autumn",
                    "start_at": "2026-10-01T00:00:00+00:00",
                    "end_at": "2026-10-08T00:00:00+00:00",
                    "prize_amount": "30",
                }
            ),
            "pathParameters": {},
        },
        None,
    )
    assert created["statusCode"] == 201
    payload = json.loads(created["body"])["tournament"]
    tid = payload["tournament_id"]
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
    names = [row["name"] for row in json.loads(listed["body"])["tournaments"]]
    assert "Autumn" in names
    deleted = app.lambda_handler(
        {
            "rawPath": f"/admin/tournaments/{tid}",
            "requestContext": {"http": {"method": "DELETE"}, "stage": "dev"},
            "headers": {},
            "body": None,
            "pathParameters": {"tournament_id": tid},
        },
        None,
    )
    assert deleted["statusCode"] == 200

    live = app.lambda_handler(
        {
            "rawPath": "/admin/tournaments",
            "requestContext": {"http": {"method": "POST"}, "stage": "dev"},
            "headers": {},
            "body": json.dumps(
                {
                    "name": "Live now",
                    "start_at": "2026-08-10T00:00:00+00:00",
                    "end_at": "2026-08-20T00:00:00+00:00",
                    "prize_amount": "30",
                }
            ),
            "pathParameters": {},
        },
        None,
    )
    assert live["statusCode"] == 201
    live_id = json.loads(live["body"])["tournament"]["tournament_id"]
    assert json.loads(live["body"])["tournament"]["status"] == "active"
    edited = app.lambda_handler(
        {
            "rawPath": f"/admin/tournaments/{live_id}",
            "requestContext": {"http": {"method": "PUT"}, "stage": "dev"},
            "headers": {},
            "body": json.dumps(
                {
                    "name": "Live now",
                    "start_at": "2026-08-10T00:00:00+00:00",
                    "duration_days": 14,
                    "prize_amount": "30",
                }
            ),
            "pathParameters": {"tournament_id": live_id},
        },
        None,
    )
    assert edited["statusCode"] == 200
    assert json.loads(edited["body"])["tournament"]["duration_days"] == 14
    live_id = json.loads(edited["body"])["tournament"]["tournament_id"]
    cancelled = app.lambda_handler(
        {
            "rawPath": f"/admin/tournaments/{live_id}",
            "requestContext": {"http": {"method": "DELETE"}, "stage": "dev"},
            "headers": {},
            "body": None,
            "pathParameters": {"tournament_id": live_id},
        },
        None,
    )
    assert cancelled["statusCode"] == 200
    public = app.lambda_handler(
        {
            "rawPath": "/tournaments",
            "requestContext": {"http": {"method": "GET"}, "stage": "dev"},
            "headers": {},
            "body": None,
            "pathParameters": {},
        },
        None,
    )
    assert json.loads(public["body"])["tournaments"] == []
    assert json.loads(public["body"])["count"] == 0

    public_create = app.lambda_handler(
        {
            "rawPath": "/tournaments",
            "requestContext": {"http": {"method": "POST"}, "stage": "dev"},
            "headers": {},
            "body": json.dumps(
                {"name": "nope", "start_at": "2026-10-01T00:00:00+00:00", "duration_days": 7}
            ),
            "pathParameters": {},
        },
        None,
    )
    assert public_create["statusCode"] == 404
