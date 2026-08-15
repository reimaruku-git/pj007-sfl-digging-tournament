"""Scheduled / on-demand farm sync.

Reads Farm IDs from the S3 JSON registry, walks them with a 10–15s delay
between Community API calls, writes scores + the leaderboard cache.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from datetime import datetime, timezone

from tournament.farms import FarmRegistry
from tournament.sfl_client import RateLimitedSFLClient
from tournament.store import Store
from tournament.sync import drop_untracked_scores, parse_iso, refresh_leaderboard, sync_all_farms, sync_one_farm

logger = logging.getLogger()
logger.setLevel(logging.INFO)

DATA_BUCKET = os.environ.get("DATA_BUCKET", "")
CONFIG_TABLE = os.environ.get("CONFIG_TABLE", "")
SCORES_TABLE = os.environ.get("SCORES_TABLE", "")
SUBMISSIONS_TABLE = os.environ.get("SUBMISSIONS_TABLE", "")
SFL_API_KEY = os.environ.get("SFL_API_KEY", "")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")
SFL_MIN_INTERVAL_SECONDS = float(os.environ.get("SFL_MIN_INTERVAL_SECONDS", "12"))


def _event_farm_id(event: dict[str, Any] | None) -> str:
    payload = event or {}
    return str(payload.get("farm_id") or "").strip()


def _event_now(event: dict[str, Any] | None) -> datetime:
    payload = event or {}
    for key in ("now", "time"):
        parsed = parse_iso(payload.get(key) if isinstance(payload.get(key), str) else None)
        if parsed is not None:
            return parsed
    return datetime.now(timezone.utc)


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    logger.info("farm_sync start: %s", event)
    store = Store(
        config_table=CONFIG_TABLE,
        scores_table=SCORES_TABLE,
        submissions_table=SUBMISSIONS_TABLE,
        data_bucket=DATA_BUCKET,
    )
    registry = FarmRegistry(DATA_BUCKET)
    client = RateLimitedSFLClient(
        SFL_API_KEY,
        min_interval_seconds=max(SFL_MIN_INTERVAL_SECONDS, 10),
    )
    clock = _event_now(event)
    from tournament.catalog import rollover

    farm_id = _event_farm_id(event)
    dropped = drop_untracked_scores(store, registry)
    if dropped:
        logger.info("farm_sync dropped untracked scores: %s", dropped)
    if not farm_id:
        rollover(store, now=clock)
    if farm_id:
        farm = registry.get(farm_id)
        if not farm:
            logger.info("farm_sync skip: farm %s is not tracked", farm_id)
            return {"synced": 0, "failures": 0, "skipped": "not_tracked", "farm_id": farm_id}
        row = sync_one_farm(store, client, farm, now=clock, finalize=False)
        refresh_leaderboard(store, registry=registry)
        failed = bool(row.get("error"))
        logger.info("farm_sync one farm %s error=%s", farm_id, row.get("error"))
        return {
            "synced": 0 if failed else 1,
            "failures": 1 if failed else 0,
            "farm_id": farm_id,
        }

    result = sync_all_farms(
        store,
        registry,
        client,
        webhook_url=DISCORD_WEBHOOK_URL,
        now=clock,
    )
    from tournament.archive import archive_current

    archive_current(store, now=clock)
    logger.info(
        "farm_sync done: synced=%s failures=%s finalized=%s",
        result.get("synced"),
        result.get("failures"),
        result.get("finalized"),
    )
    return {
        "synced": result.get("synced"),
        "failures": result.get("failures"),
        "finalized": result.get("finalized"),
    }
