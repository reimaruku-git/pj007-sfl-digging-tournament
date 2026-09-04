from datetime import datetime, timedelta, timezone

from tournament.catalog import create_tournament, delete_tournament, rollover
from tournament.farms import FarmRegistry
from tournament.membership import add_farms_to_tournament
from tournament.sfl_client import SFLApiError
from tournament.store import Store
from tournament.scoring import score_grid
from tournament.history import (
    day_record_from_computed,
    farm_recorded_third_op_today,
    put_farm_day,
)
from tournament.sync import (
    apply_computed_score,
    apply_day_finalize,
    farms_after_cursor,
    rescore_from_snapshots,
    sync_all_farms,
    sync_one_farm,
)

NOW = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)


class FakeClient:
    def __init__(self, payloads: dict[str, dict] | None = None, errors: dict | None = None):
        self.payloads = payloads or {}
        self.errors = errors or {}
        self.called: list[str] = []

    def fetch_farm(self, farm_id: str):
        self.called.append(farm_id)
        if farm_id in self.errors:
            raise self.errors[farm_id]
        return self.payloads[farm_id]


def _grid_payload(tiles, streak_count=3):
    later = int((NOW.timestamp() + 86_400) * 1000)
    return {
        "farm": {
            "island": {"type": "desert"},
            "vip": {"expiresAt": later},
            "desert": {
                "digging": {
                    "grid": tiles,
                    "streak": {
                        "count": streak_count,
                        "collectedAt": "2026-08-14T00:00:00.000Z",
                        "totalClaimed": streak_count,
                    },
                }
            },
        }
    }


def shovel(items=None, dug_at=None):
    return {
        "dugAt": int(NOW.timestamp() * 1000) if dug_at is None else dug_at,
        "items": items or {"Sand": 1},
        "tool": "Sand Shovel",
    }


def test_sync_one_farm_writes_score_and_snapshot(aws_env):
    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    tiles = [
        shovel({"Otter Pebble": 1}),
        shovel({"Otter Pebble": 1}),
        [
            shovel({"Sand": 1}),
            shovel({"Otter Pebble": 1}),
            shovel({"Sand": 1}),
            shovel({"Sand": 1}),
        ],
    ]
    client = FakeClient({"99": _grid_payload(tiles)})
    row = sync_one_farm(
        store,
        client,
        {"farm_id": "99", "name": "rmr", "active": True},
        now=NOW,
    )
    # 2 shovel OPs + 4 drill slots; the 3rd OP sits on the last drill hole
    assert row["digs_to_third_op"] == 6
    assert row["otter_count"] == 3
    assert row["status"] == "completed"
    snapshot = store.read_snapshot("99")
    assert snapshot["score"]["digs_to_third_op"] == 6
    assert snapshot["streak"]["count"] == 3
    assert snapshot["digging_streak"] == 3
    assert snapshot["island"] == "desert"
    assert snapshot["vip"] is True


def test_sync_all_records_failures_and_rebuilds_cache(aws_env):
    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    registry = FarmRegistry(aws_env["bucket"])
    registry.upsert("1", name="ok")
    registry.upsert("2", name="bad")
    client = FakeClient(
        payloads={"1": _grid_payload([shovel()])},
        errors={"2": SFLApiError("SFL HTTP 500", status_code=500)},
    )
    result = sync_all_farms(store, registry, client, now=NOW)
    assert result["synced"] == 2
    assert result["failures"] == 1
    cache = store.get_leaderboard_cache()
    assert cache["count"] == 2
    assert store.get_score("2")["error"] == "SFL HTTP 500"
    assert client.called == ["1", "2"]
    assert result["continued"] is False
    assert result["complete"] is True


def test_farms_after_cursor_skips_through_the_named_farm():
    farms = [{"farm_id": "1"}, {"farm_id": "2"}, {"farm_id": "3"}]
    assert [farm["farm_id"] for farm in farms_after_cursor(farms, None)] == ["1", "2", "3"]
    assert [farm["farm_id"] for farm in farms_after_cursor(farms, "1")] == ["2", "3"]
    assert [farm["farm_id"] for farm in farms_after_cursor(farms, "3")] == []
    assert [farm["farm_id"] for farm in farms_after_cursor(farms, "missing")] == [
        "1",
        "2",
        "3",
    ]


