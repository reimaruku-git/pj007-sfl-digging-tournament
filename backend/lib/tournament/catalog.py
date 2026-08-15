"""Named tournament catalog: one live event, a queue, and ended freezes."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from tournament.farms import utc_now_iso
from tournament.store import MIN_TOURNAMENT_DAYS, NAME_MAX_LEN, Store
from tournament.sync import public_config, refresh_leaderboard, rescore_from_snapshots, tournament_status
from tournament.window import (
    configured_duration_days,
    default_tournament_name,
    duration_days,
    parse_iso,
    tournament_id,
)

STATUS_SCHEDULED = "scheduled"
STATUS_ACTIVE = "active"
STATUS_ENDED = "ended"


class CatalogError(Exception):
    def __init__(self, message: str, code: str = "VALIDATION_ERROR", status: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def _clock(now: datetime | None) -> datetime:
    clock = now or datetime.now(timezone.utc)
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=timezone.utc)
    return clock.astimezone(timezone.utc)


def normalize_name(raw: Any, start: datetime | None) -> str:
    text = str(raw or "").strip()
    if not text:
        text = default_tournament_name(start)
    if len(text) > NAME_MAX_LEN:
        raise CatalogError(f"name must be at most {NAME_MAX_LEN} characters")
    return text


def parse_window(body: dict[str, Any]) -> tuple[datetime, datetime, int]:
    start = parse_iso(body.get("start_at") or body.get("startAt"))
    raw_days = body.get("duration_days")
    if raw_days is None:
        raw_days = body.get("durationDays")
    days: int | None = None
    if raw_days is not None and str(raw_days).strip() != "":
        try:
            days = int(raw_days)
        except (TypeError, ValueError) as exc:
            raise CatalogError("duration_days must be an integer") from exc
    end = parse_iso(body.get("end_at") or body.get("endAt"))
    if start is None:
        raise CatalogError("start_at is required")
    if days is not None:
        if days < MIN_TOURNAMENT_DAYS:
            raise CatalogError(f"tournament must run at least {MIN_TOURNAMENT_DAYS} days")
        end = start + timedelta(days=days)
    if end is None:
        raise CatalogError("duration_days or end_at is required")
    if end <= start:
        raise CatalogError("end_at must be after start_at")
    if end - start < timedelta(days=MIN_TOURNAMENT_DAYS):
        raise CatalogError(f"tournament must run at least {MIN_TOURNAMENT_DAYS} days")
    return start, end, days or duration_days(start, end)


def windows_overlap(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


def _as_window(row: dict[str, Any]) -> tuple[datetime, datetime] | None:
    start = parse_iso(row.get("start_at"))
    end = parse_iso(row.get("end_at"))
    if start is None or end is None:
        return None
    return start, end


def assert_no_overlap(store: Store, start: datetime, end: datetime, *, ignore_id: str | None = None) -> None:
    for row in store.list_tournament_items():
        tid = str(row.get("tournament_id") or "")
        if ignore_id and tid == ignore_id:
            continue
        if row.get("status") == STATUS_ENDED:
            continue
        other = _as_window(row)
        if other and windows_overlap(start, end, other[0], other[1]):
            raise CatalogError("tournament window overlaps another event", code="CONFLICT", status=409)


def tournament_record(
    *,
    start: datetime,
    end: datetime,
    days: int,
    name: str,
    prize: str,
    status: str,
    archived_at: str | None = None,
    tournament_id_value: str | None = None,
) -> dict[str, Any]:
    tid = tournament_id_value or tournament_id(
        {"start_at": start.isoformat(), "end_at": end.isoformat(), "duration_days": days}
    )
    return {
        "tournament_id": tid,
        "name": name,
        "start_at": start.isoformat(),
        "end_at": end.isoformat(),
        "duration_days": days,
        "prize_amount": prize,
        "status": status,
        "archived_at": archived_at,
    }


def apply_live_config(store: Store, row: dict[str, Any], *, existing: dict[str, Any] | None = None) -> dict[str, Any]:
    current = existing if existing is not None else store.get_config()
    return store.put_config(
        {
            "start_at": row["start_at"],
            "end_at": row["end_at"],
            "duration_days": row["duration_days"],
            "prize_amount": row["prize_amount"],
            "name": row.get("name") or "",
            "status": row.get("status") or STATUS_ACTIVE,
            "current_tournament_id": row["tournament_id"],
            "last_full_sync_at": current.get("last_full_sync_at"),
            "leader_farm_id": current.get("leader_farm_id"),
        }
    )


def seed_catalog(store: Store, *, now: datetime | None = None) -> dict[str, Any]:
    """Mirror a real CONFIG window into the catalog. Empty config stays empty."""
    from tournament.sync import ensure_default_config

    clock = _clock(now)
    config = ensure_default_config(store, now=clock)
    start = parse_iso(config.get("start_at"))
    end = parse_iso(config.get("end_at"))
    if start is None or end is None or end <= start:
        _import_legacy_archives(store)
        return config
    days = configured_duration_days(config)
    tid = str(config.get("current_tournament_id") or "").strip() or tournament_id(
        {"start_at": start.isoformat(), "end_at": end.isoformat(), "duration_days": days}
    )
    name = normalize_name(config.get("name"), start)
    existing = store.get_tournament(tid)
    clock_status = tournament_status(start, end, clock)
    if existing and existing.get("status") == STATUS_ENDED and existing.get("archived_at"):
        status = STATUS_ENDED
        archived_at = existing.get("archived_at")
    elif clock_status == STATUS_ENDED and not (existing or {}).get("archived_at"):
        # Still the live pointer until rollover freezes it.
        status = STATUS_ACTIVE
        archived_at = None
    else:
        status = clock_status
        archived_at = (existing or {}).get("archived_at")
    row = tournament_record(
        start=start,
        end=end,
        days=days,
        name=name,
        prize=str(config.get("prize_amount") or "30"),
        status=status,
        archived_at=archived_at,
        tournament_id_value=tid,
    )
    store.put_tournament(row)
    if status != STATUS_ENDED and (
        config.get("current_tournament_id") != tid or config.get("name") != name
    ):
        config = apply_live_config(store, {**row, "status": clock_status}, existing=config)
    _import_legacy_archives(store)
    return config


def _import_legacy_archives(store: Store) -> None:
    known = set(store.list_tournament_ids())
    for summary in store.list_archives():
        tid = str(summary.get("tournament_id") or "").strip()
        if not tid or tid in known:
            continue
        start = parse_iso(summary.get("start_at"))
        end = parse_iso(summary.get("end_at"))
        if start is None or end is None:
            continue
        store.put_tournament(
            tournament_record(
                start=start,
                end=end,
                days=int(summary.get("duration_days") or duration_days(start, end)),
                name=normalize_name(summary.get("name"), start),
                prize=str(summary.get("prize_amount") or "30"),
                status=STATUS_ENDED,
                archived_at=summary.get("archived_at") or utc_now_iso(),
                tournament_id_value=tid,
            )
        )
        known.add(tid)


def _copy_farm_snapshots(store: Store, tournament_id_value: str) -> int:
    copied = 0
    for row in store.list_scores():
        farm_id = str(row.get("farm_id") or "").strip()
        if not farm_id:
            continue
        snapshot = store.read_snapshot(farm_id)
        if not snapshot:
            continue
        store.write_archive_farm(tournament_id_value, farm_id, snapshot)
        copied += 1
    return copied


def freeze_tournament(store: Store, row: dict[str, Any], *, now: datetime | None = None) -> dict[str, Any]:
    clock = _clock(now)
    tid = str(row.get("tournament_id") or "")
    existing = store.read_archive(tid)
    if existing and existing.get("entries") is not None:
        frozen = existing
    else:
        board = refresh_leaderboard(store, now=clock)
        frozen = {
            "tournament_id": tid,
            "archived_at": utc_now_iso(),
            "config": public_config({**row, "status": STATUS_ENDED}),
            "entries": board.get("entries") or [],
            "count": int(board.get("count") or 0),
            "leader_farm_id": board.get("leader_farm_id"),
        }
        store.write_archive(tid, frozen)
        _copy_farm_snapshots(store, tid)
    updated = dict(row)
    updated["status"] = STATUS_ENDED
    updated["archived_at"] = frozen.get("archived_at") or utc_now_iso()
    store.put_tournament(updated)
    return frozen


def create_tournament(store: Store, body: dict[str, Any], *, now: datetime | None = None) -> dict[str, Any]:
    clock = _clock(now)
    seed_catalog(store, now=clock)
    start, end, days = parse_window(body)
    name = normalize_name(body.get("name"), start)
    prize = str(body.get("prize_amount") or body.get("prizeAmount") or "").strip() or "30"
    assert_no_overlap(store, start, end)
    tid = tournament_id({"start_at": start.isoformat(), "end_at": end.isoformat(), "duration_days": days})
    if store.get_tournament(tid):
        raise CatalogError("a tournament with that window already exists", code="CONFLICT", status=409)
    active = next((item for item in store.list_tournament_items() if item.get("status") == STATUS_ACTIVE), None)
    if start <= clock and not active:
        status = STATUS_ACTIVE
    elif start <= clock and active:
        raise CatalogError("another tournament is already live", code="CONFLICT", status=409)
    else:
        status = STATUS_SCHEDULED
    row = tournament_record(start=start, end=end, days=days, name=name, prize=prize, status=status)
    store.put_tournament(row)
    if status == STATUS_ACTIVE:
        apply_live_config(store, row)
        rescore_from_snapshots(store, now=clock)
    return row


def update_tournament(
    store: Store, tournament_id_value: str, body: dict[str, Any], *, now: datetime | None = None
) -> dict[str, Any]:
    clock = _clock(now)
    seed_catalog(store, now=clock)
    existing = store.get_tournament(tournament_id_value)
    if not existing:
        raise CatalogError("tournament not found", code="NOT_FOUND", status=404)
    status = existing.get("status") or STATUS_SCHEDULED
    if status == STATUS_ENDED:
        raise CatalogError("ended tournaments cannot be edited", code="CONFLICT", status=409)

    name = normalize_name(body.get("name") if "name" in body else existing.get("name"), parse_iso(existing.get("start_at")))
    prize = str(body.get("prize_amount") if "prize_amount" in body or "prizeAmount" in body else existing.get("prize_amount") or "30")
    prize = prize.strip() or "30"

    if status == STATUS_ACTIVE:
        if any(key in body for key in ("start_at", "startAt", "end_at", "endAt", "duration_days", "durationDays")):
            raise CatalogError("dates are locked once a tournament is live", code="CONFLICT", status=409)
        updated = dict(existing)
        updated["name"] = name
        updated["prize_amount"] = prize
        store.put_tournament(updated)
        apply_live_config(store, updated)
        return updated

    start, end, days = parse_window(
        {
            "start_at": body.get("start_at", body.get("startAt", existing.get("start_at"))),
            "end_at": body.get("end_at", body.get("endAt", existing.get("end_at"))),
            "duration_days": body.get("duration_days", body.get("durationDays")),
        }
        if any(key in body for key in ("start_at", "startAt", "end_at", "endAt", "duration_days", "durationDays"))
        else {
            "start_at": existing.get("start_at"),
            "end_at": existing.get("end_at"),
            "duration_days": existing.get("duration_days"),
        }
    )
    assert_no_overlap(store, start, end, ignore_id=tournament_id_value)
    new_id = tournament_id({"start_at": start.isoformat(), "end_at": end.isoformat(), "duration_days": days})
    updated = tournament_record(start=start, end=end, days=days, name=name, prize=prize, status=STATUS_SCHEDULED)
    if new_id != tournament_id_value:
        if store.get_tournament(new_id):
            raise CatalogError("a tournament with that window already exists", code="CONFLICT", status=409)
        store.delete_tournament(tournament_id_value)
    if start <= clock:
        active = next(
            (
                item
                for item in store.list_tournament_items()
                if item.get("status") == STATUS_ACTIVE and item.get("tournament_id") != new_id
            ),
            None,
        )
        if active:
            raise CatalogError("another tournament is already live", code="CONFLICT", status=409)
        updated["status"] = STATUS_ACTIVE
        store.put_tournament(updated)
        apply_live_config(store, updated)
        rescore_from_snapshots(store, now=clock)
        return updated
    store.put_tournament(updated)
    return updated


def clear_live_config(store: Store) -> dict[str, Any]:
    current = store.get_config()
    return store.put_config(
        {
            "start_at": "",
            "end_at": "",
            "duration_days": 0,
            "prize_amount": str(current.get("prize_amount") or "30"),
            "name": "",
            "status": STATUS_SCHEDULED,
            "current_tournament_id": None,
            "last_full_sync_at": current.get("last_full_sync_at"),
            "leader_farm_id": None,
        }
    )


def active_tournament(store: Store) -> dict[str, Any] | None:
    return next(
        (item for item in store.list_tournament_items() if item.get("status") == STATUS_ACTIVE),
        None,
    )


def delete_tournament(store: Store, tournament_id_value: str, *, now: datetime | None = None) -> None:
    seed_catalog(store, now=now)
    existing = store.get_tournament(tournament_id_value)
    if not existing:
        raise CatalogError("tournament not found", code="NOT_FOUND", status=404)
    status = existing.get("status")
    if status == STATUS_ENDED:
        raise CatalogError("ended tournaments cannot be cancelled", code="CONFLICT", status=409)
    if status not in {STATUS_SCHEDULED, STATUS_ACTIVE}:
        raise CatalogError("only scheduled or live tournaments can be cancelled", code="CONFLICT", status=409)
    store.delete_tournament(tournament_id_value)
    if status == STATUS_ACTIVE:
        clear_live_config(store)
        store.put_leaderboard_cache({"entries": [], "count": 0, "leader_farm_id": None})


def rollover(store: Store, *, now: datetime | None = None) -> dict[str, Any]:
    """Archive an ended live event and promote the next scheduled one."""
    clock = _clock(now)
    seed_catalog(store, now=clock)
    config = store.get_config()
    current_id = str(config.get("current_tournament_id") or "").strip()
    current = store.get_tournament(current_id) if current_id else None
    archived = None
    promoted = None
    if current:
        end = parse_iso(current.get("end_at"))
        if end is not None and clock >= end and current.get("status") != STATUS_ENDED:
            archived = freeze_tournament(store, current, now=clock)
            current = store.get_tournament(current_id)
    elif parse_iso(config.get("end_at")) and clock >= parse_iso(config.get("end_at")):
        from tournament.archive import archive_current

        archive_current(store, now=clock, force=True)

    next_row = None
    for row in sorted(store.list_tournament_items(), key=lambda item: str(item.get("start_at") or "")):
        if row.get("status") != STATUS_SCHEDULED:
            continue
        start = parse_iso(row.get("start_at"))
        if start is not None and start <= clock:
            next_row = row
            break
    live = next((item for item in store.list_tournament_items() if item.get("status") == STATUS_ACTIVE), None)
    if next_row and not live:
        next_row["status"] = STATUS_ACTIVE
        store.put_tournament(next_row)
        apply_live_config(store, next_row)
        rescore_from_snapshots(store, now=clock)
        promoted = next_row
    return {"archived": archived is not None, "promoted": promoted.get("tournament_id") if promoted else None}


def public_summary(row: dict[str, Any], *, archive: dict[str, Any] | None = None) -> dict[str, Any]:
    start = parse_iso(row.get("start_at"))
    days = int(row.get("duration_days") or 0) or configured_duration_days(row)
    payload = archive or {}
    return {
        "tournament_id": row.get("tournament_id"),
        "name": row.get("name") or default_tournament_name(start),
        "start_at": row.get("start_at"),
        "end_at": row.get("end_at"),
        "duration_days": days,
        "prize_amount": str(row.get("prize_amount") or "30"),
        "status": row.get("status") or STATUS_SCHEDULED,
        "archived_at": row.get("archived_at") or payload.get("archived_at"),
        "count": int(payload.get("count") or row.get("count") or 0),
        "leader_farm_id": payload.get("leader_farm_id") or row.get("leader_farm_id"),
    }


def list_public_tournaments(store: Store, *, now: datetime | None = None) -> list[dict[str, Any]]:
    clock = _clock(now)
    rollover(store, now=clock)
    seed_catalog(store, now=clock)
    live_board = store.get_leaderboard_cache() or {}
    current_id = str(store.get_config().get("current_tournament_id") or "")
    items: list[dict[str, Any]] = []
    for row in store.list_tournament_items():
        archive = None
        extra: dict[str, Any] = {}
        if row.get("status") == STATUS_ENDED:
            archive = store.read_archive(str(row.get("tournament_id") or ""))
        elif row.get("status") == STATUS_ACTIVE or row.get("tournament_id") == current_id:
            extra = {
                "count": int(live_board.get("count") or 0),
                "leader_farm_id": live_board.get("leader_farm_id"),
            }
        summary = public_summary(row, archive=archive)
        summary.update({key: value for key, value in extra.items() if value is not None})
        items.append(summary)
    items.sort(key=lambda item: str(item.get("start_at") or ""), reverse=True)
    return items


def get_public_tournament(store: Store, tournament_id_value: str, *, now: datetime | None = None) -> dict[str, Any] | None:
    clock = _clock(now)
    seed_catalog(store, now=clock)
    row = store.get_tournament(tournament_id_value)
    archive = store.read_archive(tournament_id_value)
    if row is None and archive is None:
        return None
    if row and row.get("status") == STATUS_ENDED and archive:
        entries = [
            _hydrate_entry(entry, int(row.get("duration_days") or configured_duration_days(row)))
            for entry in (archive.get("entries") or [])
        ]
        return {
            "tournament_id": tournament_id_value,
            "archived_at": archive.get("archived_at") or row.get("archived_at"),
            "config": {**public_config({**row, "status": STATUS_ENDED}), **(archive.get("config") or {})},
            "entries": entries,
            "count": len(entries),
            "leader_farm_id": archive.get("leader_farm_id"),
        }
    if row and row.get("status") == STATUS_ACTIVE:
        board = live_board_payload(store, now=clock)
        return {
            "tournament_id": tournament_id_value,
            "archived_at": None,
            "config": public_config(store.get_config()),
            "entries": board.get("entries") or [],
            "count": int(board.get("count") or 0),
            "leader_farm_id": board.get("leader_farm_id"),
        }
    if row:
        return {
            "tournament_id": tournament_id_value,
            "archived_at": None,
            "config": public_config({**row, "current_tournament_id": tournament_id_value}),
            "entries": [],
            "count": 0,
            "leader_farm_id": None,
        }
    if archive:
        return {
            "tournament_id": tournament_id_value,
            "archived_at": archive.get("archived_at"),
            "config": archive.get("config") or {},
            "entries": [
                _hydrate_entry(entry, int((archive.get("config") or {}).get("duration_days") or 1))
                for entry in (archive.get("entries") or [])
            ],
            "count": int(archive.get("count") or 0),
            "leader_farm_id": archive.get("leader_farm_id"),
        }
    return None


def live_board_payload(store: Store, *, now: datetime | None = None) -> dict[str, Any]:
    cache = store.get_leaderboard_cache()
    if cache and cache.get("entries"):
        return cache
    return refresh_leaderboard(store, now=now)


def get_public_tournament_farm(
    store: Store, tournament_id_value: str, farm_id: str, *, now: datetime | None = None
) -> dict[str, Any] | None:
    payload = get_public_tournament(store, tournament_id_value, now=now)
    if payload is None:
        return None
    for entry in payload.get("entries") or []:
        if str(entry.get("farm_id")) == str(farm_id):
            return entry
    snapshot = store.read_archive_farm(tournament_id_value, farm_id)
    if snapshot and isinstance(snapshot.get("score"), dict):
        days = int((payload.get("config") or {}).get("duration_days") or 1)
        return _hydrate_entry({**snapshot.get("score"), "farm_id": farm_id}, days)
    return None


def _hydrate_entry(entry: dict[str, Any], days: int) -> dict[str, Any]:
    from tournament.leaderboard import public_entry

    row = dict(entry)
    row.setdefault("tournament_days", days)
    return public_entry(row)
