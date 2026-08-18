"""Per-day farm records for a live tournament.

Sunflower Land's desert grid resets every UTC day. S3 keeps each day.
The live DynamoDB score row is derived from those days: total is the
sum of numeric daily 3rd-OP values, average is that sum divided only
by days that already have a number. Yesterday is never replaced.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from tournament.membership import enrolled_farm_ids
from tournament.scoring import assign_incomplete_official_scores, score_grid
from tournament.stats import iter_window_days
from tournament.store import Store
from tournament.window import parse_iso


def utc_clock(now: datetime | None = None) -> datetime:
    clock = now or datetime.now(timezone.utc)
    if clock.tzinfo is None:
        return clock.replace(tzinfo=timezone.utc)
    return clock.astimezone(timezone.utc)


def scoring_day_key(now: datetime | None, start=None, end=None) -> str:
    """UTC calendar day for a write, clipped into the live window when set."""
    day = utc_clock(now).date()
    if start is not None:
        start_d = start.date() if hasattr(start, "date") else start
        if day < start_d:
            day = start_d
    if end is not None:
        end_d = end.date() if hasattr(end, "date") else end
        if day >= end_d:
            day = end_d - timedelta(days=1)
    return day.isoformat()


def public_day(record: dict[str, Any]) -> dict[str, Any]:
    """Wire shape for one tournament day. No grid."""
    return {
        "day": str(record.get("day") or ""),
        "digs_to_third_op": record.get("digs_to_third_op"),
        "digs_to_first_op": record.get("digs_to_first_op"),
        "digs_to_second_op": record.get("digs_to_second_op"),
        "otter_count": int(record.get("otter_count") or 0),
        "total_digs": int(record.get("total_digs") or 0),
        "digs_today": int(record.get("digs_today") or 0),
        "status": record.get("status") or "not_started",
        "finalized": bool(record.get("finalized")),
        "first_op_at": record.get("first_op_at"),
        "second_op_at": record.get("second_op_at"),
        "third_op_at": record.get("third_op_at"),
    }


def day_record_from_computed(
    day: str,
    computed,
    *,
    finalized: bool = False,
    grid: Any = None,
) -> dict[str, Any]:
    record = {
        "day": day,
        "digs_to_third_op": computed.digs_to_third_op,
        "digs_to_first_op": computed.digs_to_first_op,
        "digs_to_second_op": computed.digs_to_second_op,
        "otter_count": computed.otter_count,
        "total_digs": computed.total_digs,
        "digs_today": computed.digs_today,
        "status": computed.status,
        "finalized": finalized,
        "first_op_at": computed.first_op_at,
        "second_op_at": computed.second_op_at,
        "third_op_at": computed.third_op_at,
    }
    if grid is not None:
        record["grid"] = grid
    return record


def day_record_from_entry(day: str, entry: dict[str, Any], *, finalized: bool) -> dict[str, Any]:
    return {
        "day": day,
        "farm_id": str(entry.get("farm_id") or ""),
        "digs_to_third_op": entry.get("digs_to_third_op"),
        "digs_to_first_op": entry.get("digs_to_first_op"),
        "digs_to_second_op": entry.get("digs_to_second_op"),
        "otter_count": int(entry.get("otter_count") or 0),
        "total_digs": int(entry.get("total_digs") or 0),
        "digs_today": int(entry.get("digs_today") or 0),
        "status": entry.get("status") or "not_started",
        "finalized": finalized,
        "first_op_at": entry.get("first_op_at"),
        "second_op_at": entry.get("second_op_at"),
        "third_op_at": entry.get("third_op_at"),
    }


def put_farm_day(
    store: Store,
    farm_id: str,
    day: str,
    payload: dict[str, Any],
    *,
    overwrite_finalized: bool = False,
) -> dict[str, Any]:
    existing = store.read_farm_day(farm_id, day)
    if existing and existing.get("finalized") and not overwrite_finalized:
        return existing
    stored = dict(payload)
    stored["farm_id"] = str(farm_id)
    stored["day"] = day
    if existing and existing.get("grid") is not None and stored.get("grid") is None:
        stored["grid"] = existing["grid"]
    store.write_farm_day(farm_id, day, stored)
    return stored


def window_day_keys(start: datetime | None, end: datetime | None) -> list[str]:
    if start is None or end is None:
        return []
    return [day.isoformat() for day in iter_window_days(start, end)]


def days_in_window(store: Store, farm_id: str, *, start, end) -> list[dict[str, Any]]:
    rows = store.list_farm_days(farm_id)
    allowed = set(window_day_keys(start, end))
    if allowed:
        rows = [row for row in rows if str(row.get("day") or "") in allowed]
    rows.sort(key=lambda row: str(row.get("day") or ""))
    return rows


def official_day_for_window(
    record: dict[str, Any],
    *,
    window_start,
    window_end,
    now: datetime,
    allow_stored_fallback: bool = True,
) -> dict[str, Any] | None:
    """Score one stored day against a tournament window.

    Prefer the raw grid so two overlapping events can share a file and
    still get different official numbers. Fall back to the stored
    numbers only when this is the featured/legacy window.
    """
    day_key = str(record.get("day") or "")
    if record.get("finalized") and allow_stored_fallback:
        return dict(record)
    grid = record.get("grid")
    if isinstance(grid, list):
        computed = score_grid(
            grid,
            now=now,
            window_start=window_start,
            window_end=window_end,
        )
        return day_record_from_computed(
            day_key,
            computed,
            finalized=bool(record.get("finalized")),
            grid=grid,
        )
    if allow_stored_fallback:
        return dict(record)
    return None


def event_days_for_farm(
    store: Store,
    farm_id: str,
    *,
    window_start,
    window_end,
    now: datetime,
    allow_stored_fallback: bool = True,
    score_end=None,
) -> list[dict[str, Any]]:
    scored: list[dict[str, Any]] = []
    end_for_score = score_end if score_end is not None else window_end
    for record in days_in_window(store, farm_id, start=window_start, end=window_end):
        official = official_day_for_window(
            record,
            window_start=window_start,
            window_end=end_for_score,
            now=now,
            allow_stored_fallback=allow_stored_fallback,
        )
        if official is not None:
            scored.append(official)
    return scored


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _sum_optional(days: list[dict[str, Any]], field: str) -> int | None:
    total = 0
    found = False
    for row in days:
        parsed = _optional_int(row.get(field))
        if parsed is None:
            continue
        total += parsed
        found = True
    return total if found else None


def average_field_days(days: list[dict[str, Any]], field: str) -> dict[str, Any]:
    """Total and mean over days that already have a numeric value for ``field``."""
    values: list[int] = []
    for row in days:
        if not isinstance(row, dict):
            continue
        parsed = _optional_int(row.get(field))
        if parsed is None:
            continue
        values.append(parsed)
    if not values:
        return {"total": None, "average": None, "scored_days": 0}
    total = sum(values)
    return {
        "total": total,
        "average": round(total / len(values), 2),
        "scored_days": len(values),
    }


def average_scored_days(days: list[dict[str, Any]]) -> dict[str, Any]:
    """Total and mean over days that already have a numeric 3rd-OP.

    Mid-day today with ``null`` is omitted. A missed day that already
    has a recorded score (including the 23:00 incomplete penalty) is
    included. Does not divide by the configured tournament length.
    """
    return average_field_days(days, "digs_to_third_op")


def today_live_fields(days: list[dict[str, Any]], today: str | None) -> dict[str, Any]:
    """Today's 3rd-OP and pebble count. Missing today is unscored, not zero."""
    if not today:
        return {"score_today": None, "otter_count": 0, "digs_today": 0}
    record = next(
        (row for row in days if isinstance(row, dict) and str(row.get("day") or "") == today),
        None,
    )
    if record is None:
        return {"score_today": None, "otter_count": 0, "digs_today": 0}
    return {
        "score_today": _optional_int(record.get("digs_to_third_op")),
        "otter_count": int(record.get("otter_count") or 0),
        "digs_today": int(record.get("digs_today") or 0),
    }