def test_sync_all_stops_before_later_farms_and_does_not_mark_complete(aws_env):
    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    registry = FarmRegistry(aws_env["bucket"])
    registry.upsert("1", name="one")
    registry.upsert("2", name="two")
    registry.upsert("3", name="three")
    client = FakeClient(
        {
            "1": _grid_payload([shovel()]),
            "2": _grid_payload([shovel()]),
            "3": _grid_payload([shovel()]),
        }
    )
    calls = {"n": 0}

    def should_stop():
        calls["n"] += 1
        return True

    result = sync_all_farms(store, registry, client, now=NOW, should_stop=should_stop)
    assert client.called == ["1"]
    assert result["synced"] == 1
    assert result["continued"] is True
    assert result["complete"] is False
    assert result["after_farm_id"] == "1"
    assert result["remaining"] == 2
    assert result["finalized"] is False
    assert store.get_config().get("last_full_sync_at") is None


def test_sync_all_resumes_after_cursor(aws_env):
    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    registry = FarmRegistry(aws_env["bucket"])
    registry.upsert("1", name="one")
    registry.upsert("2", name="two")
    registry.upsert("3", name="three")
    client = FakeClient(
        {
            "1": _grid_payload([shovel()]),
            "2": _grid_payload([shovel()]),
            "3": _grid_payload([shovel()]),
        }
    )
    result = sync_all_farms(store, registry, client, now=NOW, after_farm_id="1")
    assert client.called == ["2", "3"]
    assert result["synced"] == 2
    assert result["complete"] is True
    assert result["after_farm_id"] is None


def test_sync_all_skips_farms_that_already_have_todays_third_op(aws_env):
    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    registry = FarmRegistry(aws_env["bucket"])
    registry.upsert("1", name="done")
    registry.upsert("2", name="short")
    pebbles = [shovel({"Otter Pebble": 1}) for _ in range(3)]
    client = FakeClient(
        {
            "1": _grid_payload(pebbles),
            "2": _grid_payload([shovel({"Otter Pebble": 1})]),
        }
    )
    first = sync_all_farms(store, registry, client, now=NOW)
    assert first["skipped"] == 0
    assert client.called == ["1", "2"]
    assert farm_recorded_third_op_today(store, "1", now=NOW) is True
    assert farm_recorded_third_op_today(store, "2", now=NOW) is False

    client.called.clear()
    second = sync_all_farms(store, registry, client, now=NOW)
    assert second["skipped"] == 1
    assert client.called == ["2"]
    assert store.get_score("1")["score_today"] == 3


def test_finalize_uses_stored_completers_without_fetching_them_again(aws_env):
    clock = datetime(2026, 8, 14, 23, 0, tzinfo=timezone.utc)
    before = int(datetime(2026, 8, 14, 20, 0, tzinfo=timezone.utc).timestamp() * 1000)
    after = int(datetime(2026, 8, 14, 23, 10, tzinfo=timezone.utc).timestamp() * 1000)

    def pebble(dug_at):
        return {"dugAt": dug_at, "items": {"Otter Pebble": 1}, "tool": "Sand Shovel"}

    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    store.put_config(
        {
            "start_at": "2026-08-01T00:00:00+00:00",
            "end_at": "2026-08-21T00:00:00+00:00",
            "prize_amount": "30",
        }
    )
    registry = FarmRegistry(aws_env["bucket"])
    registry.upsert("1", name="done")
    registry.upsert("2", name="short")
    midday = datetime(2026, 8, 14, 16, 0, tzinfo=timezone.utc)
    client = FakeClient(
        {
            "1": _grid_payload([pebble(before), pebble(before), pebble(before)]),
            "2": _grid_payload([pebble(before), pebble(after)]),
        }
    )
    sync_all_farms(store, registry, client, now=midday)
    assert store.get_score("1")["digs_to_third_op"] == 3
    client.called.clear()

    result = sync_all_farms(store, registry, client, now=clock)
    assert result["skipped"] == 1
    assert result["finalized"] is True
    assert client.called == ["2"]
    assert store.get_score("1")["digs_to_third_op"] == 3
    assert store.get_score("2")["otter_count"] == 1
    assert store.get_score("2")["digs_to_third_op"] == 40


