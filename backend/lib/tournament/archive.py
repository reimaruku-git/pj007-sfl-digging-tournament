"""Persist finished (or replaced) tournament standings to S3."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from tournament.store import Store
from tournament.window import parse_iso, tournament_id


def archive_current(store: Store, *, now: datetime | None = None, force: bool = False) -> dict[str, Any] | None:
    from tournament.catalog import freeze_tournament, seed_catalog

    clock = now or datetime.now(timezone.utc)
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=timezone.utc)
    config = store.get_config()
    start = parse_iso(config.get("start_at"))
    end = parse_iso(config.get("end_at"))
    if start is None or end is None:
        return None
    if not force and clock <= end:
        return None
    seed_catalog(store, now=clock)
    tid = str(config.get("current_tournament_id") or "").strip() or tournament_id(config)
    row = store.get_tournament(tid)
    if row is None:
        return None
    return freeze_tournament(store, row, now=clock)


def list_public_archives(store: Store) -> list[dict[str, Any]]:
    from tournament.catalog import list_public_tournaments

    return [item for item in list_public_tournaments(store) if item.get("status") == "ended"]


def get_public_archive(store: Store, tournament_id_value: str) -> dict[str, Any] | None:
    from tournament.catalog import get_public_tournament

    return get_public_tournament(store, tournament_id_value)