def _earliest(days: list[dict[str, Any]], field: str) -> str | None:
    times = [str(row.get(field) or "").strip() for row in days]
    times = [value for value in times if value]
    return min(times) if times else None


def aggregate_days(
    days: list[dict[str, Any]],
    *,
    farm_id: str,
    name: str,
    previous: dict[str, Any] | None = None,
    error: str | None = None,
    today: str | None = None,
) -> dict[str, Any]:
    prior = previous or {}
    latest = days[-1] if days else {}
    derived = average_scored_days(days)
    live = today_live_fields(days, today)
    return {
        "farm_id": str(farm_id),
        "name": name,
        "digs_to_third_op": derived["total"],
        "digs_to_first_op": _sum_optional(days, "digs_to_first_op"),
        "digs_to_second_op": _sum_optional(days, "digs_to_second_op"),
        "otter_count": live["otter_count"],
        "total_digs": sum(int(row.get("total_digs") or 0) for row in days),
        "digs_today": live["digs_today"],
        "score": derived["average"],
        "score_today": live["score_today"],
        "scored_days": derived["scored_days"],
        "status": latest.get("status") or "not_started",
        "first_op_at": _earliest(days, "first_op_at"),
        "second_op_at": _earliest(days, "second_op_at"),
        "third_op_at": _earliest(days, "third_op_at"),
        "invalidated": bool(prior.get("invalidated")),
        "override_digs_to_third_op": prior.get("override_digs_to_third_op"),
        "override_reason": prior.get("override_reason"),
        "error": error,
        "days": [public_day(row) for row in days],
    }


