"""Rank farms from stored scores and publish a cache snapshot."""

from __future__ import annotations

from typing import Any

from tournament.scoring import STATUS_COMPLETED, STATUS_IN_PROGRESS, STATUS_NOT_STARTED

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


def _sort_key(row: dict[str, Any]) -> tuple:
    if row.get("invalidated"):
        return (3, 10**12, 0, 10**12, str(row.get("farm_id") or ""))
    status = row.get("status") or STATUS_NOT_STARTED
    score = official_score(row)
    otter = int(row.get("otter_count") or 0)
    total = int(row.get("total_digs") or 0)
    farm_id = str(row.get("farm_id") or "")
    if status == STATUS_COMPLETED and score is not None:
        return (0, score, -otter, total, farm_id)
    if status == STATUS_IN_PROGRESS:
        return (1, 10**12, -otter, total, farm_id)
    return (2, 10**12, -otter, total, farm_id)


def rank_scores(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    ordered = sorted(rows, key=_sort_key)
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
        "otter_count": int(row.get("otter_count") or 0),
        "digs_today": int(row.get("digs_today") or 0),
        "total_digs": int(row.get("total_digs") or 0),
        "last_updated_at": row.get("last_updated_at"),
        "status": row.get("status") or STATUS_NOT_STARTED,
        "invalidated": bool(row.get("invalidated")),
    }


def build_leaderboard(rows: list[dict[str, Any]]) -> dict[str, Any]:
    entries = [public_entry(row) for row in rank_scores(rows)]
    leader = next((entry for entry in entries if entry["rank"] == 1), None)
    return {
        "entries": entries,
        "count": len(entries),
        "leader_farm_id": leader["farm_id"] if leader else None,
    }
