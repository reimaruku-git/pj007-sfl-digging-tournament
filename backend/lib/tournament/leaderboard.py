"""Rank farms from stored scores and publish a cache snapshot."""

from __future__ import annotations

from typing import Any

from tournament.scoring import STATUS_COMPLETED, STATUS_IN_PROGRESS, STATUS_NOT_STARTED
from tournament.window import avg_digs_per_day

STATUS_INVALIDATED = "invalidated"

_STATUS_ORDER = {
    STATUS_COMPLETED: 0,
    STATUS_IN_PROGRESS: 1,
    STATUS_NOT_STARTED: 2,
    STATUS_INVALIDATED: 3,
}


def official_score(row: dict[str, Any]) -> int | None:
    if row.get("override_digs_to_third_op") is not None:
        try:
            return int(row["override_digs_to_third_op"])
        except (TypeError, ValueError):
            return None
    raw = row.get("digs_to_third_op")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


_MISSING_DIGS = 10**12
_LATE = "9999-12-31T23:59:59+00:00"


def _as_rank_int(value: Any) -> int:
    if value is None:
        return _MISSING_DIGS
    try:
        return int(value)
    except (TypeError, ValueError):
        return _MISSING_DIGS


def _as_rank_time(value: Any) -> str:
    text = str(value or "").strip()
    return text if text else _LATE


def _tie_break(row: dict[str, Any]) -> tuple:
    """Pebble digs/times, then lower average per day, then lower total digs."""
    avg = row.get("avg_digs_per_day")
    avg_key = _MISSING_DIGS if avg is None else int(round(float(avg) * 100))
    return (
        _as_rank_int(row.get("digs_to_second_op")),
        _as_rank_int(row.get("digs_to_first_op")),
        _as_rank_time(row.get("third_op_at")),
        _as_rank_time(row.get("second_op_at")),
        _as_rank_time(row.get("first_op_at")),
        avg_key,
        _as_rank_int(row.get("total_digs")),
        str(row.get("farm_id") or ""),
    )


def annotate_pace(row: dict[str, Any], tournament_days: int) -> dict[str, Any]:
    out = dict(row)
    days = max(int(tournament_days), 1)
    total = int(out.get("total_digs") or 0)
    out["total_digs"] = total
    out["tournament_days"] = days
    out["avg_digs_per_day"] = avg_digs_per_day(total, days)
    return out


def _sort_key(row: dict[str, Any]) -> tuple:
    if row.get("invalidated"):
        return (4, _MISSING_DIGS) + _tie_break(row)
    status = row.get("status") or STATUS_NOT_STARTED
    score = official_score(row)
    if status == STATUS_COMPLETED and score is not None:
        return (0, score) + _tie_break(row)
    if score is not None:
        return (1, score) + _tie_break(row)
    if status == STATUS_IN_PROGRESS:
        return (2, _MISSING_DIGS) + _tie_break(row)
    return (3, _MISSING_DIGS) + _tie_break(row)


def rank_scores(rows: list[dict[str, Any]], *, tournament_days: int = 1) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    paced = [annotate_pace(row, tournament_days) for row in rows]
    ordered = sorted(paced, key=_sort_key)
    place = 0
    for row in ordered:
        entry = dict(row)
        invalidated = bool(entry.get("invalidated"))
        if invalidated:
            entry["status"] = STATUS_INVALIDATED
            entry["rank"] = None
        else:
            place += 1
            entry["rank"] = place
        entry["digs_to_third_op"] = official_score(entry)
        ranked.append(entry)
    return ranked


def public_entry(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "rank": row.get("rank"),
        "farm_id": row.get("farm_id"),
        "name": row.get("name") or "",
        "digs_to_third_op": row.get("digs_to_third_op"),
        "digs_to_first_op": row.get("digs_to_first_op"),
        "digs_to_second_op": row.get("digs_to_second_op"),
        "otter_count": int(row.get("otter_count") or 0),
        "digs_today": int(row.get("digs_today") or 0),
        "total_digs": int(row.get("total_digs") or 0),
        "avg_digs_per_day": float(row.get("avg_digs_per_day") or 0),
        "tournament_days": int(row.get("tournament_days") or 1),
        "first_op_at": row.get("first_op_at"),
        "second_op_at": row.get("second_op_at"),
        "third_op_at": row.get("third_op_at"),
        "last_updated_at": row.get("last_updated_at"),
        "status": row.get("status") or STATUS_NOT_STARTED,
        "invalidated": bool(row.get("invalidated")),
    }


def build_leaderboard(rows: list[dict[str, Any]], *, tournament_days: int = 1) -> dict[str, Any]:
    days = max(int(tournament_days), 1)
    entries = [public_entry(row) for row in rank_scores(rows, tournament_days=days)]
    leader = next((entry for entry in entries if entry["rank"] == 1), None)
    return {
        "entries": entries,
        "count": len(entries),
        "leader_farm_id": leader["farm_id"] if leader else None,
    }