def test_sync_all_does_not_finalize_until_the_roster_is_done(aws_env):
    clock = datetime(2026, 8, 14, 23, 0, tzinfo=timezone.utc)
    before = int(datetime(2026, 8, 14, 20, 0, tzinfo=timezone.utc).timestamp() * 1000)
    after = int(datetime(2026, 8, 14, 23, 10, tzinfo=timezone.utc).timestamp() * 1000)

    def pebble(dug_at):
        return {"dugAt": dug_at, "items": {"Otter Pebble": 1}, "tool": "Sand Shovel"}

    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    store.put_config(
        {
            "start_at": "2026-08-01T00:00:00+00:00",
            "end_at": "2026-08-21T00:00:00+00:00",
            "prize_amount": "30",
        }
    )
    registry = FarmRegistry(aws_env["bucket"])
    registry.upsert("1", name="done")
    registry.upsert("2", name="short")
    client = FakeClient(
        {
            "1": _grid_payload([pebble(before), pebble(before), pebble(before)]),
            "2": _grid_payload([pebble(before), pebble(after)]),
        }
    )
    first = sync_all_farms(store, registry, client, now=clock, should_stop=lambda: True)
    assert first["continued"] is True
    assert first["finalized"] is False
    assert store.get_score("1")["digs_to_third_op"] == 3
    assert store.get_score("2") is None

    second = sync_all_farms(store, registry, client, now=clock, after_farm_id="1")
    assert second["complete"] is True
    assert second["finalized"] is True
    assert store.get_score("2")["otter_count"] == 1
    assert store.get_score("2")["digs_to_third_op"] == 40


def test_rescore_from_snapshots_applies_new_window(aws_env):
    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    store.put_config(
        {
            "start_at": "2026-08-01T00:00:00+00:00",
            "end_at": "2026-08-20T00:00:00+00:00",
            "prize_amount": "30",
        }
    )
    early = int(datetime(2026, 8, 2, tzinfo=timezone.utc).timestamp() * 1000)
    late = int(datetime(2026, 8, 15, tzinfo=timezone.utc).timestamp() * 1000)
    grid = [
        {"dugAt": early, "items": {"Otter Pebble": 1}, "tool": "Sand Shovel"},
        {"dugAt": early, "items": {"Otter Pebble": 1}, "tool": "Sand Shovel"},
        {"dugAt": late, "items": {"Otter Pebble": 1}, "tool": "Sand Shovel"},
    ]
    computed = score_grid(
        grid,
        now=NOW,
        window_start=datetime(2026, 8, 1, tzinfo=timezone.utc),
        window_end=datetime(2026, 8, 20, tzinfo=timezone.utc),
    )
    apply_computed_score(store, farm_id="99", name="rmr", computed=computed, now=NOW, grid=grid)
    store.write_snapshot("99", {"farm_id": "99", "grid": grid, "score": computed.to_dict()})
    assert store.get_score("99")["digs_to_third_op"] == 3

    store.put_config(
        {
            "start_at": "2026-08-01T00:00:00+00:00",
            "end_at": "2026-08-10T00:00:00+00:00",
            "prize_amount": "30",
        }
    )
    result = rescore_from_snapshots(store, now=NOW)
    assert result["rescored"] == 1
    assert result["missing_snapshots"] == 0
    row = store.get_score("99")
    assert row["digs_to_third_op"] is None
    assert row["status"] == "in_progress"
    assert any(int(item.get("otter_count") or 0) == 2 for item in row["days"])


def _store(aws_env):
    return Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )


def _ms(dt):
    return int(dt.timestamp() * 1000)


