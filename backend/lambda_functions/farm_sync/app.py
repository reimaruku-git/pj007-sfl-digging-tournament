"""Scheduled / on-demand farm sync.

Walks farms that are enrolled in at least one live event (and still
active in the S3 registry). SFL keys are a JSON list in the private
secrets bucket. A successful pass through every key waits 10s before
the next fetch; 429/403 keep the longer backoff.

A sweep is capped at 15 minutes (Lambda max). Before the remaining time
falls under ``STOP_REMAINING_MS``, this function async-invokes itself
with ``after_farm_id`` and the frozen ``now`` so a 23:00 finalize still
applies on the last chunk. Two SFL keys still take turns in one process;
chunks are sequential so the keys never overlap across Lambdas.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

import boto3

from tournament.archive import archive_current
from tournament.catalog import rollover
from tournament.farms import FarmRegistry
from tournament.sfl_client import build_sfl_client, load_sfl_keys
from tournament.store import Store
from tournament.membership import farm_live_tournament_ids
from tournament.scoring import is_finalize_clock
from tournament.sync import (
    apply_day_finalize,
    drop_untracked_scores,
    parse_iso,
    refresh_leaderboard,
    sync_all_farms,
    sync_one_farm,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

DATA_BUCKET = os.environ.get("DATA_BUCKET", "")
CONFIG_TABLE = os.environ.get("CONFIG_TABLE", "")
SCORES_TABLE = os.environ.get("SCORES_TABLE", "")
SUBMISSIONS_TABLE = os.environ.get("SUBMISSIONS_TABLE", "")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")
SFL_MIN_INTERVAL_SECONDS = float(os.environ.get("SFL_MIN_INTERVAL_SECONDS", "12"))
SFL_SUCCESS_ROUND_SECONDS = float(os.environ.get("SFL_SUCCESS_ROUND_SECONDS", "10"))
FARM_SYNC_FUNCTION = os.environ.get("FARM_SYNC_FUNCTION", "")
SECRETS_BUCKET = os.environ.get("SECRETS_BUCKET", "")
SFL_KEYS_OBJECT = os.environ.get("SFL_KEYS_OBJECT", "sfl-api-keys.json")

# Leave enough room for one in-flight fetch (wait + HTTP + retries),
# Dynamo/S3 writes, and the continuation invoke.
STOP_REMAINING_MS = 90_000
MAX_CHUNKS = 40

_lambda = None
_sleeper = time.sleep


def _lambda_client():
    global _lambda
    if _lambda is None:
        _lambda = boto3.client("lambda")
    return _lambda


def _event_farm_id(event: dict[str, Any] | None) -> str:
    payload = event or {}
    return str(payload.get("farm_id") or "").strip()


def _event_after_farm_id(event: dict[str, Any] | None) -> str:
    payload = event or {}
    return str(payload.get("after_farm_id") or "").strip()


def _event_chunk(event: dict[str, Any] | None) -> int:
    payload = event or {}
    try:
        return max(1, int(payload.get("chunk") or 1))
    except (TypeError, ValueError):
        return 1


def _event_now(event: dict[str, Any] | None) -> datetime:
    payload = event or {}
    for key in ("now", "time"):
        parsed = parse_iso(payload.get(key) if isinstance(payload.get(key), str) else None)
        if parsed is not None:
            return parsed
    return datetime.now(timezone.utc)


def _frozen_now_iso(clock: datetime) -> str:
    utc = clock if clock.tzinfo else clock.replace(tzinfo=timezone.utc)
    return utc.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _remaining_ms(context: Any) -> int | None:
    if context is None:
        return None
    getter = getattr(context, "get_remaining_time_in_millis", None)
    if getter is None:
        return None
    try:
        return int(getter())
    except (TypeError, ValueError):
        return None


def _should_stop(context: Any) -> bool:
    remaining = _remaining_ms(context)
    if remaining is None:
        return False
    return remaining < STOP_REMAINING_MS


def _cooldown_seconds(event: dict[str, Any] | None) -> float:
    payload = event or {}
    if "cooldown_seconds" in payload:
        try:
            return max(0.0, float(payload.get("cooldown_seconds")))
        except (TypeError, ValueError):
            return 0.0
    if _event_after_farm_id(payload):
        return max(SFL_SUCCESS_ROUND_SECONDS, 10)
    return 0.0


def _sweep_leader_baseline(event: dict[str, Any] | None, store: Store) -> str:
    payload = event or {}
    if "notify_leader_farm_id" in payload:
        return str(payload.get("notify_leader_farm_id") or "")
    cache = store.get_leaderboard_cache() or {}
    return str(cache.get("leader_farm_id") or "")


def _sfl_keys() -> list[str]:
    return load_sfl_keys(SECRETS_BUCKET, SFL_KEYS_OBJECT)


def _make_client():
    return build_sfl_client(
        _sfl_keys(),
        min_interval_seconds=max(SFL_MIN_INTERVAL_SECONDS, 10),
        success_round_seconds=max(SFL_SUCCESS_ROUND_SECONDS, 10),
    )


def _invoke_continuation(payload: dict[str, Any]) -> bool:
    if not FARM_SYNC_FUNCTION:
        logger.error("farm_sync continue skipped: FARM_SYNC_FUNCTION is not set")
        return False
    try:
        _lambda_client().invoke(
            FunctionName=FARM_SYNC_FUNCTION,
            InvocationType="Event",
            Payload=json.dumps(payload),
        )
        return True
    except Exception:
        logger.exception("farm_sync continue invoke failed")
        return False


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    logger.info("farm_sync start: %s", event)
    store = Store(
        config_table=CONFIG_TABLE,
        scores_table=SCORES_TABLE,
        submissions_table=SUBMISSIONS_TABLE,
        data_bucket=DATA_BUCKET,
    )
    registry = FarmRegistry(DATA_BUCKET)
    client = _make_client()
    clock = _event_now(event)
    farm_id = _event_farm_id(event)
    after_farm_id = _event_after_farm_id(event)
    chunk = _event_chunk(event)
    dropped = drop_untracked_scores(store, registry)
    if dropped:
        logger.info("farm_sync dropped untracked scores: %s", dropped)
    if not farm_id and not after_farm_id:
        rollover(store, now=clock)
    if farm_id:
        farm = registry.get(farm_id)
        if not farm:
            logger.info("farm_sync skip: farm %s is not tracked", farm_id)
            return {"synced": 0, "failures": 0, "skipped": "not_tracked", "farm_id": farm_id}
        live = [item for item in store.list_tournament_items() if item.get("status") == "active"]
        seeded_live = [item for item in live if item.get("roster_seeded")]
        if seeded_live and not farm_live_tournament_ids(store, farm_id):
            logger.info("farm_sync skip: farm %s is not enrolled in a live event", farm_id)
            return {"synced": 0, "failures": 0, "skipped": "not_enrolled", "farm_id": farm_id}
        finalize = is_finalize_clock(clock)
        row = sync_one_farm(store, client, farm, now=clock, finalize=finalize)
        if finalize:
            apply_day_finalize(store, now=clock)
        refresh_leaderboard(store, registry=registry)
        failed = bool(row.get("error"))
        logger.info("farm_sync one farm %s error=%s", farm_id, row.get("error"))
        return {
            "synced": 0 if failed else 1,
            "failures": 1 if failed else 0,
            "farm_id": farm_id,
        }

    wait = _cooldown_seconds(event)
    if wait > 0:
        logger.info("farm_sync continuation cooldown %.1fs after %s", wait, after_farm_id)
        _sleeper(wait)

    original_leader = _sweep_leader_baseline(event, store)
    result = sync_all_farms(
        store,
        registry,
        client,
        webhook_url=DISCORD_WEBHOOK_URL,
        now=clock,
        after_farm_id=after_farm_id or None,
        should_stop=lambda: _should_stop(context),
        previous_leader_farm_id=original_leader or None,
        use_cached_leader=False,
    )
    if result.get("continued"):
        if chunk >= MAX_CHUNKS:
            logger.error(
                "farm_sync hit max chunks=%s after farm %s remaining=%s",
                chunk,
                result.get("after_farm_id"),
                result.get("remaining"),
            )
            return {
                "synced": result.get("synced"),
                "failures": result.get("failures"),
                "finalized": False,
                "continued": False,
                "truncated": True,
                "after_farm_id": result.get("after_farm_id"),
                "chunk": chunk,
                "remaining": result.get("remaining"),
            }
        frozen = _frozen_now_iso(clock)
        invoked = _invoke_continuation(
            {
                "source": "farm-sync-continue",
                "after_farm_id": result.get("after_farm_id"),
                "now": frozen,
                "time": frozen,
                "chunk": chunk + 1,
                "notify_leader_farm_id": original_leader,
                "cooldown_seconds": max(SFL_SUCCESS_ROUND_SECONDS, 10),
            }
        )
        logger.info(
            "farm_sync continue after %s chunk=%s invoked=%s remaining=%s skipped=%s",
            result.get("after_farm_id"),
            chunk,
            invoked,
            result.get("remaining"),
            result.get("skipped"),
        )
        return {
            "synced": result.get("synced"),
            "failures": result.get("failures"),
            "skipped": result.get("skipped"),
            "finalized": False,
            "continued": True,
            "after_farm_id": result.get("after_farm_id"),
            "chunk": chunk,
            "remaining": result.get("remaining"),
            "invoked": invoked,
        }

    archive_current(store, now=clock)
    logger.info(
        "farm_sync done: synced=%s skipped=%s failures=%s finalized=%s chunk=%s",
        result.get("synced"),
        result.get("skipped"),
        result.get("failures"),
        result.get("finalized"),
        chunk,
    )
    return {
        "synced": result.get("synced"),
        "failures": result.get("failures"),
        "skipped": result.get("skipped"),
        "finalized": result.get("finalized"),
        "continued": False,
        "chunk": chunk,
    }
