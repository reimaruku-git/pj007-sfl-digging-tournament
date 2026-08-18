from datetime import datetime, timedelta, timezone

from tournament.farms import FarmRegistry
from tournament.sfl_client import SFLApiError
from tournament.store import Store
from tournament.scoring import score_grid
from tournament.history import put_farm_day
from tournament.sync import (
    apply_computed_score,
    apply_day_finalize,
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
    return {
        "farm": {
            "desert": {
                "digging": {
                    "grid": tiles,
                    "streak": {
                        "count": streak_count,
                        "collectedAt": "2026-08-14T00:00:00.000Z",
                        "totalClaimed": streak_count,
                    },
                }
            }
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
    assert row["otter_count"] == 2
    assert row["digs_to_third_op"] is None
    assert row["status"] == "in_progress"


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
    assert store.get_score("99")["digs_to_third_op"] == 3
    assert [row["day"] for row in store.get_score("99")["days"]] == ["2026-08-17"]

    client = FakeClient({"99": _grid_payload([])})
    sync_all_farms(store, registry, client, now=day2)
    row = store.get_score("99")
    assert row["digs_to_third_op"] == 3
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
