"""Drive the shipped farm-sync handler — full sweep vs one farm."""

from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

from tournament.farms import FarmRegistry

ROOT = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)


class FakeClient:
    def __init__(self, payloads: dict[str, dict] | None = None):
        self.payloads = payloads or {}
        self.called: list[str] = []

    def fetch_farm(self, farm_id: str):
        self.called.append(farm_id)
        return self.payloads[farm_id]


def _grid_payload(tiles):
    return {"farm": {"desert": {"digging": {"grid": tiles}}}}


def shovel(items=None):
    return {
        "dugAt": int(NOW.timestamp() * 1000),
        "items": items or {"Sand": 1},
        "tool": "Sand Shovel",
    }


def _load_sync(aws_env, monkeypatch, client: FakeClient):
    monkeypatch.setenv("DATA_BUCKET", aws_env["bucket"])
    monkeypatch.setenv("CONFIG_TABLE", aws_env["config_table"])
    monkeypatch.setenv("SCORES_TABLE", aws_env["scores_table"])
    monkeypatch.setenv("SUBMISSIONS_TABLE", aws_env["submissions_table"])
    monkeypatch.setenv("SFL_API_KEY", "test-key")
    monkeypatch.setenv("SFL_MIN_INTERVAL_SECONDS", "12")
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "")
    path = ROOT / "lambda_functions" / "farm_sync" / "app.py"
    spec = importlib.util.spec_from_file_location("pj007_farm_sync_app", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["pj007_farm_sync_app"] = module
    spec.loader.exec_module(module)
    module.DATA_BUCKET = aws_env["bucket"]
    module.CONFIG_TABLE = aws_env["config_table"]
    module.SCORES_TABLE = aws_env["scores_table"]
    module.SUBMISSIONS_TABLE = aws_env["submissions_table"]
    module.SFL_API_KEY = "test-key"
    module.RateLimitedSFLClient = lambda *args, **kwargs: client
    return module


def test_one_farm_invoke_updates_only_that_farm(aws_env, monkeypatch):
    client = FakeClient(
        {
            "1": _grid_payload([shovel({"Otter Pebble": 1})]),
            "2": _grid_payload([shovel({"Otter Pebble": 3})]),
        }
    )
    app = _load_sync(aws_env, monkeypatch, client)
    registry = FarmRegistry(aws_env["bucket"])
    registry.upsert("1", name="one")
    registry.upsert("2", name="two")

    result = app.lambda_handler({"source": "admin-refresh", "farm_id": "1"}, None)
    assert result["synced"] == 1
    assert result["failures"] == 0
    assert result["farm_id"] == "1"
    assert client.called == ["1"]

    from tournament.store import Store

    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    assert store.get_score("1") is not None
    assert store.get_score("1")["name"] == "one"
    assert store.get_score("2") is None


def test_untracked_farm_id_is_a_skip(aws_env, monkeypatch):
    client = FakeClient({"99": _grid_payload([shovel()])})
    app = _load_sync(aws_env, monkeypatch, client)
    result = app.lambda_handler({"farm_id": "99"}, None)
    assert result["synced"] == 0
    assert result["skipped"] == "not_tracked"
    assert result["farm_id"] == "99"
    assert client.called == []


def test_omitted_farm_id_still_sweeps_all(aws_env, monkeypatch):
    client = FakeClient(
        {
            "1": _grid_payload([shovel()]),
            "2": _grid_payload([shovel()]),
        }
    )
    app = _load_sync(aws_env, monkeypatch, client)
    registry = FarmRegistry(aws_env["bucket"])
    registry.upsert("1", name="one")
    registry.upsert("2", name="two")
    result = app.lambda_handler({"source": "schedule"}, None)
    assert result["synced"] == 2
    assert result["failures"] == 0
    assert client.called == ["1", "2"]


def test_schedule_at_2300_finalizes_incompletes(aws_env, monkeypatch):
    before = int(datetime(2026, 8, 14, 20, 0, tzinfo=timezone.utc).timestamp() * 1000)
    after = int(datetime(2026, 8, 14, 23, 10, tzinfo=timezone.utc).timestamp() * 1000)

    def pebble(dug_at):
        return {"dugAt": dug_at, "items": {"Otter Pebble": 1}, "tool": "Sand Shovel"}

    client = FakeClient(
        {
            "1": _grid_payload([pebble(before), pebble(before), pebble(before)]),
            "2": _grid_payload([pebble(before), pebble(after)]),
        }
    )
    app = _load_sync(aws_env, monkeypatch, client)
    registry = FarmRegistry(aws_env["bucket"])
    registry.upsert("1", name="done")
    registry.upsert("2", name="short")
    from tournament.store import Store

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
    result = app.lambda_handler({"source": "aws.events", "time": "2026-08-14T23:00:00Z"}, None)
    assert result["synced"] == 2
    assert result.get("finalized") is True
    assert store.get_score("1")["digs_to_third_op"] == 3
    assert store.get_score("2")["otter_count"] == 1
    assert store.get_score("2")["digs_to_third_op"] == 40


def test_schedule_at_1400_leaves_incompletes_without_penalty(aws_env, monkeypatch):
    before = int(datetime(2026, 8, 14, 13, 0, tzinfo=timezone.utc).timestamp() * 1000)
    client = FakeClient(
        {
            "1": _grid_payload(
                [{"dugAt": before, "items": {"Otter Pebble": 1}, "tool": "Sand Shovel"}]
            ),
        }
    )
    app = _load_sync(aws_env, monkeypatch, client)
    registry = FarmRegistry(aws_env["bucket"])
    registry.upsert("1", name="short")
    from tournament.store import Store

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
    result = app.lambda_handler({"source": "aws.events", "time": "2026-08-14T14:00:00Z"}, None)
    assert result["synced"] == 1
    assert result.get("finalized") is not True
    row = store.get_score("1")
    assert row["otter_count"] == 1
    assert row["digs_to_third_op"] is None
