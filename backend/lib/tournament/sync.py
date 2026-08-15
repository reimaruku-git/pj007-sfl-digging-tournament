"""Refresh farm scores from the SFL Community API and rebuild the cache."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib import error, request

from tournament.farms import FarmRegistry, utc_now_iso
from tournament.leaderboard import build_leaderboard
from tournament.scoring import extract_grid, score_grid
from tournament.sfl_client import RateLimitedSFLClient, SFLApiError
from tournament.store import MIN_TOURNAMENT_DAYS, Store

logger = logging.getLogger(__name__)


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def ensure_default_config(store: Store, *, now: datetime | None = None) -> dict[str, Any]:
    clock = now or datetime.now(timezone.utc)
    existing = store.get_config()
    start = parse_iso(existing.get("start_at"))
    end = parse_iso(existing.get("end_at"))
    if start and end and end > start:
        existing["status"] = tournament_status(start, end, clock)
        return existing
    start = clock
    end = clock + timedelta(days=MIN_TOURNAMENT_DAYS)
    config = {
        "start_at": start.isoformat(),
        "end_at": end.isoformat(),
        "prize_amount": str(existing.get("prize_amount") or "30"),
        "status": tournament_status(start, end, clock),
        "last_full_sync_at": existing.get("last_full_sync_at"),
        "leader_farm_id": existing.get("leader_farm_id"),
    }
    return store.put_config(config)


def tournament_status(start: datetime, end: datetime, now: datetime) -> str:
    if now < start:
        return "scheduled"
    if now > end:
        return "ended"
    return "active"


def public_config(config: dict[str, Any]) -> dict[str, Any]:
    return {
        "start_at": config.get("start_at"),
        "end_at": config.get("end_at"),
        "prize_amount": str(config.get("prize_amount") or "30"),
        "status": config.get("status") or "scheduled",
        "last_full_sync_at": config.get("last_full_sync_at"),
        "updated_at": config.get("updated_at"),
    }


def refresh_leaderboard(store: Store) -> dict[str, Any]:
    rows = store.list_scores()
    board = build_leaderboard(rows)
    cached = store.put_leaderboard_cache(board)
    return cached


def rescore_from_snapshots(
    store: Store,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Re-run score_grid on stored snapshots using the current tournament window.

    Farms with no snapshot are counted in ``missing_snapshots`` and left as-is
    until the next live SFL fetch.
    """
    clock = now or datetime.now(timezone.utc)
    config = ensure_default_config(store, now=clock)
    window_start = parse_iso(config.get("start_at"))
    window_end = parse_iso(config.get("end_at"))
    rescored = 0
    missing = 0
    for row in store.list_scores():
        farm_id = str(row.get("farm_id") or "").strip()
        if not farm_id:
            continue
        snapshot = store.read_snapshot(farm_id)
        grid = snapshot.get("grid") if isinstance(snapshot, dict) else None
        if not isinstance(grid, list):
            missing += 1
            continue
        computed = score_grid(
            grid,
            now=clock,
            window_start=window_start,
            window_end=window_end,
        )
        apply_computed_score(
            store,
            farm_id=farm_id,
            name=str(row.get("name") or ""),
            computed=computed,
            previous=row,
        )
        updated = dict(snapshot)
        updated["score"] = computed.to_dict()
        store.write_snapshot(farm_id, updated)
        rescored += 1
    refresh_leaderboard(store)
    return {"rescored": rescored, "missing_snapshots": missing}


def apply_computed_score(
    store: Store,
    *,
    farm_id: str,
    name: str,
    computed,
    previous: dict[str, Any] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    prior = previous or store.get_score(farm_id) or {}
    row = {
        "farm_id": farm_id,
        "name": name,
        "digs_to_third_op": computed.digs_to_third_op,
        "otter_count": computed.otter_count,
        "total_digs": computed.total_digs,
        "digs_today": computed.digs_today,
        "status": computed.status,
        "third_op_at": computed.third_op_at,
        "invalidated": bool(prior.get("invalidated")),
        "override_digs_to_third_op": prior.get("override_digs_to_third_op"),
        "override_reason": prior.get("override_reason"),
        "error": error,
    }
    return store.put_score(row)


def sync_one_farm(
    store: Store,
    client: RateLimitedSFLClient,
    farm: dict[str, Any],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    farm_id = str(farm["farm_id"])
    name = farm.get("name") or ""
    config = ensure_default_config(store, now=now)
    window_start = parse_iso(config.get("start_at"))
    window_end = parse_iso(config.get("end_at"))
    clock = now or datetime.now(timezone.utc)
    previous = store.get_score(farm_id)

    try:
        payload = client.fetch_farm(farm_id)
        grid = extract_grid(payload)
        computed = score_grid(
            grid,
            now=clock,
            window_start=window_start,
            window_end=window_end,
        )
        store.write_snapshot(
            farm_id,
            {
                "farm_id": farm_id,
                "fetched_at": utc_now_iso(),
                "grid": grid,
                "score": computed.to_dict(),
            },
        )
        return apply_computed_score(
            store,
            farm_id=farm_id,
            name=name,
            computed=computed,
            previous=previous,
        )
    except SFLApiError as exc:
        logger.error("Failed to fetch farm %s: %s", farm_id, exc)
        row = previous or store.empty_score(farm_id, name)
        row["name"] = name
        row["error"] = str(exc)
        return store.put_score(row)


def notify_new_leader(webhook_url: str, entry: dict[str, Any]) -> None:
    if not webhook_url:
        return
    name = entry.get("name") or ""
    farm_id = entry.get("farm_id")
    score = entry.get("digs_to_third_op")
    label = f"{name} ({farm_id})" if name else str(farm_id)
    content = (
        f"New digging-tournament leader: **{label}** "
        f"with **{score}** digs to the 3rd Otter Pebble."
    )
    body = json.dumps({"content": content}).encode("utf-8")
    req = request.Request(
        webhook_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=10) as response:
            response.read()
    except error.URLError as exc:
        logger.warning("Discord webhook failed: %s", exc)


def sync_all_farms(
    store: Store,
    registry: FarmRegistry,
    client: RateLimitedSFLClient,
    *,
    webhook_url: str = "",
    now: datetime | None = None,
) -> dict[str, Any]:
    clock = now or datetime.now(timezone.utc)
    ensure_default_config(store, now=clock)
    previous_cache = store.get_leaderboard_cache() or {}
    previous_leader = previous_cache.get("leader_farm_id")

    farms = registry.list_farms(active_only=True)
    results: list[dict[str, Any]] = []
    failures = 0
    for farm in farms:
        row = sync_one_farm(store, client, farm, now=clock)
        if row.get("error"):
            failures += 1
        results.append(row)

    cache = refresh_leaderboard(store)
    store.mark_synced()
    config = store.get_config()
    new_leader = cache.get("leader_farm_id")
    if new_leader and new_leader != previous_leader:
        leader_entry = next(
            (entry for entry in cache.get("entries", []) if entry.get("rank") == 1),
            None,
        )
        if leader_entry and leader_entry.get("status") == "completed":
            notify_new_leader(webhook_url, leader_entry)
            config["leader_farm_id"] = new_leader
            store.put_config(config)

    daily = {
        "captured_at": utc_now_iso(),
        "leaderboard": cache.get("entries", []),
        "count": cache.get("count", 0),
    }
    store.write_daily_snapshot(clock.date().isoformat(), daily)

    return {
        "synced": len(results),
        "failures": failures,
        "farms": results,
        "leaderboard": cache,
        "config": public_config(store.get_config()),
    }