def _seed_farms(store, registry, grids):
    store.put_config(
        {
            "start_at": "2026-08-01T00:00:00+00:00",
            "end_at": "2026-08-21T00:00:00+00:00",
            "prize_amount": "30",
        }
    )
    payloads = {}
    for farm_id, name, tiles in grids:
        registry.upsert(farm_id, name=name)
        payloads[farm_id] = _grid_payload(tiles)
    return payloads


def test_finalize_2300_assigns_incomplete_and_is_idempotent(aws_env):
    store = _store(aws_env)
    store.put_config(
        {
            "start_at": "2026-08-01T00:00:00+00:00",
            "end_at": "2026-08-21T00:00:00+00:00",
            "prize_amount": "30",
        }
    )
    before = datetime(2026, 8, 14, 20, 0, tzinfo=timezone.utc)
    after = datetime(2026, 8, 14, 23, 15, tzinfo=timezone.utc)
    done_grid = [
        shovel({"Otter Pebble": 1}, dug_at=_ms(before)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(before)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(before)),
    ]
    short_grid = [
        shovel({"Otter Pebble": 1}, dug_at=_ms(before)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(before)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(after)),
    ]
    none_grid = [shovel({"Sand": 1}, dug_at=_ms(before))]
    for farm_id, name, grid in (
        ("1", "done", done_grid),
        ("2", "short", short_grid),
        ("3", "none", none_grid),
    ):
        computed = score_grid(grid, now=NOW)
        apply_computed_score(
            store, farm_id=farm_id, name=name, computed=computed, now=NOW, grid=grid
        )
        store.write_snapshot(
            farm_id, {"farm_id": farm_id, "grid": grid, "score": computed.to_dict()}
        )

    clock = datetime(2026, 8, 14, 23, 0, tzinfo=timezone.utc)
    first = apply_day_finalize(store, now=clock)
    second = apply_day_finalize(store, now=clock)
    assert first["finalized"] is True
    assert first["rescored"] == 3
    done = store.get_score("1")
    short = store.get_score("2")
    none = store.get_score("3")
    assert done["digs_to_third_op"] == 3
    assert done["status"] == "completed"
    # third pebble is after 23:00 so only 2 OP count
    assert short["otter_count"] == 2
    assert short["status"] == "in_progress"
    assert short["digs_to_third_op"] == 35
    assert none["otter_count"] == 0
    assert none["digs_to_third_op"] == 45
    assert none["digs_to_second_op"] == 44
    assert none["digs_to_first_op"] == 43
    none_today = next(item for item in none["days"] if item["day"] == "2026-08-14")
    assert none_today["digs_to_second_op"] == 44
    assert none_today["digs_to_first_op"] == 43
    assert store.get_score("1")["digs_to_third_op"] == done["digs_to_third_op"]
    assert store.get_score("2")["digs_to_third_op"] == short["digs_to_third_op"]
    assert store.get_score("3")["digs_to_third_op"] == none["digs_to_third_op"]
    assert second["highest_completed"] == first["highest_completed"]
    cache = store.get_leaderboard_cache()
    by_id = {entry["farm_id"]: entry for entry in cache["entries"]}
    assert by_id["1"]["digs_to_third_op"] == 3
    assert by_id["2"]["digs_to_third_op"] == 35


def test_midday_sync_does_not_assign_incomplete_penalty(aws_env):
    store = _store(aws_env)
    registry = FarmRegistry(aws_env["bucket"])
    before = datetime(2026, 8, 14, 15, 0, tzinfo=timezone.utc)
    tiles = [shovel({"Otter Pebble": 1}, dug_at=_ms(before))]
    payloads = _seed_farms(store, registry, [("1", "short", tiles)])
    client = FakeClient(payloads)
    clock = datetime(2026, 8, 14, 16, 0, tzinfo=timezone.utc)
    result = sync_all_farms(store, registry, client, now=clock)
    assert result["synced"] == 1
    row = store.get_score("1")
    assert row["otter_count"] == 1
    assert row["digs_to_third_op"] is None
    assert row["status"] == "in_progress"