def rebuild_score_from_days(
    store: Store,
    farm_id: str,
    *,
    name: str = "",
    previous: dict[str, Any] | None = None,
    error: str | None = None,
    now: datetime | None = None,
    window_start=None,
    window_end=None,
    tournament_id: str | None = None,
    allow_stored_fallback: bool = True,
    persist_featured: bool = True,
    score_end=None,
) -> dict[str, Any]:
    clock = utc_clock(now)
    config = store.get_config()
    start = window_start if window_start is not None else parse_iso(config.get("start_at"))
    end = window_end if window_end is not None else parse_iso(config.get("end_at"))
    tid = str(tournament_id or "").strip()
    prior = previous
    if prior is None and tid:
        prior = store.get_event_score(tid, farm_id)
    if prior is None:
        prior = store.get_score(farm_id)
    label = name or (prior or {}).get("name") or ""
    days = event_days_for_farm(
        store,
        farm_id,
        window_start=start,
        window_end=end,
        now=clock,
        allow_stored_fallback=allow_stored_fallback,
        score_end=score_end,
    )
    row = aggregate_days(
        days,
        farm_id=farm_id,
        name=label,
        previous=prior,
        error=error,
        today=clock.date().isoformat(),
    )
    if tid:
        store.put_event_score(tid, row)
    featured_id = str(config.get("current_tournament_id") or "").strip()
    if persist_featured and (not tid or tid == featured_id):
        return store.put_score(row)
    return row


