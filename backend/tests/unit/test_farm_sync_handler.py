"""Drive the shipped farm-sync handler — full sweep vs one farm."""

from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

from tournament.farms import FarmRegistry
from tournament.store import Store

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
    monkeypatch.setenv("SFL_MIN_INTERVAL_SECONDS", "12")
    monkeypatch.setenv("SFL_SUCCESS_ROUND_SECONDS", "10")
    monkeypatch.setenv("SECRETS_BUCKET", "pj007-test-secrets")
    monkeypatch.setenv("SFL_KEYS_OBJECT", "sfl-api-keys.json")
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
    module.FARM_SYNC_FUNCTION = "pj007-test-farm-sync"
    module.SECRETS_BUCKET = "pj007-test-secrets"
    module._sfl_keys = lambda: ["test-key"]
    module.build_sfl_client = lambda *args, **kwargs: client
    module._make_client = lambda: client
    return module


class FakeContext:
    def __init__(self, remaining: list[int]):
        self.remaining = list(remaining)

    def get_remaining_time_in_millis(self) -> int:
        if self.remaining:
            return self.remaining.pop(0)
        return 0


def test_farm_sync_source_uses_key_pool_and_never_hardcodes_sfl_host():
    source = (ROOT / "lambda_functions" / "farm_sync" / "app.py").read_text()
    assert "build_sfl_client" in source
    assert "load_sfl_keys" in source
    assert "SECRETS_BUCKET" in source
    assert "SFL_API_KEY" not in source
    assert "api.sunflower-land.com" not in source


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


def test_low_remaining_time_invokes_continuation_and_skips_finalize(aws_env, monkeypatch):
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
    invokes: list[dict] = []

    def fake_invoke(payload):
        invokes.append(payload)
        return True

    app._invoke_continuation = fake_invoke
    registry = FarmRegistry(aws_env["bucket"])
    registry.upsert("1", name="done")
    registry.upsert("2", name="short")
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
    first = app.lambda_handler(
        {"source": "aws.events", "time": "2026-08-14T23:00:00Z"},
        FakeContext([50_000]),
    )
    assert first["continued"] is True
    assert first["finalized"] is not True
    assert first["after_farm_id"] == "1"
    assert first["invoked"] is True
    assert client.called == ["1"]
    assert store.get_score("2") is None
    payload = invokes[0]
    assert payload["source"] == "farm-sync-continue"
    assert payload["after_farm_id"] == "1"
    assert payload["chunk"] == 2
    assert payload["now"] == "2026-08-14T23:00:00Z"
    assert payload["cooldown_seconds"] == 10

    payload["cooldown_seconds"] = 0
    second = app.lambda_handler(payload, FakeContext([900_000, 900_000]))
    assert second["continued"] is False
    assert second["finalized"] is True
    assert client.called == ["1", "2"]
    assert store.get_score("2")["digs_to_third_op"] == 40
    assert len(invokes) == 1


def test_context_none_still_walks_the_whole_roster(aws_env, monkeypatch):
    client = FakeClient(
        {
            "1": _grid_payload([shovel()]),
            "2": _grid_payload([shovel()]),
        }
    )
    app = _load_sync(aws_env, monkeypatch, client)
    invokes: list[dict] = []
    app._invoke_continuation = lambda payload: invokes.append(payload) or True
    registry = FarmRegistry(aws_env["bucket"])
    registry.upsert("1", name="one")
    registry.upsert("2", name="two")
    result = app.lambda_handler({"source": "schedule"}, None)
    assert result["synced"] == 2
    assert result.get("continued") is not True
    assert invokes == []


def test_empty_roster_succeeds_without_sfl_keys(aws_env, monkeypatch):
    client = FakeClient({})
    app = _load_sync(aws_env, monkeypatch, client)
    app._sfl_keys = lambda: []
    result = app.lambda_handler({"source": "schedule"}, None)
    assert result["synced"] == 0
    assert result.get("continued") is not True
    assert client.called == []


def test_template_lets_farm_sync_invoke_itself():
    template = (ROOT / "template.yaml").read_text()
    assert "PolicyName: FarmSyncSelfInvoke" in template
    assert "FARM_SYNC_FUNCTION:" in template
    assert "lambda:InvokeFunction" in template
    assert "SecretsBucket:" in template
    assert "SECRETS_BUCKET:" in template
    farm_sync = template.split("FarmSyncFunction:", 1)[1].split("GitHubActionsDeployRole:", 1)[0]
    assert "FARM_SYNC_FUNCTION:" in farm_sync
    assert "Timeout: 900" in farm_sync
    assert "sfl-api-keys.json" in farm_sync