def test_2300_sync_applies_cutoff_and_incomplete_penalty(aws_env):
    store = _store(aws_env)
    registry = FarmRegistry(aws_env["bucket"])
    before = datetime(2026, 8, 14, 20, 0, tzinfo=timezone.utc)
    after = datetime(2026, 8, 14, 23, 10, tzinfo=timezone.utc)
    done = [
        shovel({"Otter Pebble": 1}, dug_at=_ms(before)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(before)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(before)),
    ]
    short = [
        shovel({"Otter Pebble": 1}, dug_at=_ms(before)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(after)),
    ]
    payloads = _seed_farms(
        store,
        registry,
        [("1", "done", done), ("2", "short", short)],
    )
    client = FakeClient(payloads)
    clock = datetime(2026, 8, 14, 23, 0, tzinfo=timezone.utc)
    result = sync_all_farms(store, registry, client, now=clock)
    assert result["synced"] == 2
    assert result.get("finalized") is True
    assert store.get_score("1")["digs_to_third_op"] == 3
    assert store.get_score("2")["otter_count"] == 1
    assert store.get_score("2")["digs_to_third_op"] == 40


def test_next_day_empty_grid_keeps_yesterday_and_sums_completed_days(aws_env):
    store = _store(aws_env)
    registry = FarmRegistry(aws_env["bucket"])
    store.put_config(
        {
            "start_at": "2026-08-17T00:00:00+00:00",
            "end_at": "2026-08-24T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        }
    )
    day1 = datetime(2026, 8, 17, 16, 0, tzinfo=timezone.utc)
    day2 = datetime(2026, 8, 18, 16, 0, tzinfo=timezone.utc)
    done = [
        shovel({"Otter Pebble": 1}, dug_at=_ms(day1)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(day1)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(day1)),
    ]
    registry.upsert("99", name="rmr")
    client = FakeClient({"99": _grid_payload(done)})
    sync_all_farms(store, registry, client, now=day1)
    first = store.get_score("99")
    assert first["digs_to_third_op"] == 3
    assert first["score"] == 3.0
    assert first["score_today"] == 3
    assert [row["day"] for row in first["days"]] == ["2026-08-17"]

    client = FakeClient({"99": _grid_payload([])})
    sync_all_farms(store, registry, client, now=day2)
    row = store.get_score("99")
    assert row["digs_to_third_op"] == 3
    assert row["score"] == 3.0
    assert row["score_today"] is None
    assert [item["day"] for item in row["days"]] == ["2026-08-17", "2026-08-18"]
    assert row["days"][0]["digs_to_third_op"] == 3
    assert row["days"][1]["digs_to_third_op"] is None
    assert store.read_farm_day("99", "2026-08-17")["digs_to_third_op"] == 3
    assert store.read_snapshot("99")["grid"] == []

    later = [
        shovel({"Otter Pebble": 1}, dug_at=_ms(day2)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(day2)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(day2 + timedelta(minutes=1))),
        shovel({"Otter Pebble": 1}, dug_at=_ms(day2 + timedelta(minutes=2))),
    ]
    client = FakeClient({"99": _grid_payload(later)})
    sync_all_farms(store, registry, client, now=day2)
    row = store.get_score("99")
    assert row["days"][0]["digs_to_third_op"] == 3
    assert row["days"][1]["digs_to_third_op"] == 3
    assert row["digs_to_third_op"] == 6
    assert row["score"] == 3.0
    assert row["score_today"] == 3


def test_recover_yesterday_from_daily_leaderboard(aws_env):
    store = _store(aws_env)
    store.put_config(
        {
            "start_at": "2026-08-17T00:00:00+00:00",
            "end_at": "2026-08-24T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        }
    )
    store.write_daily_snapshot(
        "2026-08-17",
        {
            "captured_at": "2026-08-17T23:01:59+00:00",
            "leaderboard": [
                {
                    "farm_id": "99",
                    "name": "rmr",
                    "digs_to_third_op": 14,
                    "digs_to_first_op": 4,
                    "digs_to_second_op": 5,
                    "otter_count": 3,
                    "total_digs": 29,
                    "digs_today": 29,
                    "status": "completed",
                    "first_op_at": "2026-08-17T13:49:30+00:00",
                    "second_op_at": "2026-08-17T13:49:33+00:00",
                    "third_op_at": "2026-08-17T13:50:06+00:00",
                }
            ],
            "count": 1,
        },
    )
    store.put_score(store.empty_score("99", "rmr"))
    from tournament.history import recover_daily_history

    clock = datetime(2026, 8, 18, 16, 0, tzinfo=timezone.utc)
    assert recover_daily_history(store, now=clock) == 1
    row = store.get_score("99")
    assert row["digs_to_third_op"] == 14
    assert row["score"] == 14.0
    assert row["score_today"] is None
    assert row["days"][0]["day"] == "2026-08-17"
    assert row["days"][0]["finalized"] is True
    assert recover_daily_history(store, now=clock) == 0


def test_finalize_penalizes_today_only(aws_env):
    store = _store(aws_env)
    store.put_config(
        {
            "start_at": "2026-08-17T00:00:00+00:00",
            "end_at": "2026-08-24T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        }
    )
    day1 = datetime(2026, 8, 17, 16, 0, tzinfo=timezone.utc)
    done = [
        shovel({"Otter Pebble": 1}, dug_at=_ms(day1)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(day1)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(day1)),
    ]
    apply_computed_score(
        store,
        farm_id="99",
        name="rmr",
        computed=score_grid(done, now=day1),
        now=day1,
        grid=done,
    )
    yesterday = store.read_farm_day("99", "2026-08-17")
    yesterday["finalized"] = True
    put_farm_day(store, "99", "2026-08-17", yesterday, overwrite_finalized=True)

    short = [
        shovel({"Otter Pebble": 1}, dug_at=_ms(datetime(2026, 8, 18, 20, tzinfo=timezone.utc)))
    ]
    apply_computed_score(
        store,
        farm_id="99",
        name="rmr",
        computed=score_grid(short, now=datetime(2026, 8, 18, 20, tzinfo=timezone.utc)),
        now=datetime(2026, 8, 18, 20, tzinfo=timezone.utc),
        grid=short,
    )
    clock = datetime(2026, 8, 18, 23, 0, tzinfo=timezone.utc)
    result = apply_day_finalize(store, now=clock)
    assert result["finalized"] is True
    row = store.get_score("99")
    by_day = {item["day"]: item for item in row["days"]}
    assert by_day["2026-08-17"]["digs_to_third_op"] == 3
    assert by_day["2026-08-18"]["digs_to_third_op"] == 40
    assert by_day["2026-08-18"]["finalized"] is True
    assert row["digs_to_third_op"] == 43
    assert row["score"] == 21.5
    assert row["score_today"] == 40


def test_sync_skips_farms_not_enrolled_in_a_live_event(aws_env):
    store = _store(aws_env)
    registry = FarmRegistry(aws_env["bucket"])
    clock = NOW
    week = create_tournament(
        store,
        {
            "name": "Week cup",
            "start_at": "2026-08-14T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        },
        now=clock,
    )
    registry.upsert("1", name="in")
    registry.upsert("2", name="out")
    add_farms_to_tournament(store, registry, tournament_id=week["tournament_id"], farm_ids=["1"])
    client = FakeClient(
        {
            "1": _grid_payload([shovel({"Otter Pebble": 1})]),
            "2": _grid_payload([shovel({"Otter Pebble": 1})]),
        }
    )
    result = sync_all_farms(store, registry, client, now=clock)
    assert result["synced"] == 1
    assert client.called == ["1"]


def test_scheduled_only_enrollment_is_not_fetched(aws_env):
    store = _store(aws_env)
    registry = FarmRegistry(aws_env["bucket"])
    clock = NOW
    later = create_tournament(
        store,
        {
            "name": "Later",
            "start_at": "2026-09-01T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        },
        now=clock,
    )
    registry.upsert("1", name="soon")
    add_farms_to_tournament(store, registry, tournament_id=later["tournament_id"], farm_ids=["1"])
    client = FakeClient({"1": _grid_payload([shovel()])})
    result = sync_all_farms(store, registry, client, now=clock)
    assert result["synced"] == 0
    assert client.called == []


def test_overlapping_events_score_the_same_farm_separately(aws_env):
    store = _store(aws_env)
    registry = FarmRegistry(aws_env["bucket"])
    clock = datetime(2026, 8, 15, 16, tzinfo=timezone.utc)
    week = create_tournament(
        store,
        {
            "name": "Week",
            "start_at": "2026-08-14T00:00:00+00:00",
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
    registry.upsert("99", name="rmr")
    add_farms_to_tournament(store, registry, tournament_id=week["tournament_id"], farm_ids=["99"])
    add_farms_to_tournament(store, registry, tournament_id=month["tournament_id"], farm_ids=["99"])
    day1 = datetime(2026, 8, 2, 16, tzinfo=timezone.utc)
    early = [
        shovel({"Sand": 1}, dug_at=_ms(day1)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(day1)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(day1)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(day1)),
    ]
    put_farm_day(
        store,
        "99",
        "2026-08-02",
        day_record_from_computed("2026-08-02", score_grid(early, now=day1), grid=early),
    )
    today = [
        shovel({"Otter Pebble": 1}, dug_at=_ms(clock)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(clock)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(clock)),
    ]
    client = FakeClient({"99": _grid_payload(today)})
    result = sync_all_farms(store, registry, client, now=clock)
    assert result["synced"] == 1
    assert client.called == ["99"]
    week_row = store.get_event_score(week["tournament_id"], "99")
    month_row = store.get_event_score(month["tournament_id"], "99")
    assert week_row["digs_to_third_op"] == 3
    assert month_row["digs_to_third_op"] == 7
    week_board = store.get_event_leaderboard(week["tournament_id"])
    month_board = store.get_event_leaderboard(month["tournament_id"])
    assert week_board["entries"][0]["digs_to_third_op"] == 3
    assert month_board["entries"][0]["digs_to_third_op"] == 7


def test_finalize_floor_is_per_event_roster(aws_env):
    store = _store(aws_env)
    registry = FarmRegistry(aws_env["bucket"])
    clock = datetime(2026, 8, 14, 16, tzinfo=timezone.utc)
    event_a = create_tournament(
        store,
        {
            "name": "A",
            "start_at": "2026-08-14T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        },
        now=clock,
    )
    event_b = create_tournament(
        store,
        {
            "name": "B",
            "start_at": "2026-08-10T00:00:00+00:00",
            "duration_days": 14,
            "prize_amount": "30",
        },
        now=clock,
    )
    registry.upsert("done", name="done")
    registry.upsert("short", name="short")
    add_farms_to_tournament(
        store, registry, tournament_id=event_a["tournament_id"], farm_ids=["short"]
    )
    add_farms_to_tournament(
        store,
        registry,
        tournament_id=event_b["tournament_id"],
        farm_ids=["done", "short"],
    )
    before = datetime(2026, 8, 14, 20, tzinfo=timezone.utc)
    done_grid = [shovel({"Sand": 1}, dug_at=_ms(before)) for _ in range(35)] + [
        shovel({"Otter Pebble": 1}, dug_at=_ms(before)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(before)),
        shovel({"Otter Pebble": 1}, dug_at=_ms(before)),
    ]
    short_grid = [shovel({"Otter Pebble": 1}, dug_at=_ms(before))]
    client = FakeClient({"done": _grid_payload(done_grid), "short": _grid_payload(short_grid)})
    sync_all_farms(store, registry, client, now=datetime(2026, 8, 14, 23, tzinfo=timezone.utc))
    a_short = store.get_event_score(event_a["tournament_id"], "short")
    b_short = store.get_event_score(event_b["tournament_id"], "short")
    # A has no completer → floor 30 + 5*2 missing = 40
    assert a_short["digs_to_third_op"] == 40
    # B's completer finished in 38 → max(38, 30)+10 = 48
    assert b_short["digs_to_third_op"] == 48
    assert store.get_event_score(event_b["tournament_id"], "done")["digs_to_third_op"] == 38
    assert store.get_event_score(event_a["tournament_id"], "done") is None


def test_deleting_one_live_event_leaves_the_other(aws_env):
    store = _store(aws_env)
    clock = NOW
    week = create_tournament(
        store,
        {
            "name": "Week",
            "start_at": "2026-08-14T00:00:00+00:00",
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
    delete_tournament(store, week["tournament_id"], now=clock)
    assert store.get_tournament(week["tournament_id"]) is None
    assert store.get_tournament(month["tournament_id"])["status"] == "active"
    assert store.get_config()["current_tournament_id"] == month["tournament_id"]


def test_rollover_archives_ended_and_keeps_other_live(aws_env):
    store = _store(aws_env)
    early = datetime(2026, 8, 10, 12, tzinfo=timezone.utc)
    sprint = create_tournament(
        store,
        {
            "name": "Sprint",
            "start_at": "2026-08-10T00:00:00+00:00",
            "duration_days": 1,
            "prize_amount": "10",
        },
        now=early,
    )
    month = create_tournament(
        store,
        {
            "name": "Month",
            "start_at": "2026-08-01T00:00:00+00:00",
            "duration_days": 30,
            "prize_amount": "45",
        },
        now=early,
    )
    later = datetime(2026, 8, 11, 12, tzinfo=timezone.utc)
    result = rollover(store, now=later)
    assert result["archived"] is True
    assert store.get_tournament(sprint["tournament_id"])["status"] == "ended"
    assert store.get_tournament(month["tournament_id"])["status"] == "active"
    assert store.get_config()["current_tournament_id"] == month["tournament_id"]


def test_sync_pings_each_live_board_leader(aws_env, monkeypatch):
    pings: list[tuple[str, str]] = []

    def _capture(url, entry, *, event_name=""):
        pings.append((event_name, str(entry.get("farm_id"))))

    monkeypatch.setattr("tournament.sync.notify_new_leader", _capture)
    store = _store(aws_env)
    registry = FarmRegistry(aws_env["bucket"])
    clock = datetime(2026, 8, 15, 16, tzinfo=timezone.utc)
    week = create_tournament(
        store,
        {
            "name": "Week cup",
            "start_at": "2026-08-14T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        },
        now=clock,
    )
    month = create_tournament(
        store,
        {
            "name": "Month cup",
            "start_at": "2026-08-01T00:00:00+00:00",
            "duration_days": 30,
            "prize_amount": "45",
        },
        now=clock,
    )
    registry.upsert("1", name="lead")
    add_farms_to_tournament(store, registry, tournament_id=week["tournament_id"], farm_ids=["1"])
    add_farms_to_tournament(store, registry, tournament_id=month["tournament_id"], farm_ids=["1"])
    pebbles = [
        shovel({"Otter Pebble": 1}),
        shovel({"Otter Pebble": 1}),
        shovel({"Otter Pebble": 1}),
    ]
    client = FakeClient({"1": _grid_payload(pebbles)})
    sync_all_farms(store, registry, client, webhook_url="https://example.invalid/hook", now=clock)
    assert sorted(pings) == [("Month cup", "1"), ("Week cup", "1")]


def test_list_members_uses_gsi_keys(aws_env):
    store = _store(aws_env)
    store.put_member(
        {
            "farm_id": "99",
            "tournament_id": "cup-1",
            "status": "enrolled",
            "submitted_at": "2026-08-14T12:00:00+00:00",
        }
    )
    by_event = store.list_members(tournament_id="cup-1")
    assert [row["farm_id"] for row in by_event] == ["99"]
    assert by_event[0]["gsi1pk"] == "MEMBER#cup-1"
    by_farm = store.list_members(farm_id="99")
    assert [row["tournament_id"] for row in by_farm] == ["cup-1"]
    assert by_farm[0]["gsi2pk"] == "MEMBER_FARM#99"
