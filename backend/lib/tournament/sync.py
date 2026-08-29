"""Refresh farm scores from the SFL Community API and rebuild the cache."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any
from urllib import error, request

from tournament.event_settings import public_event_settings
from tournament.farms import FarmRegistry, utc_now_iso
from tournament.history import (
    recover_daily_history,
    finalize_today,
    write_today_from_computed,
    put_farm_day,
    day_record_from_computed,
    rebuild_score_from_days,
    days_in_window,
)
from tournament.leaderboard import build_leaderboard
from tournament.membership import (
    enrolled_farm_ids,
    farm_live_tournament_ids,
    farms_due_for_sync,
    seed_legacy_roster,
)
from tournament.scoring import (
    extract_grid,
    extract_island,
    extract_streak,
    extract_vip,
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
    extras = public_event_settings(config)
    if start is None or end is None or end <= start:
        payload = {
            "tournament_id": str(config.get("current_tournament_id") or "").strip(),
            "name": str(config.get("name") or "").strip(),
            "start_at": None,
            "end_at": None,
            "duration_days": 0,
            "prize_amount": str(config.get("prize_amount") or "30"),
            "status": "scheduled",
            "last_full_sync_at": config.get("last_full_sync_at"),
            "updated_at": config.get("updated_at"),
            "featured_tournament_id": str(config.get("featured_tournament_id") or "").strip()
            or None,
        }
        payload.update(extras)
        return payload
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
    payload = {
        "tournament_id": tid,
        "name": name,
        "start_at": config.get("start_at"),
        "end_at": config.get("end_at"),
        "duration_days": days,
        "prize_amount": str(config.get("prize_amount") or "30"),
        "status": config.get("status") or "scheduled",
        "last_full_sync_at": config.get("last_full_sync_at"),
        "updated_at": config.get("updated_at"),
        "featured_tournament_id": str(config.get("featured_tournament_id") or "").strip() or None,
    }
    payload.update(extras)
    return payload


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


def _event_board_rows(
    store: Store,
    event: dict[str, Any],
    *,
    registry=None,
    now: datetime | None = None,
) -> tuple[list[dict[str, Any]], int]:
    tid = str(event.get("tournament_id") or "").strip()
    days = int(event.get("duration_days") or 0) or configured_duration_days(event)
    window_start = parse_iso(event.get("start_at"))
    window_end = parse_iso(event.get("end_at"))
    enrolled = enrolled_farm_ids(store, tid) if event.get("roster_seeded") else None
    tracked = registry.farm_ids(active_only=True) if registry is not None else None
    scores = {str(row.get("farm_id") or ""): row for row in store.list_event_scores(tid)}
    if not scores:
        scores = {str(row.get("farm_id") or ""): row for row in store.list_scores()}
    farm_ids = set(enrolled) if enrolled is not None else set(scores)
    if tracked is not None:
        farm_ids = {fid for fid in farm_ids if fid in tracked}
    farm_ids.discard("")
    rows: list[dict[str, Any]] = []
    for farm_id in farm_ids:
        row = scores.get(farm_id)
        if row is None:
            from tournament.history import rebuild_score_from_days

            name = ""
            if registry is not None:
                tracked_row = registry.get(farm_id) or {}
                name = str(tracked_row.get("name") or "")
            row = rebuild_score_from_days(
                store,
                farm_id,
                name=name,
                now=now,
                window_start=window_start,
                window_end=window_end,
                tournament_id=tid,
                allow_stored_fallback=False,
                persist_featured=False,
            )
        rows.append(row)
    return rows, days


def refresh_leaderboard(
    store: Store,
    *,
    now: datetime | None = None,
    registry=None,
    tournament_id: str | None = None,
) -> dict[str, Any]:
    recover_daily_history(store, now=now)
    if registry is not None:
        seed_legacy_roster(store, registry)
    config = store.get_config()
    wanted = str(tournament_id or "").strip()
    live = [item for item in store.list_tournament_items() if item.get("status") == "active"]
    if wanted:
        event = store.get_tournament(wanted)
        if event:
            rows, days = _event_board_rows(store, event, registry=registry, now=now)
            board = build_leaderboard(rows, tournament_days=days)
            stored = store.put_event_leaderboard(wanted, board)
            featured_id = str(config.get("current_tournament_id") or "").strip()
            if wanted == featured_id:
                store.put_leaderboard_cache(board)
            return stored

    if live:
        featured_board: dict[str, Any] | None = None
        featured_id = str(config.get("current_tournament_id") or "").strip()
        if not featured_id and live:
            featured_id = str(
                sorted(live, key=lambda item: str(item.get("end_at") or ""))[0].get("tournament_id")
                or ""
            )
        for event in live:
            tid = str(event.get("tournament_id") or "").strip()
            rows, days = _event_board_rows(store, event, registry=registry, now=now)
            board = build_leaderboard(rows, tournament_days=days)
            store.put_event_leaderboard(tid, board)
            if tid == featured_id:
                featured_board = store.put_leaderboard_cache(board)
        if featured_board is not None:
            return featured_board

    days = configured_duration_days(config)
    rows = store.list_scores()
    if registry is not None:
        allowed = registry.farm_ids(active_only=True)
        rows = [row for row in rows if str(row.get("farm_id") or "") in allowed]
    tid = str(config.get("current_tournament_id") or "").strip()
    event = store.get_tournament(tid) if tid else None
    if tid and event and event.get("roster_seeded"):
        enrolled = enrolled_farm_ids(store, tid)
        rows = [row for row in rows if str(row.get("farm_id") or "") in enrolled]
    board = build_leaderboard(rows, tournament_days=days)
    if tid:
        store.put_event_leaderboard(tid, board)
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


def rescore_from_snapshots(
    store: Store,
    *,
    now: datetime | None = None,
    finalize: bool | None = None,
) -> dict[str, Any]:
    """Re-run score_grid on stored per-day grids using the current window.

    Farms with no snapshot and no day history are counted in
    ``missing_snapshots`` and left as-is until the next live SFL fetch.

    When ``finalize`` is true (or the clock is 23:00 UTC or later), only
    **today's** day is cut off at 23:00 and incompletes get that day's
    penalty. Earlier finalized days are left alone.
    """
    clock = now or datetime.now(timezone.utc)
    do_finalize = is_finalize_clock(clock) if finalize is None else finalize
    recover_daily_history(store, now=clock)
    config = ensure_default_config(store, now=clock)
    window_start, window_end = resolve_scoring_windows(config, clock, finalize=False)
    today = (
        clock.date().isoformat()
        if clock.tzinfo
        else clock.replace(tzinfo=timezone.utc).date().isoformat()
    )
    rescored = 0
    missing = 0
    for row in store.list_scores():
        farm_id = str(row.get("farm_id") or "").strip()
        if not farm_id:
            continue
        snapshot = store.read_snapshot(farm_id)
        history = days_in_window(store, farm_id, start=window_start, end=window_end)
        if not history:
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
            write_today_from_computed(
                store,
                farm_id=farm_id,
                name=str(row.get("name") or ""),
                computed=computed,
                previous=row,
                now=clock,
                grid=grid,
            )
            updated = dict(snapshot)
            updated["score"] = computed.to_dict()
            store.write_snapshot(farm_id, updated)
            rescored += 1
            continue
        changed = False
        for record in history:
            day_key = str(record.get("day") or "")
            if record.get("finalized") and day_key != today:
                continue
            grid = record.get("grid")
            if not isinstance(grid, list) and len(history) == 1:
                grid = snapshot.get("grid") if isinstance(snapshot, dict) else None
            if not isinstance(grid, list):
                continue
            computed = score_grid(
                grid,
                now=clock,
                window_start=window_start,
                window_end=window_end,
            )
            put_farm_day(
                store,
                farm_id,
                day_key or today,
                day_record_from_computed(day_key or today, computed, grid=grid),
                overwrite_finalized=False,
            )
            changed = True
        if changed:
            rebuild_score_from_days(
                store,
                farm_id,
                name=str(row.get("name") or ""),
                previous=row,
                now=clock,
            )
            rescored += 1
        else:
            missing += 1
    highest = None
    if do_finalize:
        window_start, cutoff_end = resolve_scoring_windows(config, clock, finalize=True)
        finalized = finalize_today(
            store, now=clock, window_start=window_start, window_end=cutoff_end
        )
        highest = finalized.get("highest_completed")
    refresh_leaderboard(store, now=clock)
    return {
        "rescored": rescored,
        "missing_snapshots": missing,
        "finalized": do_finalize,
        "highest_completed": highest,
    }


def apply_day_finalize(store: Store, *, now: datetime | None = None) -> dict[str, Any]:
    """Re-score today's day with the 23:00 cutoff and assign that day's penalties.

    Safe to run twice on the same day — scores stay the same. Earlier days
    are not rewritten.
    """
    return rescore_from_snapshots(store, now=now, finalize=True)


def apply_live_event_scores(
    store: Store,
    *,
    farm_id: str,
    name: str,
    now: datetime | None = None,
    error: str | None = None,
) -> None:
    clock = now or datetime.now(timezone.utc)
    featured_id = str(store.get_config().get("current_tournament_id") or "").strip()
    for tid in farm_live_tournament_ids(store, farm_id):
        event = store.get_tournament(tid)
        if not event:
            continue
        rebuild_score_from_days(
            store,
            farm_id,
            name=name,
            error=error,
            now=clock,
            window_start=parse_iso(event.get("start_at")),
            window_end=parse_iso(event.get("end_at")),
            tournament_id=tid,
            allow_stored_fallback=tid == featured_id,
            persist_featured=tid == featured_id,
        )


def apply_computed_score(
    store: Store,
    *,
    farm_id: str,
    name: str,
    computed,
    previous: dict[str, Any] | None = None,
    error: str | None = None,
    now: datetime | None = None,
    grid: Any = None,
) -> dict[str, Any]:
    clock = now or datetime.now(timezone.utc)
    prior = previous or store.get_score(farm_id) or {}
    row = write_today_from_computed(
        store,
        farm_id=farm_id,
        name=name,
        computed=computed,
        previous=prior,
        now=clock,
        grid=grid,
        error=error,
    )
    apply_live_event_scores(store, farm_id=farm_id, name=name, now=clock, error=error)
    return row


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
        streak = extract_streak(payload)
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
                "streak": streak,
                "digging_streak": streak["count"],
                "island": extract_island(payload),
                "vip": extract_vip(payload, now=clock),
                "score": computed.to_dict(),
            },
        )
        row = apply_computed_score(
            store,
            farm_id=farm_id,
            name=name,
            computed=computed,
            previous=previous,
            now=clock,
            grid=grid,
        )
        return row
    except SFLApiError as exc:
        logger.error("Failed to fetch farm %s: %s", farm_id, exc)
        if store.list_farm_days(farm_id):
            rebuilt = rebuild_score_from_days(
                store,
                farm_id,
                name=name,
                previous=previous,
                error=str(exc),
                now=clock,
            )
            apply_live_event_scores(store, farm_id=farm_id, name=name, now=clock, error=str(exc))
            return rebuilt
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


def farms_after_cursor(
    farms: list[dict[str, Any]], after_farm_id: str | None
) -> list[dict[str, Any]]:
    """Return roster farms after ``after_farm_id``, in the same order.

    A missing cursor logs a warning and returns the full list so a stale
    continuation still makes progress instead of hanging.
    """
    wanted = str(after_farm_id or "").strip()
    if not wanted:
        return list(farms)
    ids = [str(farm.get("farm_id") or "") for farm in farms]
    try:
        index = ids.index(wanted)
    except ValueError:
        logger.warning(
            "sync cursor farm %s is not on the roster; starting from the top",
            wanted,
        )
        return list(farms)
    return list(farms[index + 1 :])


def sync_all_farms(
    store: Store,
    registry: FarmRegistry,
    client: RateLimitedSFLClient,
    *,
    webhook_url: str = "",
    now: datetime | None = None,
    after_farm_id: str | None = None,
    should_stop: Callable[[], bool] | None = None,
    previous_leader_farm_id: Any = None,
    use_cached_leader: bool = True,
) -> dict[str, Any]:
    clock = now or datetime.now(timezone.utc)
    ensure_default_config(store, now=clock)
    recover_daily_history(store, now=clock)
    previous_cache = store.get_leaderboard_cache() or {}
    if use_cached_leader:
        previous_leader = previous_cache.get("leader_farm_id")
    else:
        previous_leader = previous_leader_farm_id
    finalize = is_finalize_clock(clock)

    seed_legacy_roster(store, registry)
    catalog = store.list_tournament_items()
    gated = any(
        item.get("roster_seeded") and item.get("status") in {"active", "scheduled"}
        for item in catalog
    )
    if gated:
        farms = farms_due_for_sync(store, registry)
    else:
        farms = registry.list_farms(active_only=True)
    queue = farms_after_cursor(farms, after_farm_id)
    results: list[dict[str, Any]] = []
    failures = 0
    stopped = False
    last_id = str(after_farm_id or "").strip() or None
    for index, farm in enumerate(queue):
        if index > 0 and should_stop is not None and should_stop():
            stopped = True
            break
        row = sync_one_farm(store, client, farm, now=clock, finalize=finalize)
        last_id = str(farm["farm_id"])
        if row.get("error"):
            failures += 1
        results.append(row)

    remaining = max(0, len(queue) - len(results))
    cache = refresh_leaderboard(store, registry=registry)
    if stopped:
        logger.info(
            "sync_all_farms pausing after %s with %s farms remaining",
            last_id,
            remaining,
        )
        return {
            "synced": len(results),
            "failures": failures,
            "farms": results,
            "leaderboard": cache,
            "config": public_config(store.get_config()),
            "finalized": False,
            "continued": True,
            "complete": False,
            "after_farm_id": last_id,
            "remaining": remaining,
        }

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
        "continued": False,
        "complete": True,
        "after_farm_id": None,
        "remaining": 0,
    }
