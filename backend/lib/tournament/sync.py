"""Refresh farm scores from the SFL Community API and rebuild the cache."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any
from urllib import error, request

from tournament.farms import FarmRegistry, utc_now_iso
from tournament.leaderboard import build_leaderboard
from tournament.membership import enrolled_farm_ids, seed_legacy_roster
from tournament.scoring import (
    assign_incomplete_official_scores,
    extract_grid,
    is_finalize_clock,
    score_grid,
    scoring_window_end,
)
from tournament.sfl_client import RateLimitedSFLClient, SFLApiError
from tournament.store import Store
from tournament.window import (
    configured_duration_days,
    default_tournament_name,
    duration_days,
    parse_iso,
    tournament_id,
)

logger = logging.getLogger(__name__)


def ensure_default_config(store: Store, *, now: datetime | None = None) -> dict[str, Any]:
    """Return the stored window. Do not invent a live tournament from empty config."""
    clock = now or datetime.now(timezone.utc)
    existing = store.get_config()
    start = parse_iso(existing.get("start_at"))
    end = parse_iso(existing.get("end_at"))
    if start and end and end > start:
        existing["status"] = tournament_status(start, end, clock)
        existing["duration_days"] = int(existing.get("duration_days") or 0) or duration_days(
            start, end
        )
        return existing
    existing["status"] = existing.get("status") or "scheduled"
    return existing


def tournament_status(start: datetime, end: datetime, now: datetime) -> str:
    if now < start:
        return "scheduled"
    if now > end:
        return "ended"
    return "active"


def public_config(config: dict[str, Any]) -> dict[str, Any]:
    start = parse_iso(config.get("start_at"))
    end = parse_iso(config.get("end_at"))
    if start is None or end is None or end <= start:
        return {
            "tournament_id": str(config.get("current_tournament_id") or "").strip(),
            "name": str(config.get("name") or "").strip(),
            "start_at": None,
            "end_at": None,
            "duration_days": 0,
            "prize_amount": str(config.get("prize_amount") or "30"),
            "status": "scheduled",
            "last_full_sync_at": config.get("last_full_sync_at"),
            "updated_at": config.get("updated_at"),
        }
    days = int(config.get("duration_days") or 0) or duration_days(start, end)
    tid = str(config.get("current_tournament_id") or config.get("tournament_id") or "").strip()
    if not tid:
        tid = tournament_id(
            {
                "start_at": config.get("start_at"),
                "end_at": config.get("end_at"),
                "duration_days": days,
            }
        )
    name = str(config.get("name") or "").strip() or default_tournament_name(start)
    return {
        "tournament_id": tid,
        "name": name,
        "start_at": config.get("start_at"),
        "end_at": config.get("end_at"),
        "duration_days": days,
        "prize_amount": str(config.get("prize_amount") or "30"),
        "status": config.get("status") or "scheduled",
        "last_full_sync_at": config.get("last_full_sync_at"),
        "updated_at": config.get("updated_at"),
    }


def drop_untracked_scores(store: Store, registry) -> list[str]:
    """Delete score rows whose farm is no longer in the S3 registry."""
    kept = registry.farm_ids(active_only=False)
    dropped: list[str] = []
    for row in store.list_scores():
        farm_id = str(row.get("farm_id") or "").strip()
        if farm_id and farm_id not in kept:
            store.delete_score(farm_id)
            dropped.append(farm_id)
    return dropped


def refresh_leaderboard(
    store: Store, *, now: datetime | None = None, registry=None
) -> dict[str, Any]:
    _ = now
    config = store.get_config()
    days = configured_duration_days(config)
    rows = store.list_scores()
    if registry is not None:
        seed_legacy_roster(store, registry)
        allowed = registry.farm_ids(active_only=True)
        rows = [row for row in rows if str(row.get("farm_id") or "") in allowed]
    tid = str(config.get("current_tournament_id") or "").strip()
    event = store.get_tournament(tid) if tid else None
    if tid and event and event.get("roster_seeded"):
        enrolled = enrolled_farm_ids(store, tid)
        rows = [row for row in rows if str(row.get("farm_id") or "") in enrolled]
    board = build_leaderboard(rows, tournament_days=days)
    cached = store.put_leaderboard_cache(board)
    return cached


def resolve_scoring_windows(
    config: dict[str, Any],
    clock: datetime,
    *,
    finalize: bool,
) -> tuple[datetime | None, datetime | None]:
    window_start = parse_iso(config.get("start_at"))
    window_end = parse_iso(config.get("end_at"))
    if finalize:
        window_end = scoring_window_end(window_end, clock)
    return window_start, window_end


def _apply_incomplete_penalties(store: Store) -> int | None:
    rows = store.list_scores()
    assigned = assign_incomplete_official_scores(rows)
    highest: int | None = None
    for row, updated in zip(rows, assigned):
        if updated.get("status") == "completed" and updated.get("digs_to_third_op") is not None:
            try:
                score = int(updated["digs_to_third_op"])
            except (TypeError, ValueError):
                score = None
            if score is not None:
                highest = score if highest is None else max(highest, score)
        if updated.get("digs_to_third_op") != row.get("digs_to_third_op"):
            store.put_score(updated)
    return highest


def rescore_from_snapshots(
    store: Store,
    *,
    now: datetime | None = None,
    finalize: bool | None = None,
) -> dict[str, Any]:
    """Re-run score_grid on stored snapshots using the current tournament window.

    Farms with no snapshot are counted in ``missing_snapshots`` and left as-is
    until the next live SFL fetch.

    When ``finalize`` is true (or the clock is 23:00 UTC or later), tiles after
    that day's 23:00 are dropped and incompletes get the official penalty score.
    """
    clock = now or datetime.now(timezone.utc)
    do_finalize = is_finalize_clock(clock) if finalize is None else finalize
    config = ensure_default_config(store, now=clock)
    window_start, window_end = resolve_scoring_windows(config, clock, finalize=do_finalize)
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
    highest = _apply_incomplete_penalties(store) if do_finalize else None
    refresh_leaderboard(store)
    return {
        "rescored": rescored,
        "missing_snapshots": missing,
        "finalized": do_finalize,
        "highest_completed": highest,
    }


def apply_day_finalize(store: Store, *, now: datetime | None = None) -> dict[str, Any]:
    """Re-score snapshots with the 23:00 cutoff and assign incomplete penalties.

    Safe to run twice on the same snapshots — scores stay the same.
    """
    return rescore_from_snapshots(store, now=now, finalize=True)


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
        "digs_to_first_op": computed.digs_to_first_op,
        "digs_to_second_op": computed.digs_to_second_op,
        "otter_count": computed.otter_count,
        "total_digs": computed.total_digs,
        "digs_today": computed.digs_today,
        "status": computed.status,
        "first_op_at": computed.first_op_at,
        "second_op_at": computed.second_op_at,
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
    finalize: bool = False,
) -> dict[str, Any]:
    farm_id = str(farm["farm_id"])
    name = farm.get("name") or ""
    clock = now or datetime.now(timezone.utc)
    config = ensure_default_config(store, now=clock)
    window_start, window_end = resolve_scoring_windows(config, clock, finalize=finalize)
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
    finalize = is_finalize_clock(clock)

    farms = registry.list_farms(active_only=True)
    results: list[dict[str, Any]] = []
    failures = 0
    for farm in farms:
        row = sync_one_farm(store, client, farm, now=clock, finalize=finalize)
        if row.get("error"):
            failures += 1
        results.append(row)

    if finalize:
        apply_day_finalize(store, now=clock)
    cache = refresh_leaderboard(store, registry=registry)
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
        "finalized": finalize,
    }
