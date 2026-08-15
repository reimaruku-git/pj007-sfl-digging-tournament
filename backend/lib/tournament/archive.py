"""Persist finished (or replaced) tournament standings to S3."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from tournament.farms import utc_now_iso
from tournament.store import Store
from tournament.sync import public_config, refresh_leaderboard
from tournament.window import tournament_id


def archive_current(store: Store, *, now: datetime | None = None, force: bool = False) -> dict[str, Any] | None:
    clock = now or datetime.now(timezone.utc)
    config = store.get_config()
    start = config.get("start_at")
    end = config.get("end_at")
    if not start or not end:
        return None
    from tournament.window import parse_iso

    start_dt = parse_iso(str(start))
    end_dt = parse_iso(str(end))
    if start_dt is None or end_dt is None:
        return None
    if not force and clock <= end_dt:
        return None
    tid = tournament_id(config)
    existing = store.read_archive(tid)
    if existing:
        return existing
    board = refresh_leaderboard(store, now=clock)
    payload = {
        "tournament_id": tid,
        "archived_at": utc_now_iso(),
        "config": public_config(config),
        "entries": board.get("entries") or [],
        "count": int(board.get("count") or 0),
        "leader_farm_id": board.get("leader_farm_id"),
    }
    store.write_archive(tid, payload)
    return payload


def list_public_archives(store: Store) -> list[dict[str, Any]]:
    return store.list_archives()


def get_public_archive(store: Store, tournament_id_value: str) -> dict[str, Any] | None:
    return store.read_archive(tournament_id_value)