def recover_daily_history(store: Store, *, now: datetime | None = None) -> int:
    """Fill missing past days from ``snapshots/daily/{day}.json``.

    Those files already keep one leaderboard per UTC date. They are the
    fallback when live scores were overwritten by a later day's grid.
    """
    clock = utc_clock(now)
    config = store.get_config()
    start = parse_iso(config.get("start_at"))
    end = parse_iso(config.get("end_at"))
    if start is None or end is None:
        return 0
    today = clock.date().isoformat()
    past_days = [key for key in window_day_keys(start, end) if key < today]
    if not past_days:
        return 0

    scores = {str(row.get("farm_id") or ""): row for row in store.list_scores()}
    needs = False
    for row in scores.values():
        have = {str(item.get("day") or "") for item in (row.get("days") or [])}
        if any(day not in have for day in past_days):
            needs = True
            break
    if not needs:
        # Still recover farms that only exist on a daily snapshot.
        for day in past_days:
            payload = store.read_daily_snapshot(day)
            if not payload:
                continue
            for entry in payload.get("leaderboard") or []:
                farm_id = str(entry.get("farm_id") or "").strip()
                if farm_id and farm_id not in scores:
                    needs = True
                    break
            if needs:
                break
    if not needs:
        return 0

    dirty: set[str] = set()
    recovered = 0
    for day in past_days:
        payload = store.read_daily_snapshot(day)
        if not payload:
            continue
        for entry in payload.get("leaderboard") or []:
            farm_id = str(entry.get("farm_id") or "").strip()
            if not farm_id:
                continue
            if store.read_farm_day(farm_id, day):
                continue
            put_farm_day(
                store,
                farm_id,
                day,
                day_record_from_entry(day, entry, finalized=True),
                overwrite_finalized=False,
            )
            dirty.add(farm_id)
            recovered += 1
    for farm_id in dirty:
        prior = store.get_score(farm_id)
        rebuild_score_from_days(
            store,
            farm_id,
            name=(prior or {}).get("name") or "",
            previous=prior,
            now=clock,
        )
    return recovered


def write_today_from_computed(
    store: Store,
    *,
    farm_id: str,
    name: str,
    computed,
    previous: dict[str, Any] | None,
    now: datetime,
    grid: Any = None,
    error: str | None = None,
    finalized: bool = False,
) -> dict[str, Any]:
    clock = utc_clock(now)
    config = store.get_config()
    day = scoring_day_key(
        clock,
        parse_iso(config.get("start_at")),
        parse_iso(config.get("end_at")),
    )
    record = day_record_from_computed(day, computed, finalized=finalized, grid=grid)
    put_farm_day(store, farm_id, day, record, overwrite_finalized=finalized)
    return rebuild_score_from_days(
        store,
        farm_id,
        name=name,
        previous=previous,
        error=error,
        now=now,
    )


def _today_grid(store: Store, farm_id: str, today: str) -> list | None:
    day = store.read_farm_day(farm_id, today)
    grid = day.get("grid") if isinstance(day, dict) else None
    if isinstance(grid, list):
        return grid
    snapshot = store.read_snapshot(farm_id)
    grid = snapshot.get("grid") if isinstance(snapshot, dict) else None
    return grid if isinstance(grid, list) else None


