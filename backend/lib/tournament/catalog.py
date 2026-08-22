"""Named tournament catalog: many events, overlapping windows, ended freezes."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from tournament.cleanup import purge_archived_event_live_cache
from tournament.farms import FarmRegistry, utc_now_iso
from tournament.leaderboard import build_leaderboard, public_entry
from tournament.membership import (
    drop_tournament_members,
    enrolled_farm_ids,
    is_joinable,
    migrate_members,
)
from tournament.stats import overall_average_per_day
from tournament.store import MIN_TOURNAMENT_DAYS, NAME_MAX_LEN, Store
from tournament.sync import (
    ensure_default_config,
    public_config,
    refresh_leaderboard,
    rescore_from_snapshots,
    tournament_status,
)
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


def active_tournaments(store: Store) -> list[dict[str, Any]]:
    live = [item for item in store.list_tournament_items() if item.get("status") == STATUS_ACTIVE]
    live.sort(
        key=lambda item: (str(item.get("end_at") or ""), str(item.get("tournament_id") or ""))
    )
    return live


def featured_tournament(store: Store) -> dict[str, Any] | None:
    """Soonest-ending live event — scoring window, not the home showcase."""
    live = active_tournaments(store)
    return live[0] if live else None


def showcase_featured_id(store: Store) -> str | None:
    """Admin-chosen home board. Live scoring window stays on current_tournament_id."""
    tid = str(store.get_config().get("featured_tournament_id") or "").strip()
    if not tid:
        return None
    row = store.get_tournament(tid)
    if not row:
        return None
    if row.get("status") not in {STATUS_ACTIVE, STATUS_ENDED}:
        return None
    return tid


def set_featured_tournament(store: Store, tournament_id_value: str | None) -> str | None:
    """Persist a live or ended showcase id. Scheduled ids are rejected. None clears."""
    seed_catalog(store)
    current = store.get_config()
    tid = str(tournament_id_value or "").strip()
    if not tid:
        current["featured_tournament_id"] = None
        store.put_config(current)
        return None
    row = store.get_tournament(tid)
    if not row:
        raise CatalogError("tournament not found", code="NOT_FOUND", status=404)
    status = row.get("status")
    if status == STATUS_SCHEDULED:
        raise CatalogError(
            "scheduled tournaments cannot be featured", code="VALIDATION_ERROR", status=400
        )
    if status not in {STATUS_ACTIVE, STATUS_ENDED}:
        raise CatalogError(
            "only live or ended tournaments can be featured",
            code="VALIDATION_ERROR",
            status=400,
        )
    current["featured_tournament_id"] = tid
    store.put_config(current)
    return tid


def point_featured_config(store: Store) -> dict[str, Any]:
    featured = featured_tournament(store)
    if featured:
        return apply_live_config(store, featured)
    return clear_live_config(store)


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


def apply_live_config(
    store: Store, row: dict[str, Any], *, existing: dict[str, Any] | None = None
) -> dict[str, Any]:
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
            "featured_tournament_id": current.get("featured_tournament_id"),
        }
    )


def seed_catalog(store: Store, *, now: datetime | None = None) -> dict[str, Any]:
    """Mirror a real CONFIG window into the catalog. Empty config stays empty."""
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
    if status != STATUS_ENDED:
        config = point_featured_config(store)
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
    enrolled = enrolled_farm_ids(store, tournament_id_value)
    farm_ids = enrolled or {
        str(row.get("farm_id") or "").strip() for row in store.list_scores() if row.get("farm_id")
    }
    farm_ids.discard("")
    for farm_id in farm_ids:
        snapshot = store.read_snapshot(farm_id)
        if not snapshot:
            continue
        store.write_archive_farm(tournament_id_value, farm_id, snapshot)
        copied += 1
    return copied


def freeze_tournament(
    store: Store, row: dict[str, Any], *, now: datetime | None = None
) -> dict[str, Any]:
    clock = _clock(now)
    tid = str(row.get("tournament_id") or "")
    existing = store.read_archive(tid)
    if existing and existing.get("entries") is not None:
        frozen = existing
    else:
        board = store.get_event_leaderboard(tid) or refresh_leaderboard(
            store, now=clock, tournament_id=tid
        )
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
    purge_archived_event_live_cache(store, tid)
    return frozen


def create_tournament(
    store: Store, body: dict[str, Any], *, now: datetime | None = None
) -> dict[str, Any]:
    clock = _clock(now)
    seed_catalog(store, now=clock)
    start, end, days = parse_window(body)
    name = normalize_name(body.get("name"), start)
    prize = str(body.get("prize_amount") or body.get("prizeAmount") or "").strip() or "30"
    tid = tournament_id(
        {"start_at": start.isoformat(), "end_at": end.isoformat(), "duration_days": days}
    )
    if store.get_tournament(tid):
        raise CatalogError(
            "a tournament with that window already exists", code="CONFLICT", status=409
        )
    if start <= clock < end:
        status = STATUS_ACTIVE
    elif start > clock:
        status = STATUS_SCHEDULED
    else:
        raise CatalogError("that window has already ended", code="CONFLICT", status=409)
    row = tournament_record(start=start, end=end, days=days, name=name, prize=prize, status=status)
    row["roster_seeded"] = True
    store.put_tournament(row)
    if status == STATUS_ACTIVE:
        point_featured_config(store)
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

    name = normalize_name(
        body.get("name") if "name" in body else existing.get("name"),
        parse_iso(existing.get("start_at")),
    )
    prize = str(
        body.get("prize_amount")
        if "prize_amount" in body or "prizeAmount" in body
        else existing.get("prize_amount") or "30"
    )
    prize = prize.strip() or "30"

    window_keys = ("start_at", "startAt", "end_at", "endAt", "duration_days", "durationDays")
    window_changed = any(key in body for key in window_keys)
    if window_changed:
        payload = {
            "start_at": body.get("start_at", body.get("startAt", existing.get("start_at"))),
            "end_at": body.get("end_at", body.get("endAt", existing.get("end_at"))),
        }
        if "duration_days" in body or "durationDays" in body:
            payload["duration_days"] = body.get("duration_days", body.get("durationDays"))
        elif "end_at" not in body and "endAt" not in body:
            payload["duration_days"] = existing.get("duration_days")
        start, end, days = parse_window(payload)
    else:
        start, end, days = parse_window(
            {
                "start_at": existing.get("start_at"),
                "end_at": existing.get("end_at"),
                "duration_days": existing.get("duration_days"),
            }
        )

    new_id = tournament_id(
        {"start_at": start.isoformat(), "end_at": end.isoformat(), "duration_days": days}
    )
    if clock < start:
        next_status = STATUS_SCHEDULED
    elif status == STATUS_ACTIVE or clock < end:
        next_status = STATUS_ACTIVE
    else:
        raise CatalogError("that window has already ended", code="CONFLICT", status=409)

    if new_id != tournament_id_value:
        if store.get_tournament(new_id):
            raise CatalogError(
                "a tournament with that window already exists", code="CONFLICT", status=409
            )
        migrate_members(store, tournament_id_value, new_id)
        store.delete_tournament(tournament_id_value)

    updated = tournament_record(
        start=start,
        end=end,
        days=days,
        name=name,
        prize=prize,
        status=next_status,
        tournament_id_value=new_id,
    )
    store.put_tournament(updated)
    if new_id != tournament_id_value:
        store.drop_event_scores(tournament_id_value)
        store.delete_event_leaderboard(tournament_id_value)
    point_featured_config(store)
    if next_status == STATUS_ACTIVE and window_changed:
        rescore_from_snapshots(store, now=clock)
    elif next_status != STATUS_ACTIVE:
        refresh_leaderboard(store, now=clock)
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
            "featured_tournament_id": current.get("featured_tournament_id"),
        }
    )


def active_tournament(store: Store) -> dict[str, Any] | None:
    return featured_tournament(store)


def delete_tournament(
    store: Store, tournament_id_value: str, *, now: datetime | None = None
) -> None:
    seed_catalog(store, now=now)
    existing = store.get_tournament(tournament_id_value)
    if not existing:
        raise CatalogError("tournament not found", code="NOT_FOUND", status=404)
    status = existing.get("status")
    if status == STATUS_ENDED:
        raise CatalogError("ended tournaments cannot be cancelled", code="CONFLICT", status=409)
    if status not in {STATUS_SCHEDULED, STATUS_ACTIVE}:
        raise CatalogError(
            "only scheduled or live tournaments can be cancelled", code="CONFLICT", status=409
        )
    drop_tournament_members(store, tournament_id_value)
    store.drop_event_scores(tournament_id_value)
    store.delete_event_leaderboard(tournament_id_value)
    store.delete_tournament(tournament_id_value)
    current = store.get_config()
    if str(current.get("featured_tournament_id") or "") == tournament_id_value:
        current["featured_tournament_id"] = None
        store.put_config(current)
    point_featured_config(store)
    if not featured_tournament(store):
        store.put_leaderboard_cache({"entries": [], "count": 0, "leader_farm_id": None})
    else:
        refresh_leaderboard(store, now=now)


def rollover(store: Store, *, now: datetime | None = None) -> dict[str, Any]:
    """Archive every event that has ended and activate every window that has started."""
    clock = _clock(now)
    seed_catalog(store, now=clock)
    archived_ids: list[str] = []
    promoted_ids: list[str] = []
    for row in store.list_tournament_items():
        if row.get("status") == STATUS_ENDED:
            continue
        end = parse_iso(row.get("end_at"))
        if end is not None and clock >= end:
            freeze_tournament(store, row, now=clock)
            archived_ids.append(str(row.get("tournament_id") or ""))

    for row in sorted(
        store.list_tournament_items(), key=lambda item: str(item.get("start_at") or "")
    ):
        if row.get("status") != STATUS_SCHEDULED:
            continue
        start = parse_iso(row.get("start_at"))
        end = parse_iso(row.get("end_at"))
        if start is not None and start <= clock and (end is None or clock < end):
            row["status"] = STATUS_ACTIVE
            store.put_tournament(row)
            promoted_ids.append(str(row.get("tournament_id") or ""))

    point_featured_config(store)
    if promoted_ids:
        rescore_from_snapshots(store, now=clock)
    return {
        "archived": bool(archived_ids),
        "promoted": promoted_ids[0] if len(promoted_ids) == 1 else (promoted_ids or None),
        "archived_ids": archived_ids,
        "promoted_ids": promoted_ids,
    }


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
    items: list[dict[str, Any]] = []
    for row in store.list_tournament_items():
        archive = None
        extra: dict[str, Any] = {}
        tid = str(row.get("tournament_id") or "")
        if row.get("status") == STATUS_ENDED:
            archive = store.read_archive(tid)
        elif row.get("status") == STATUS_ACTIVE:
            board = store.get_event_leaderboard(tid) or {}
            extra = {
                "count": int(board.get("count") or 0),
                "leader_farm_id": board.get("leader_farm_id"),
            }
        summary = public_summary(row, archive=archive)
        summary.update({key: value for key, value in extra.items() if value is not None})
        items.append(summary)
    items.sort(key=lambda item: str(item.get("start_at") or ""), reverse=True)
    return items


def _public_tournament_payload(
    *,
    tournament_id_value: str,
    archived_at: Any,
    config: dict[str, Any],
    entries: list[dict[str, Any]],
    count: int,
    leader_farm_id: Any,
    accepts_joins: bool = False,
) -> dict[str, Any]:
    return {
        "tournament_id": tournament_id_value,
        "archived_at": archived_at,
        "config": config,
        "entries": entries,
        "count": count,
        "leader_farm_id": leader_farm_id,
        "overall_average_per_day": overall_average_per_day(entries),
        "accepts_joins": bool(accepts_joins),
    }


def get_public_tournament(
    store: Store, tournament_id_value: str, *, now: datetime | None = None
) -> dict[str, Any] | None:
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
        return _public_tournament_payload(
            tournament_id_value=tournament_id_value,
            archived_at=archive.get("archived_at") or row.get("archived_at"),
            config={
                **public_config({**row, "status": STATUS_ENDED}),
                **(archive.get("config") or {}),
            },
            entries=entries,
            count=len(entries),
            leader_farm_id=archive.get("leader_farm_id"),
            accepts_joins=False,
        )
    if row and row.get("status") == STATUS_ACTIVE:
        board = live_board_payload(store, now=clock, tournament_id=tournament_id_value)
        return _public_tournament_payload(
            tournament_id_value=tournament_id_value,
            archived_at=None,
            config=public_config({**row, "current_tournament_id": tournament_id_value}),
            entries=board.get("entries") or [],
            count=int(board.get("count") or 0),
            leader_farm_id=board.get("leader_farm_id"),
            accepts_joins=is_joinable(row, now=clock),
        )
    if row:
        board = enrollment_board(
            store,
            tournament_id_value,
            days=int(row.get("duration_days") or configured_duration_days(row)),
        )
        return _public_tournament_payload(
            tournament_id_value=tournament_id_value,
            archived_at=None,
            config=public_config({**row, "current_tournament_id": tournament_id_value}),
            entries=board.get("entries") or [],
            count=int(board.get("count") or 0),
            leader_farm_id=board.get("leader_farm_id"),
            accepts_joins=is_joinable(row, now=clock),
        )
    if archive:
        entries = [
            _hydrate_entry(entry, int((archive.get("config") or {}).get("duration_days") or 1))
            for entry in (archive.get("entries") or [])
        ]
        return _public_tournament_payload(
            tournament_id_value=tournament_id_value,
            archived_at=archive.get("archived_at"),
            config=archive.get("config") or {},
            entries=entries,
            count=int(archive.get("count") or 0),
            leader_farm_id=archive.get("leader_farm_id"),
            accepts_joins=False,
        )
    return None


def live_board_payload(
    store: Store, *, now: datetime | None = None, tournament_id: str | None = None
) -> dict[str, Any]:
    tid = str(tournament_id or "").strip()
    if tid:
        cache = store.get_event_leaderboard(tid)
        if cache and cache.get("entries") is not None:
            return cache
        return refresh_leaderboard(store, now=now, tournament_id=tid)
    cache = store.get_leaderboard_cache()
    if cache and cache.get("entries"):
        return cache
    return refresh_leaderboard(store, now=now)


def enrollment_board(store: Store, tournament_id_value: str, *, days: int) -> dict[str, Any]:
    """Scheduled listing: enrolled ∩ tracked ∩ active, roster identity only.

    The scores table is keyed by farm_id for the live window. Reusing those
    rows here would leak live digs onto an upcoming board and invent a
    non-null ``overall_average_per_day``.
    """
    registry = FarmRegistry(store.data_bucket, s3_client=store._s3)
    allowed = enrolled_farm_ids(store, tournament_id_value) & registry.farm_ids(active_only=True)
    rows: list[dict[str, Any]] = []
    for farm_id in allowed:
        tracked = registry.get(farm_id) or {}
        rows.append(store.empty_score(farm_id, tracked.get("name") or ""))
    return build_leaderboard(rows, tournament_days=max(int(days), 1))


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
    row = dict(entry)
    row.setdefault("tournament_days", days)
    return public_entry(row)
