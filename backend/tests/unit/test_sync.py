from datetime import datetime, timezone

from tournament.farms import FarmRegistry
from tournament.sfl_client import SFLApiError
from tournament.store import Store
from tournament.scoring import score_grid
from tournament.sync import (
    apply_computed_score,
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


def _grid_payload(tiles):
    return {"farm": {"desert": {"digging": {"grid": tiles}}}}


def shovel(items=None):
    return {
        "dugAt": int(NOW.timestamp() * 1000),
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
    assert row["digs_to_third_op"] == 4
    assert row["otter_count"] == 3
    assert row["status"] == "completed"
    snapshot = store.read_snapshot("99")
    assert snapshot["score"]["digs_to_third_op"] == 4


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
    apply_computed_score(store, farm_id="99", name="rmr", computed=computed)
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