def _finalize_roster(
    store: Store,
    *,
    farm_rows: list[tuple[str, str, dict[str, Any]]],
    clock: datetime,
    window_start,
    window_end,
    tournament_id: str | None = None,
    score_end=None,
) -> dict[str, Any]:
    today = clock.date().isoformat()
    cutoff = score_end if score_end is not None else window_end
    prepared: list[tuple[str, str, dict[str, Any], dict[str, Any]]] = []
    for farm_id, name, prior in farm_rows:
        grid = _today_grid(store, farm_id, today)
        existing = store.read_farm_day(farm_id, today)
        if isinstance(grid, list):
            computed = score_grid(
                grid,
                now=clock,
                window_start=window_start,
                window_end=cutoff,
            )
            record = day_record_from_computed(today, computed, finalized=False, grid=grid)
        elif isinstance(existing, dict):
            record = dict(existing)
        else:
            continue
        prepared.append((farm_id, name, record, prior))

    assigned = assign_incomplete_official_scores(
        [
            {
                "farm_id": farm_id,
                "status": record.get("status"),
                "otter_count": record.get("otter_count"),
                "digs_to_third_op": record.get("digs_to_third_op"),
                "invalidated": bool(prior.get("invalidated")),
            }
            for farm_id, _name, record, prior in prepared
        ]
    )
    highest: int | None = None
    tid = str(tournament_id or "").strip()
    featured_id = str(store.get_config().get("current_tournament_id") or "").strip()
    write_shared_day = not tid or tid == featured_id
    for (farm_id, name, record, prior), updated in zip(prepared, assigned):
        if updated.get("status") == "completed" and updated.get("digs_to_third_op") is not None:
            try:
                score = int(updated["digs_to_third_op"])
            except (TypeError, ValueError):
                score = None
            if score is not None:
                highest = score if highest is None else max(highest, score)
        record["digs_to_third_op"] = updated.get("digs_to_third_op")
        record["status"] = updated.get("status") or record.get("status")
        record["finalized"] = True
        if write_shared_day:
            put_farm_day(store, farm_id, today, record, overwrite_finalized=True)
        else:
            existing = store.read_farm_day(farm_id, today) or {}
            locked = dict(existing) if existing else {"day": today, "farm_id": farm_id}
            locked["finalized"] = True
            if existing.get("grid") is not None:
                locked["grid"] = existing["grid"]
            elif record.get("grid") is not None:
                locked["grid"] = record["grid"]
            put_farm_day(store, farm_id, today, locked, overwrite_finalized=True)
        if tid and not write_shared_day:
            days = event_days_for_farm(
                store,
                farm_id,
                window_start=window_start,
                window_end=window_end,
                now=clock,
                allow_stored_fallback=False,
                score_end=cutoff,
            )
            replaced = False
            for item in days:
                if str(item.get("day") or "") == today:
                    item["digs_to_third_op"] = record.get("digs_to_third_op")
                    item["status"] = record.get("status")
                    item["finalized"] = True
                    item["otter_count"] = record.get("otter_count")
                    replaced = True
                    break
            if not replaced:
                days.append(record)
            row = aggregate_days(
                days,
                farm_id=farm_id,
                name=name,
                previous=prior,
                today=today,
            )
            store.put_event_score(tid, row)
        else:
            rebuild_score_from_days(
                store,
                farm_id,
                name=name,
                previous=prior,
                now=clock,
                window_start=window_start,
                window_end=window_end,
                tournament_id=tid or None,
                allow_stored_fallback=True,
                score_end=cutoff,
            )
    return {
        "rescored": len(prepared),
        "finalized": True,
        "highest_completed": highest,
    }


def finalize_today(
    store: Store, *, now: datetime, window_start, window_end, score_end=None
) -> dict[str, Any]:
    """Lock today's day records and assign that day's incomplete penalties.

    ``window_end`` selects which calendar days belong to the event.
    ``score_end`` (the 23:00 cutoff) is only applied when scoring tiles.
    When live events exist, each event's roster is finalized against that
    window so the 23:00 floor does not leak across overlapping boards.
    """
    clock = utc_clock(now)
    cutoff = score_end if score_end is not None else window_end
    live = [item for item in store.list_tournament_items() if item.get("status") == "active"]
    seeded = [item for item in live if item.get("roster_seeded")]
    if seeded:
        highest = None
        rescored = 0
        for event in seeded:
            tid = str(event.get("tournament_id") or "").strip()
            start = parse_iso(event.get("start_at"))
            end = parse_iso(event.get("end_at"))
            if start is None or end is None:
                continue
            farm_rows: list[tuple[str, str, dict[str, Any]]] = []
            for farm_id in enrolled_farm_ids(store, tid):
                prior = store.get_event_score(tid, farm_id) or store.get_score(farm_id) or {}
                farm_rows.append((farm_id, str(prior.get("name") or ""), prior))
            result = _finalize_roster(
                store,
                farm_rows=farm_rows,
                clock=clock,
                window_start=start,
                window_end=end,
                tournament_id=tid,
                score_end=cutoff,
            )
            rescored += int(result.get("rescored") or 0)
            event_high = result.get("highest_completed")
            if event_high is not None:
                highest = event_high if highest is None else max(highest, event_high)
        return {"rescored": rescored, "finalized": True, "highest_completed": highest}

    farm_rows = []
    for row in store.list_scores():
        farm_id = str(row.get("farm_id") or "").strip()
        if farm_id:
            farm_rows.append((farm_id, str(row.get("name") or ""), row))
    day_end = parse_iso(store.get_config().get("end_at")) or window_end
    return _finalize_roster(
        store,
        farm_rows=farm_rows,
        clock=clock,
        window_start=window_start,
        window_end=day_end,
        score_end=cutoff,
    )
