"""Player list stats: digging streak and collapsed average per day.

Official board score is unchanged (3rd-OP digs ÷ duration days). These
helpers only feed the admin player list / detail.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from tournament.leaderboard import official_score
from tournament.membership import public_member
from tournament.scoring import flatten_grid
from tournament.store import Store
from tournament.window import official_score_average, parse_iso


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _tile_day(
    dug_at_ms: int | None,
    window_start: datetime | None,
    window_end: datetime | None,
):
    if dug_at_ms is None:
        return None
    dug = datetime.fromtimestamp(dug_at_ms / 1000, tz=timezone.utc)
    if window_start is not None and dug < window_start:
        return None
    if window_end is not None and dug > window_end:
        return None
    return dug.date()


def digging_streak(
    grid: Any,
    *,
    now: datetime | None = None,
    window_start: datetime | None = None,
    window_end: datetime | None = None,
) -> int:
    """Consecutive UTC days with ≥1 counted dig.

    Walks backward from today when they dug today, otherwise from the
    most recent dig day. Flattened Sand Drill slots share one ``dugAt``.
    """
    clock = _as_utc(now or datetime.now(timezone.utc))
    dates: set = set()
    for tile in flatten_grid(grid):
        day = _tile_day(tile.dug_at_ms, window_start, window_end)
        if day is not None:
            dates.add(day)
    if not dates:
        return 0
    today = clock.date()
    cursor = today if today in dates else max(dates)
    streak = 0
    while cursor in dates:
        streak += 1
        cursor = cursor - timedelta(days=1)
    return streak


def average_per_day(
    *,
    live_enrolled: bool,
    live_official_score: float | None,
    ended_official_scores: list[float | int | None],
) -> float | None:
    """Collapsed list stat. Not a ranking formula.

    Live enrollment uses that event's official score. Otherwise the mean
    of ended-event official scores. Missing → ``None``.
    """
    if live_enrolled:
        if live_official_score is None:
            return None
        try:
            return round(float(live_official_score), 2)
        except (TypeError, ValueError):
            return None
    values: list[float] = []
    for raw in ended_official_scores:
        if raw is None:
            continue
        try:
            values.append(float(raw))
        except (TypeError, ValueError):
            continue
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def ended_official_scores_for_farm(store: Store, farm_id: str) -> list[float]:
    scores: list[float] = []
    for item in farm_history(store, farm_id):
        raw = item.get("score")
        if raw is None:
            continue
        try:
            scores.append(float(raw))
        except (TypeError, ValueError):
            continue
    return scores


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
                "rank": entry.get("rank"),
                "status": entry.get("status"),
                "otter_count": entry.get("otter_count"),
            }
        )
    history.sort(key=lambda item: str(item.get("start_at") or ""), reverse=True)
    return history


def live_official_average(score_row: dict[str, Any] | None, duration_days: int) -> float | None:
    if not score_row:
        return None
    return official_score_average(official_score(score_row), duration_days)


def snapshot_grid(snapshot: dict[str, Any] | None) -> list[Any]:
    if not isinstance(snapshot, dict):
        return []
    grid = snapshot.get("grid")
    return grid if isinstance(grid, list) else []


def collapsed_player_stats(
    *,
    grid: Any,
    now: datetime | None = None,
    live_enrolled: bool,
    live_official_score: float | None,
    ended_official_scores: list[float | int | None],
    window_start: datetime | None = None,
    window_end: datetime | None = None,
) -> dict[str, Any]:
    return {
        "digging_streak": digging_streak(
            grid, now=now, window_start=window_start, window_end=window_end
        ),
        "average_per_day": average_per_day(
            live_enrolled=live_enrolled,
            live_official_score=live_official_score,
            ended_official_scores=ended_official_scores,
        ),
    }


def player_list_row(
    store: Store,
    farm: dict[str, Any],
    *,
    now: datetime | None = None,
    live_tournament_id: str | None = None,
    live_duration_days: int = 1,
    live_window_start: datetime | None = None,
    live_window_end: datetime | None = None,
) -> dict[str, Any]:
    farm_id = str(farm.get("farm_id") or "")
    live_member = store.get_member(live_tournament_id, farm_id) if live_tournament_id else None
    live_enrolled = bool(live_member and live_member.get("status") == "enrolled")
    score_row = store.get_score(farm_id) if live_enrolled else None
    live_avg = live_official_average(score_row, live_duration_days) if live_enrolled else None
    ended = ended_official_scores_for_farm(store, farm_id)
    stats = collapsed_player_stats(
        grid=snapshot_grid(store.read_snapshot(farm_id)),
        now=now,
        live_enrolled=live_enrolled,
        live_official_score=live_avg,
        ended_official_scores=ended,
        window_start=live_window_start if live_enrolled else None,
        window_end=live_window_end if live_enrolled else None,
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
    farm_id = str(farm.get("farm_id") or "")
    live_id = str((live_tournament or {}).get("tournament_id") or "") or None
    live_days = int((live_tournament or {}).get("duration_days") or 1)
    live_start = parse_iso((live_tournament or {}).get("start_at")) if live_tournament else None
    live_end = parse_iso((live_tournament or {}).get("end_at")) if live_tournament else None
    summary = player_list_row(
        store,
        farm,
        now=now,
        live_tournament_id=live_id,
        live_duration_days=live_days,
        live_window_start=live_start,
        live_window_end=live_end,
    )
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
