"""Scheduled / on-demand farm sync.

Reads Farm IDs from the S3 JSON registry, walks them with a 10–15s delay
between Community API calls, writes scores + the leaderboard cache.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from tournament.farms import FarmRegistry
from tournament.sfl_client import RateLimitedSFLClient
from tournament.store import Store
from tournament.sync import sync_all_farms

logger = logging.getLogger()
logger.setLevel(logging.INFO)

DATA_BUCKET = os.environ.get("DATA_BUCKET", "")
CONFIG_TABLE = os.environ.get("CONFIG_TABLE", "")
SCORES_TABLE = os.environ.get("SCORES_TABLE", "")
SUBMISSIONS_TABLE = os.environ.get("SUBMISSIONS_TABLE", "")
SFL_API_KEY = os.environ.get("SFL_API_KEY", "")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")
SFL_MIN_INTERVAL_SECONDS = float(os.environ.get("SFL_MIN_INTERVAL_SECONDS", "12"))


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
    result = sync_all_farms(
        store,
        registry,
        client,
        webhook_url=DISCORD_WEBHOOK_URL,
    )
    logger.info(
        "farm_sync done: synced=%s failures=%s",
        result.get("synced"),
        result.get("failures"),
    )
    return {
        "synced": result.get("synced"),
        "failures": result.get("failures"),
    }
