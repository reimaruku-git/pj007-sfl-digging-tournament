"""Player list stats: SFL digging streak and unique-day average per day.

Official board score is unchanged (3rd-OP digs ÷ duration days). These
helpers only feed the admin player list / detail and tournament info.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from tournament.membership import public_member
from tournament.scoring import extract_streak
from tournament.store import Store
from tournament.window import parse_iso


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def digging_streak(source: Any) -> int:
    """Sunflower Land in-game ``desert.digging.streak.count``.

    Accepts a Community API farm payload, a stored snapshot (``streak``
    or ``digging_streak``), the raw streak object, or a bare count.
    Missing / unreadable values are ``0``. Grid tiles are never used.
    """
    if isinstance(source, bool):
        return 0
    if isinstance(source, (int, float)):
        try:
            return max(0, int(source))
        except (TypeError, ValueError):
            return 0
    return extract_streak(source)["count"]


def record_identity(record: dict[str, Any]) -> tuple[Any, ...]:
    third_at = record.get("third_op_at")
    if third_at:
        return ("third", str(third_at))
    return (
        "digs",
        record.get("digs_to_third_op"),
        record.get("first_op_at"),
        record.get("second_op_at"),
        record.get("otter_count"),
    )


def unique_score_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One digging result, even when it landed on two tournament boards."""
    seen: dict[tuple[Any, ...], dict[str, Any]] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        if record.get("digs_to_third_op") is None:
            continue
        try:
            int(record["digs_to_third_op"])
        except (TypeError, ValueError):
            continue
        key = record_identity(record)
        if key not in seen:
            seen[key] = record
    return list(seen.values())


def iter_window_days(start: datetime, end: datetime):
    start_d = _as_utc(start).date()
    end_d = _as_utc(end).date()
    if end_d <= start_d:
        yield start_d
        return
    cursor = start_d
    while cursor < end_d:
        yield cursor
        cursor += timedelta(days=1)


def unique_enrolled_days(windows: list[tuple[datetime, datetime]]) -> int:
    """Union of UTC calendar days across enrolled tournament windows."""
    days: set = set()
    for start, end in windows:
        if start is None or end is None:
            continue
        days.update(iter_window_days(start, end))
    return len(days)


def average_per_day(
    *,
    records: list[dict[str, Any]],
    windows: list[tuple[datetime, datetime]],
) -> float | None:
    """Profile avg/day: unique 3rd-OP digs ÷ unique enrolled calendar days.

    Overlapping events that share one digging result count that record
    once and the shared days once. Missing records or days → ``None``.
    """
    days = unique_enrolled_days(windows)
    uniq = unique_score_records(records)
    if not days or not uniq:
        return None
    total = 0
    for record in uniq:
        total += int(record["digs_to_third_op"])
    return round(total / days, 2)


def overall_average_per_day(entries: list[dict[str, Any]]) -> float | None:
    """Mean of a tournament board's official per-day scores."""
    values: list[float] = []
    for entry in entries:
        raw = entry.get("score") if isinstance(entry, dict) else None
        if raw is None:
            continue
        try:
            values.append(float(raw))
        except (TypeError, ValueError):
            continue
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def farm_history(store: Store, farm_id: str) -> list[dict[str, Any]]:
    wanted = str(farm_id)
    history: list[dict[str, Any]] = []
    for row in store.list_tournament_items():
        if row.get("status") != "ended":
            continue
        tid = str(row.get("tournament_id") or "")
        if not tid:
            continue
        archive = store.read_archive(tid)
        if not archive:
            continue
        entry = next(
            (
                item
                for item in (archive.get("entries") or [])
                if str(item.get("farm_id") or "") == wanted
            ),
            None,
        )
        if not entry:
            continue
        history.append(
            {
                "tournament_id": tid,
                "name": row.get("name") or "",
                "start_at": row.get("start_at"),
                "end_at": row.get("end_at"),
                "duration_days": row.get("duration_days"),
                "score": entry.get("score"),
                "digs_to_third_op": entry.get("digs_to_third_op"),
                "first_op_at": entry.get("first_op_at"),
                "second_op_at": entry.get("second_op_at"),
                "third_op_at": entry.get("third_op_at"),
                "rank": entry.get("rank"),
                "status": entry.get("status"),
                "otter_count": entry.get("otter_count"),
            }
        )
    history.sort(key=lambda item: str(item.get("start_at") or ""), reverse=True)
    return history


def profile_windows_and_records(
    store: Store, farm_id: str
) -> tuple[list[tuple[datetime, datetime]], list[dict[str, Any]]]:
    """Enrolled windows (any status) plus unique digging records."""
    windows_by_tid: dict[str, tuple[datetime, datetime]] = {}
    records: list[dict[str, Any]] = []

    for item in farm_history(store, farm_id):
        tid = str(item.get("tournament_id") or "")
        start = parse_iso(item.get("start_at"))
        end = parse_iso(item.get("end_at"))
        if tid and start and end:
            windows_by_tid[tid] = (start, end)
        records.append(item)

    for member in store.list_members(farm_id=farm_id, status="enrolled"):
        tid = str(member.get("tournament_id") or "")
        if not tid:
            continue
        event = store.get_tournament(tid) or {}
        start = parse_iso(event.get("start_at"))
        end = parse_iso(event.get("end_at"))
        if start and end:
            windows_by_tid[tid] = (start, end)
        if event.get("status") == "active":
            score = store.get_score(farm_id)
            if score:
                records.append(score)

    return list(windows_by_tid.values()), records


def snapshot_streak_source(snapshot: dict[str, Any] | None) -> Any:
    return snapshot if isinstance(snapshot, dict) else {}


def collapsed_player_stats(
    *,
    streak_source: Any = None,
    records: list[dict[str, Any]] | None = None,
    windows: list[tuple[datetime, datetime]] | None = None,
) -> dict[str, Any]:
    return {
        "digging_streak": digging_streak(streak_source),
        "average_per_day": average_per_day(records=records or [], windows=windows or []),
    }


def player_list_row(store: Store, farm: dict[str, Any]) -> dict[str, Any]:
    farm_id = str(farm.get("farm_id") or "")
    windows, records = profile_windows_and_records(store, farm_id)
    stats = collapsed_player_stats(
        streak_source=snapshot_streak_source(store.read_snapshot(farm_id)),
        records=records,
        windows=windows,
    )
    return {
        "farm_id": farm_id,
        "name": farm.get("name") or "",
        "active": bool(farm.get("active")),
        "digging_streak": stats["digging_streak"],
        "average_per_day": stats["average_per_day"],
    }


def player_detail(
    store: Store,
    farm: dict[str, Any],
    *,
    now: datetime | None = None,
    live_tournament: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _ = now, live_tournament
    farm_id = str(farm.get("farm_id") or "")
    summary = player_list_row(store, farm)
    score = store.get_score(farm_id)
    enrollments = []
    pending = []
    for item in store.list_members(farm_id=farm_id):
        payload = public_member(item)
        event = store.get_tournament(payload["tournament_id"]) or {}
        payload["tournament_name"] = event.get("name") or ""
        payload["tournament_status"] = event.get("status")
        if payload["status"] == "pending":
            pending.append(payload)
        else:
            enrollments.append(payload)
    summary.update(
        {
            "score": score,
            "history": farm_history(store, farm_id),
            "enrollments": enrollments,
            "pending_joins": pending,
        }
    )
    return summary
