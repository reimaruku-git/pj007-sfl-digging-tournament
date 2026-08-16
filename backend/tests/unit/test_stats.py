"""Drive shipped SFL streak extract and unique-day average-per-day."""

from datetime import datetime, timedelta, timezone

from tournament.scoring import extract_streak
from tournament.stats import (
    average_per_day,
    collapsed_player_stats,
    digging_streak,
    overall_average_per_day,
)
from tournament.store import Store
from tournament.window import official_score_average


def _ms(day: datetime) -> int:
    return int(day.timestamp() * 1000)


def _shovel(day: datetime, pebbles: int = 0) -> dict:
    items = {"Otter Pebble": pebbles} if pebbles else {}
    return {"dugAt": _ms(day), "items": items, "tool": "Sand Shovel"}


def _sfl_payload(count: int, grid: list | None = None) -> dict:
    return {
        "farm": {
            "desert": {
                "digging": {
                    "grid": grid or [],
                    "streak": {
                        "count": count,
                        "collectedAt": "2026-08-16T00:00:00.000Z",
                        "totalClaimed": count,
                    },
                }
            }
        }
    }


def test_streak_reads_sfl_count_from_payload_and_snapshot():
    payload = _sfl_payload(7)
    assert extract_streak(payload)["count"] == 7
    assert digging_streak(payload) == 7

    snapshot = {
        "farm_id": "99",
        "grid": [_shovel(datetime(2026, 8, 16, tzinfo=timezone.utc))],
        "streak": extract_streak(payload),
        "digging_streak": 7,
    }
    assert digging_streak(snapshot) == 7
    assert digging_streak({"streak": {"count": 4, "collectedAt": None}}) == 4
    assert digging_streak(12) == 12


def test_streak_missing_is_zero_even_when_grid_has_consecutive_days():
    today = datetime(2026, 8, 16, 15, tzinfo=timezone.utc)
    grid = [
        _shovel(today - timedelta(days=2)),
        _shovel(today - timedelta(days=1)),
        _shovel(today),
    ]
    assert digging_streak(grid) == 0
    assert digging_streak({}) == 0
    assert digging_streak(None) == 0
    assert extract_streak({"farm": {"desert": {"digging": {"grid": grid}}}})["count"] == 0
    assert digging_streak(_sfl_payload(0, grid=grid)) == 0
    assert digging_streak({"grid": grid, "streak": {"count": 0}}) == 0


def test_average_overlapping_shared_record_counts_once():
    start_a = datetime(2026, 8, 1, tzinfo=timezone.utc)
    end_a = datetime(2026, 8, 8, tzinfo=timezone.utc)
    start_b = datetime(2026, 8, 1, tzinfo=timezone.utc)
    end_b = datetime(2026, 8, 15, tzinfo=timezone.utc)
    record = {
        "digs_to_third_op": 42,
        "third_op_at": "2026-08-03T12:00:00+00:00",
        "otter_count": 3,
    }
    single = average_per_day(records=[record], windows=[(start_a, end_a)])
    assert single == 6.0
    overlapping = average_per_day(
        records=[record, dict(record)],
        windows=[(start_a, end_a), (start_b, end_b)],
    )
    # Unique days = 14; unique record = 42. Not the mean of 6.0 and 3.0.
    assert overlapping == 3.0
    assert overlapping == average_per_day(records=[record], windows=[(start_b, end_b)])


def test_average_nonoverlapping_unions_days():
    week_a = (
        datetime(2026, 7, 1, tzinfo=timezone.utc),
        datetime(2026, 7, 8, tzinfo=timezone.utc),
    )
    week_b = (
        datetime(2026, 8, 1, tzinfo=timezone.utc),
        datetime(2026, 8, 15, tzinfo=timezone.utc),
    )
    records = [
        {"digs_to_third_op": 42, "third_op_at": "2026-07-03T00:00:00+00:00"},
        {"digs_to_third_op": 14, "third_op_at": "2026-08-04T00:00:00+00:00"},
    ]
    assert average_per_day(records=records[:1], windows=[week_a]) == 6.0
    # 42 + 14 over 7 + 14 unique days, not the mean of 6.0 and 1.0.
    assert average_per_day(records=records, windows=[week_a, week_b]) == round(56 / 21, 2)
    assert average_per_day(records=[], windows=[week_a]) is None


