"""Drive shipped streak and average-per-day functions on real grids/archives."""

from datetime import datetime, timedelta, timezone

from tournament.stats import average_per_day, collapsed_player_stats, digging_streak
from tournament.store import Store
from tournament.window import official_score_average


def _ms(day: datetime) -> int:
    return int(day.timestamp() * 1000)


def _shovel(day: datetime, pebbles: int = 0) -> dict:
    items = {"Otter Pebble": pebbles} if pebbles else {}
    return {"dugAt": _ms(day), "items": items, "tool": "Sand Shovel"}


def test_streak_counts_consecutive_utc_days_backward():
    today = datetime(2026, 8, 16, 15, tzinfo=timezone.utc)
    yesterday = today - timedelta(days=1)
    two_ago = today - timedelta(days=2)
    four_ago = today - timedelta(days=4)

    grid = [
        _shovel(four_ago),
        _shovel(two_ago),
        _shovel(yesterday),
        _shovel(today),
    ]
    # today + yesterday + two_ago = 3; four_ago is a gap
    assert digging_streak(grid, now=today) == 3

    no_today = [_shovel(two_ago), _shovel(yesterday), _shovel(four_ago)]
    assert digging_streak(no_today, now=today) == 2

    gap_today = [_shovel(four_ago), _shovel(today)]
    assert digging_streak(gap_today, now=today) == 1

    empty = digging_streak([], now=today)
    assert empty == 0


def test_streak_uses_flattened_grid_not_raw_tile_count():
    today = datetime(2026, 8, 16, 12, tzinfo=timezone.utc)
    drill = {
        "dugAt": _ms(today),
        "items": {"Otter Pebble": 1},
        "tool": "Sand Drill",
    }
    # four sibling holes stamped once still one UTC day
    grid = [drill, {**drill, "items": {}}, {**drill, "items": {}}, {**drill, "items": {}}]
    assert digging_streak(grid, now=today) == 1


def test_average_per_day_live_score_or_ended_mean():
    live = official_score_average(42, 7)
    assert live == 6.0
    assert (
        average_per_day(
            live_enrolled=True,
            live_official_score=live,
            ended_official_scores=[1.0, 9.0],
        )
        == 6.0
    )
    assert (
        average_per_day(
            live_enrolled=True,
            live_official_score=None,
            ended_official_scores=[1.0, 9.0],
        )
        is None
    )
    assert (
        average_per_day(
            live_enrolled=False,
            live_official_score=None,
            ended_official_scores=[6.0, 4.0],
        )
        == 5.0
    )
    assert (
        average_per_day(
            live_enrolled=False,
            live_official_score=None,
            ended_official_scores=[],
        )
        is None
    )


def test_collapsed_stats_compose_real_streak_and_average():
    today = datetime(2026, 8, 16, tzinfo=timezone.utc)
    yesterday = today - timedelta(days=1)
    grid = [_shovel(yesterday), _shovel(today)]
    stats = collapsed_player_stats(
        grid=grid,
        now=today,
        live_enrolled=True,
        live_official_score=official_score_average(21, 7),
        ended_official_scores=[9.0],
    )
    assert stats["digging_streak"] == 2
    assert stats["average_per_day"] == 3.0


def test_admin_player_list_exposes_streak_and_average(aws_env, monkeypatch):
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
            "entries": [{"farm_id": "99", "score": 2.0, "digs_to_third_op": 14}],
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
    # Clock is "now" in the handler; streak still comes from the snapshot grid.
    assert farm["digging_streak"] == 2
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
    assert detail["average_per_day"] == 2.0


def test_ended_archive_feeds_average_via_store(aws_env):
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
                    "rank": 1,
                    "status": "completed",
                    "otter_count": 3,
                }
            ],
            "count": 1,
        },
    )
    from tournament.stats import ended_official_scores_for_farm, farm_history

    history = farm_history(store, "99")
    assert history[0]["tournament_id"] == "past-7d"
    ended = ended_official_scores_for_farm(store, "99")
    assert ended == [2.0]
    assert (
        average_per_day(live_enrolled=False, live_official_score=None, ended_official_scores=ended)
        == 2.0
    )
