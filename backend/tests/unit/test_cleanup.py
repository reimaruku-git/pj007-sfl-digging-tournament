"""Archived-event live-cache purge: keep/delete matrix."""

from datetime import datetime, timezone

from tournament.catalog import create_tournament, freeze_tournament
from tournament.cleanup import purge_archived_event_live_cache
from tournament.farms import FarmRegistry
from tournament.membership import add_farms_to_tournament
from tournament.store import Store


def _store(aws_env) -> Store:
    return Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )


def _score(farm_id: str, name: str = "rmr") -> dict:
    return {
        "farm_id": farm_id,
        "name": name,
        "digs_to_third_op": 14,
        "score": 14.0,
        "status": "completed",
    }


def test_freeze_drops_ended_live_cache_and_keeps_catalog_and_other_event(aws_env):
    store = _store(aws_env)
    registry = FarmRegistry(aws_env["bucket"])
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    week = create_tournament(
        store,
        {
            "name": "Week",
            "start_at": "2026-08-10T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        },
        now=clock,
    )
    month = create_tournament(
        store,
        {
            "name": "Month",
            "start_at": "2026-08-01T00:00:00+00:00",
            "duration_days": 30,
            "prize_amount": "45",
        },
        now=clock,
    )
    week_id = week["tournament_id"]
    month_id = month["tournament_id"]
    registry.upsert("99", name="rmr")
    add_farms_to_tournament(store, registry, tournament_id=week_id, farm_ids=["99"])
    add_farms_to_tournament(store, registry, tournament_id=month_id, farm_ids=["99"])
    store.put_event_score(week_id, _score("99"))
    store.put_event_score(month_id, _score("99"))
    store.put_event_leaderboard(week_id, {"entries": [_score("99")], "count": 1})
    store.put_event_leaderboard(month_id, {"entries": [_score("99")], "count": 1})
    store.put_leaderboard_cache({"entries": [_score("99")], "count": 1, "leader_farm_id": "99"})
    featured_before = store.get_config()["current_tournament_id"]
    featured_board = store.get_leaderboard_cache()

    freeze_tournament(store, store.get_tournament(week_id), now=clock)

    archive = store.read_archive(week_id)
    assert archive is not None
    assert archive.get("entries") is not None
    assert store.get_event_score(week_id, "99") is None
    assert store.get_event_leaderboard(week_id) is None
    ended = store.get_tournament(week_id)
    assert ended["status"] == "ended"
    assert store.get_member(week_id, "99")["status"] == "enrolled"
    assert store.get_event_score(month_id, "99")["digs_to_third_op"] == 14
    assert store.get_event_leaderboard(month_id)["count"] == 1
    assert store.get_tournament(month_id)["status"] == "active"
    assert store.get_member(month_id, "99")["status"] == "enrolled"
    assert store.get_config()["current_tournament_id"] == featured_before
    assert store.get_leaderboard_cache()["leader_farm_id"] == featured_board["leader_farm_id"]


def test_purge_does_not_delete_when_standings_are_missing(aws_env):
    store = _store(aws_env)
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    week = create_tournament(
        store,
        {
            "name": "Week",
            "start_at": "2026-08-10T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        },
        now=clock,
    )
    tid = week["tournament_id"]
    week["status"] = "ended"
    store.put_tournament(week)
    store.put_event_score(tid, _score("99"))
    store.put_event_leaderboard(tid, {"entries": [_score("99")], "count": 1})
    store._put_json(
        f"archives/{tid}/meta.json",
        {"tournament_id": tid, "archived_at": "2026-08-17T00:00:00+00:00"},
    )

    result = purge_archived_event_live_cache(store, tid)
    assert result["purged"] is False
    assert store.get_event_score(tid, "99") is not None
    assert store.get_event_leaderboard(tid) is not None
    assert store.get_tournament(tid)["status"] == "ended"


def test_purge_does_not_touch_a_live_event_even_with_an_archive(aws_env):
    store = _store(aws_env)
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    week = create_tournament(
        store,
        {
            "name": "Week",
            "start_at": "2026-08-10T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        },
        now=clock,
    )
    tid = week["tournament_id"]
    store.put_event_score(tid, _score("99"))
    store.write_archive(
        tid,
        {
            "tournament_id": tid,
            "archived_at": "2026-08-15T12:00:00+00:00",
            "entries": [_score("99")],
            "count": 1,
        },
    )

    result = purge_archived_event_live_cache(store, tid)
    assert result["purged"] is False
    assert store.get_tournament(tid)["status"] == "active"
    assert store.get_event_score(tid, "99") is not None