def test_collapsed_stats_compose_sfl_streak_and_unique_day_average():
    start = datetime(2026, 8, 1, tzinfo=timezone.utc)
    end = datetime(2026, 8, 8, tzinfo=timezone.utc)
    stats = collapsed_player_stats(
        streak_source=_sfl_payload(5),
        records=[{"digs_to_third_op": 21, "third_op_at": "2026-08-04T00:00:00+00:00"}],
        windows=[(start, end)],
    )
    assert stats["digging_streak"] == 5
    assert stats["average_per_day"] == 3.0


def test_overall_average_is_mean_of_board_scores():
    assert overall_average_per_day([{"score": 6.0}, {"score": 4.0}]) == 5.0
    assert overall_average_per_day([{"score": None}, {}]) is None


def test_admin_player_list_uses_sfl_streak_and_unique_day_average(aws_env, monkeypatch):
    import importlib
    import json
    import sys
    from pathlib import Path

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
    app._store = None
    app._registry = None

    today = datetime.now(timezone.utc)
    yesterday = today - timedelta(days=1)
    store = app._get_store()
    app.lambda_handler(
        {
            "rawPath": "/admin/farms",
            "requestContext": {"http": {"method": "POST"}, "stage": "dev"},
            "headers": {},
            "body": json.dumps({"farm_id": "99", "name": "rmr"}),
            "pathParameters": {},
        },
        None,
    )
    store.write_snapshot(
        "99",
        {
            "farm_id": "99",
            "grid": [_shovel(yesterday), _shovel(today)],
            "streak": {"count": 11, "collectedAt": None, "totalClaimed": 11},
            "digging_streak": 11,
        },
    )
    store.put_tournament(
        {
            "tournament_id": "past-7d",
            "name": "Past cup",
            "start_at": "2026-07-01T00:00:00+00:00",
            "end_at": "2026-07-08T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
            "status": "ended",
            "roster_seeded": True,
        }
    )
    store.write_archive(
        "past-7d",
        {
            "tournament_id": "past-7d",
            "config": {"duration_days": 7},
            "entries": [
                {
                    "farm_id": "99",
                    "score": official_score_average(14, 7),
                    "digs_to_third_op": 14,
                    "third_op_at": "2026-07-04T00:00:00+00:00",
                }
            ],
            "count": 1,
        },
    )
    listed = app.lambda_handler(
        {
            "rawPath": "/admin/farms",
            "requestContext": {"http": {"method": "GET"}, "stage": "dev"},
            "headers": {},
            "body": None,
            "pathParameters": {},
        },
        None,
    )
    assert listed["statusCode"] == 200
    farm = json.loads(listed["body"])["farms"][0]
    assert farm["farm_id"] == "99"
    assert farm["digging_streak"] == 11
    assert farm["average_per_day"] == 2.0

    opened = app.lambda_handler(
        {
            "rawPath": "/admin/farms/99",
            "requestContext": {"http": {"method": "GET"}, "stage": "dev"},
            "headers": {},
            "body": None,
            "pathParameters": {},
        },
        None,
    )
    assert opened["statusCode"] == 200
    detail = json.loads(opened["body"])["farm"]
    assert detail["history"][0]["tournament_id"] == "past-7d"
    assert detail["digging_streak"] == 11
    assert detail["average_per_day"] == 2.0


def test_public_tournament_exposes_overall_average_and_scheduled_roster(aws_env, monkeypatch):
    import importlib
    import json
    import sys
    from pathlib import Path

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
    app._store = None
    app._registry = None

    created = app.lambda_handler(
        {
            "rawPath": "/admin/tournaments",
            "requestContext": {"http": {"method": "POST"}, "stage": "dev"},
            "headers": {},
            "body": json.dumps(
                {
                    "name": "September cup",
                    "start_at": "2026-09-01T00:00:00+00:00",
                    "duration_days": 7,
                    "prize_amount": "45",
                }
            ),
            "pathParameters": {},
        },
        None,
    )
    assert created["statusCode"] == 201
    tid = json.loads(created["body"])["tournament"]["tournament_id"]
    app.lambda_handler(
        {
            "rawPath": "/admin/farms",
            "requestContext": {"http": {"method": "POST"}, "stage": "dev"},
            "headers": {},
            "body": json.dumps({"farm_id": "42", "name": "Ada"}),
            "pathParameters": {},
        },
        None,
    )
    app.lambda_handler(
        {
            "rawPath": f"/admin/tournaments/{tid}/farms",
            "requestContext": {"http": {"method": "POST"}, "stage": "dev"},
            "headers": {},
            "body": json.dumps({"farm_ids": ["42"]}),
            "pathParameters": {},
        },
        None,
    )
    detail = app.lambda_handler(
        {
            "rawPath": f"/tournaments/{tid}",
            "requestContext": {"http": {"method": "GET"}, "stage": "dev"},
            "headers": {},
            "body": None,
            "pathParameters": {},
        },
        None,
    )
    assert detail["statusCode"] == 200
    payload = json.loads(detail["body"])["tournament"]
    assert payload["config"]["prize_amount"] == "45"
    assert payload["config"]["start_at"].startswith("2026-09-01")
    assert payload["config"]["end_at"].startswith("2026-09-08")
    assert [row["farm_id"] for row in payload["entries"]] == ["42"]
    assert payload["count"] == 1
    assert payload["overall_average_per_day"] is None


def test_player_list_row_overlapping_enrollments_share_one_record(aws_env):
    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    store.put_tournament(
        {
            "tournament_id": "week-a",
            "name": "Week A",
            "start_at": "2026-08-01T00:00:00+00:00",
            "end_at": "2026-08-08T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
            "status": "ended",
            "roster_seeded": True,
        }
    )
    store.put_tournament(
        {
            "tournament_id": "week-b",
            "name": "Week B",
            "start_at": "2026-08-01T00:00:00+00:00",
            "end_at": "2026-08-15T00:00:00+00:00",
            "duration_days": 14,
            "prize_amount": "30",
            "status": "ended",
            "roster_seeded": True,
        }
    )
    shared = {
        "farm_id": "99",
        "score": 6.0,
        "digs_to_third_op": 42,
        "third_op_at": "2026-08-03T12:00:00+00:00",
        "otter_count": 3,
        "status": "completed",
    }
    store.write_archive("week-a", {"entries": [shared], "count": 1})
    store.write_archive("week-b", {"entries": [{**shared, "score": 3.0}], "count": 1})
    from tournament.stats import player_list_row

    row = player_list_row(store, {"farm_id": "99", "name": "rmr", "active": True})
    assert row["average_per_day"] == 3.0


def test_ended_archive_feeds_unique_day_average_via_store(aws_env):
    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    store.put_tournament(
        {
            "tournament_id": "past-7d",
            "name": "Past cup",
            "start_at": "2026-07-01T00:00:00+00:00",
            "end_at": "2026-07-08T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
            "status": "ended",
            "roster_seeded": True,
        }
    )
    store.write_archive(
        "past-7d",
        {
            "tournament_id": "past-7d",
            "config": {"duration_days": 7, "status": "ended"},
            "entries": [
                {
                    "farm_id": "99",
                    "score": official_score_average(14, 7),
                    "digs_to_third_op": 14,
                    "third_op_at": "2026-07-04T12:00:00+00:00",
                    "rank": 1,
                    "status": "completed",
                    "otter_count": 3,
                }
            ],
            "count": 1,
        },
    )
    from tournament.stats import farm_history, player_list_row

    history = farm_history(store, "99")
    assert history[0]["tournament_id"] == "past-7d"
    row = player_list_row(store, {"farm_id": "99", "name": "rmr", "active": True})
    assert row["average_per_day"] == 2.0
    assert row["digging_streak"] == 0
