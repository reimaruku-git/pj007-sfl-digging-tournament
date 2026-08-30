"""Per-tournament join requests and enrollment.

Identity is ``(farm_id, tournament_id)``. A farm may sit on many events.
The S3 registry stays the global player directory; membership is separate.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from tournament.event_settings import JOIN_MODE_AUTO, island_meets_minimum, public_event_settings
from tournament.farms import FarmRegistry, utc_now_iso
from tournament.scoring import extract_grid, extract_streak, farm_profile_fields
from tournament.sfl_client import SFLApiError
from tournament.store import Store
from tournament.window import parse_iso

logger = logging.getLogger(__name__)

STATUS_PENDING = "pending"
STATUS_ENROLLED = "enrolled"
STATUS_SCHEDULED = "scheduled"
STATUS_ACTIVE = "active"
JOINABLE_STATUSES = {STATUS_SCHEDULED, STATUS_ACTIVE}
FIRST_DAY_JOIN_CLOSE_HOUR_UTC = 22
FIRST_DAY_JOIN_CLOSE_MINUTE_UTC = 30
JOIN_CLOSED_MESSAGE = "join closed after 22:30 UTC on the first day"
TOURNAMENT_FULL_MESSAGE = "tournament is full"


class MembershipError(Exception):
    def __init__(
        self,
        message: str,
        code: str = "VALIDATION_ERROR",
        status: int = 400,
        details: Any | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.details = details


def public_member(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "farm_id": str(row.get("farm_id") or ""),
        "name": str(row.get("name") or ""),
        "tournament_id": str(row.get("tournament_id") or ""),
        "status": str(row.get("status") or STATUS_PENDING),
        "submitted_at": row.get("submitted_at"),
        "approved_at": row.get("approved_at"),
    }


ACTIVE_MEMBER_STATUSES = {STATUS_PENDING, STATUS_ENROLLED}


def public_farm_memberships(store: Store, farm_id: str) -> list[dict[str, Any]]:
    """Pending and enrolled rows for one farm. Rejected joins are deleted."""
    wanted = str(farm_id or "").strip()
    if not wanted:
        return []
    return [
        public_member(item)
        for item in store.list_members(farm_id=wanted)
        if item.get("status") in ACTIVE_MEMBER_STATUSES
    ]


def parse_tournament_ids(body: dict[str, Any]) -> list[str]:
    raw = body.get("tournament_ids")
    if raw is None:
        single = body.get("tournament_id")
        raw = [single] if single not in (None, "") else []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        raise MembershipError("tournament_ids must be a list")
    ids: list[str] = []
    seen: set[str] = set()
    for item in raw:
        tid = str(item or "").strip()
        if not tid or tid in seen:
            continue
        seen.add(tid)
        ids.append(tid)
    if not ids:
        raise MembershipError("tournament_id is required")
    return ids


def parse_farm_ids(body: dict[str, Any]) -> list[str]:
    raw = body.get("farm_ids")
    if raw is None:
        single = body.get("farm_id")
        raw = [single] if single not in (None, "") else []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        raise MembershipError("farm_ids must be a list")
    ids: list[str] = []
    seen: set[str] = set()
    for item in raw:
        fid = str(item or "").strip()
        if not fid or fid in seen:
            continue
        seen.add(fid)
        ids.append(fid)
    if not ids:
        raise MembershipError("farm_id is required")
    return ids


def enrolled_farm_ids(store: Store, tournament_id: str) -> set[str]:
    return {
        str(item.get("farm_id") or "")
        for item in store.list_members(tournament_id=tournament_id, status=STATUS_ENROLLED)
        if item.get("farm_id")
    }


def live_enrolled_farm_ids(store: Store) -> set[str]:
    """Farms enrolled in at least one currently active event."""
    due: set[str] = set()
    for row in store.list_tournament_items():
        if row.get("status") != STATUS_ACTIVE:
            continue
        tid = str(row.get("tournament_id") or "").strip()
        if tid:
            due.update(enrolled_farm_ids(store, tid))
    due.discard("")
    return due


def farm_live_tournament_ids(store: Store, farm_id: str) -> list[str]:
    wanted = str(farm_id or "").strip()
    if not wanted:
        return []
    ids: list[str] = []
    for row in store.list_tournament_items():
        if row.get("status") != STATUS_ACTIVE:
            continue
        tid = str(row.get("tournament_id") or "").strip()
        if not tid:
            continue
        member = store.get_member(tid, wanted)
        if member and member.get("status") == STATUS_ENROLLED:
            ids.append(tid)
    return ids


def farms_due_for_sync(store: Store, registry: FarmRegistry) -> list[dict[str, Any]]:
    """Active tracked farms enrolled in at least one live event."""
    due = live_enrolled_farm_ids(store)
    return [farm for farm in registry.list_farms(active_only=True) if farm["farm_id"] in due]


def utc_clock(now: datetime | None = None) -> datetime:
    clock = now or datetime.now(timezone.utc)
    if clock.tzinfo is None:
        return clock.replace(tzinfo=timezone.utc)
    return clock.astimezone(timezone.utc)


def first_day_join_cutoff(row: dict[str, Any] | None) -> datetime | None:
    """22:30 UTC on the tournament's first UTC calendar day."""
    if not row:
        return None
    start = parse_iso(row.get("start_at"))
    if start is None:
        return None
    day = start.date()
    return datetime(
        day.year,
        day.month,
        day.day,
        FIRST_DAY_JOIN_CLOSE_HOUR_UTC,
        FIRST_DAY_JOIN_CLOSE_MINUTE_UTC,
        tzinfo=timezone.utc,
    )


def is_open_event(row: dict[str, Any] | None) -> bool:
    """Scheduled or live — admin enroll/approve still allowed after the join cutoff."""
    return bool(row) and row.get("status") in JOINABLE_STATUSES


def is_joinable(row: dict[str, Any] | None, *, now: datetime | None = None) -> bool:
    """Public join: scheduled always; live only before 22:30 UTC on day one."""
    if not is_open_event(row):
        return False
    if row.get("status") == STATUS_SCHEDULED:
        return True
    cutoff = first_day_join_cutoff(row)
    if cutoff is None:
        return True
    return utc_clock(now) < cutoff


def stored_farm_snapshot(store: Store, farm_id: str) -> dict[str, Any] | None:
    snapshot = store.read_snapshot(farm_id)
    return snapshot if isinstance(snapshot, dict) else None


def settings_need_join_profile(settings: dict[str, Any]) -> bool:
    return bool(
        settings.get("min_bumpkin_island")
        or settings.get("min_digging_streak") is not None
        or settings.get("vip_required")
    )


def refresh_join_profile(
    store: Store,
    farm_id: str,
    *,
    client: Any | None,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """Fetch one farm from SFL so join gates see live island/streak/VIP.

    Does not score or enroll. FarmSync still owns scheduled scoring sweeps.
    A failed fetch keeps the stored snapshot (fail closed if none exists).
    """
    if client is None:
        return stored_farm_snapshot(store, farm_id)
    try:
        payload = client.fetch_farm(farm_id)
    except SFLApiError as exc:
        logger.warning("join profile fetch failed for %s: %s", farm_id, exc)
        return stored_farm_snapshot(store, farm_id)
    clock = utc_clock(now)
    prior = stored_farm_snapshot(store, farm_id) or {}
    live_grid = extract_grid(payload)
    snapshot = {
        "farm_id": farm_id,
        "fetched_at": utc_now_iso(),
        "grid": live_grid if live_grid else (prior.get("grid") or []),
        **farm_profile_fields(payload, now=clock),
    }
    if "score" in prior:
        snapshot["score"] = prior["score"]
    store.write_snapshot(farm_id, snapshot)
    return snapshot


def _join_gate_line(label: str, required: Any, farm: Any, *, readable: bool) -> str:
    if not readable:
        return f"{label} {required} (could not be read)"
    return f"{label} {required} (farm is {farm})"


def _raise_join_gate_failures(lines: list[str], details: list[dict[str, Any]]) -> None:
    if not lines:
        return
    raise MembershipError(
        "farm does not meet the join requirements: " + "; ".join(lines),
        details=details,
    )


def enforce_public_join_gates(store: Store, farm_id: str, settings: dict[str, Any]) -> None:
    min_island = settings.get("min_bumpkin_island")
    min_streak = settings.get("min_digging_streak")
    vip_required = bool(settings.get("vip_required"))
    if min_island is None and min_streak is None and not vip_required:
        return
    snapshot = stored_farm_snapshot(store, farm_id)
    lines: list[str] = []
    details: list[dict[str, Any]] = []

    def add(gate: str, required: Any, farm: Any, *, readable: bool, label: str) -> None:
        farm_text = farm if readable else None
        details.append(
            {"gate": gate, "required": required, "farm": farm_text, "readable": readable}
        )
        if gate == "vip_required":
            if not readable:
                lines.append("VIP required (could not be read)")
            else:
                lines.append("VIP required (farm is not VIP)")
            return
        lines.append(_join_gate_line(label, required, farm, readable=readable))

    if snapshot is None:
        if min_island is not None:
            add(
                "min_bumpkin_island",
                min_island,
                None,
                readable=False,
                label="minimum bumpkin island",
            )
        if min_streak is not None:
            add(
                "min_digging_streak",
                min_streak,
                None,
                readable=False,
                label="minimum digging streak",
            )
        if vip_required:
            add("vip_required", True, None, readable=False, label="VIP required")
        _raise_join_gate_failures(lines, details)
        return

    if min_island is not None:
        island = snapshot.get("island")
        if island in (None, ""):
            add(
                "min_bumpkin_island",
                min_island,
                None,
                readable=False,
                label="minimum bumpkin island",
            )
        elif not island_meets_minimum(island, min_island):
            add(
                "min_bumpkin_island",
                min_island,
                island,
                readable=True,
                label="minimum bumpkin island",
            )

    if min_streak is not None:
        if "digging_streak" not in snapshot and "streak" not in snapshot:
            add(
                "min_digging_streak",
                min_streak,
                None,
                readable=False,
                label="minimum digging streak",
            )
        else:
            streak = extract_streak(snapshot)["count"]
            if streak < int(min_streak):
                add(
                    "min_digging_streak",
                    min_streak,
                    streak,
                    readable=True,
                    label="minimum digging streak",
                )

    if vip_required:
        if "vip" not in snapshot:
            add("vip_required", True, None, readable=False, label="VIP required")
        elif not snapshot.get("vip"):
            add("vip_required", True, False, readable=True, label="VIP required")

    _raise_join_gate_failures(lines, details)


def enroll_member(
    store: Store,
    registry: FarmRegistry,
    *,
    farm_id: str,
    tournament_id: str,
    name: str,
    submitted_at: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    existing = store.get_member(tournament_id, farm_id)
    tracked = registry.get(farm_id)
    join_name = str(name or (existing or {}).get("name") or "").strip()
    if tracked:
        saved = registry.upsert(
            farm_id,
            name=tracked.get("name") or join_name,
            active=bool(tracked.get("active")),
        )
    else:
        saved = registry.upsert(farm_id, name=join_name, active=True)
    now = utc_now_iso()
    member = store.put_member(
        {
            "farm_id": farm_id,
            "tournament_id": tournament_id,
            "name": join_name or (tracked or {}).get("name") or "",
            "status": STATUS_ENROLLED,
            "submitted_at": submitted_at or (existing or {}).get("submitted_at") or now,
            "approved_at": now,
        }
    )
    farm = next(item for item in saved["farms"] if item["farm_id"] == farm_id)
    if not store.get_score(farm_id):
        store.put_score(store.empty_score(farm_id, farm.get("name") or ""))
    return member, farm


def request_joins(
    store: Store,
    *,
    farm_id: str,
    name: str,
    tournament_ids: list[str],
    now: datetime | None = None,
    registry: FarmRegistry | None = None,
    sfl_client: Any | None = None,
) -> list[dict[str, Any]]:
    clock = utc_clock(now)
    pending: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
    needs_profile = False
    for tid in tournament_ids:
        row = store.get_tournament(tid)
        if not is_joinable(row, now=clock):
            if is_open_event(row) and row.get("status") == STATUS_ACTIVE:
                raise MembershipError(JOIN_CLOSED_MESSAGE)
            raise MembershipError("tournament is not joinable")
        existing = store.get_member(tid, farm_id)
        if existing and existing.get("status") in {STATUS_PENDING, STATUS_ENROLLED}:
            raise MembershipError(
                "farm is already pending or enrolled in that tournament",
                code="CONFLICT",
                status=409,
            )
        settings = public_event_settings(row or {})
        if settings_need_join_profile(settings):
            needs_profile = True
        pending.append((tid, row or {}, settings))
    if needs_profile:
        refresh_join_profile(store, farm_id, client=sfl_client, now=clock)
    created: list[dict[str, Any]] = []
    submitted_at = utc_now_iso()
    for tid, row, settings in pending:
        enforce_public_join_gates(store, farm_id, settings)
        max_players = settings.get("max_players")
        if max_players is not None and len(enrolled_farm_ids(store, tid)) >= int(max_players):
            raise MembershipError(TOURNAMENT_FULL_MESSAGE)
        auto = settings.get("join_mode") == JOIN_MODE_AUTO and registry is not None
        if auto:
            member, _farm = enroll_member(
                store,
                registry,
                farm_id=farm_id,
                tournament_id=tid,
                name=name,
                submitted_at=submitted_at,
            )
            created.append(public_member(member))
            continue
        item = store.put_member(
            {
                "farm_id": farm_id,
                "tournament_id": tid,
                "name": name,
                "status": STATUS_PENDING,
                "submitted_at": submitted_at,
                "approved_at": None,
            }
        )
        created.append(public_member(item))
    return created


def approve_join(
    store: Store,
    registry: FarmRegistry,
    *,
    farm_id: str,
    tournament_id: str,
) -> dict[str, Any]:
    member = store.get_member(tournament_id, farm_id)
    if not member or member.get("status") != STATUS_PENDING:
        raise MembershipError("submission not found", code="NOT_FOUND", status=404)
    if not is_open_event(store.get_tournament(tournament_id)):
        raise MembershipError("tournament is not joinable")
    _member, farm = enroll_member(
        store,
        registry,
        farm_id=farm_id,
        tournament_id=tournament_id,
        name=str(member.get("name") or ""),
        submitted_at=member.get("submitted_at"),
    )
    return farm


def reject_join(store: Store, *, farm_id: str, tournament_id: str) -> None:
    member = store.get_member(tournament_id, farm_id)
    if not member or member.get("status") != STATUS_PENDING:
        raise MembershipError("submission not found", code="NOT_FOUND", status=404)
    store.delete_member(tournament_id, farm_id)


def add_farms_to_tournament(
    store: Store,
    registry: FarmRegistry,
    *,
    tournament_id: str,
    farm_ids: list[str],
) -> list[dict[str, Any]]:
    if not is_open_event(store.get_tournament(tournament_id)):
        row = store.get_tournament(tournament_id)
        if not row:
            raise MembershipError("tournament not found", code="NOT_FOUND", status=404)
        raise MembershipError("ended tournaments cannot accept farms", code="CONFLICT", status=409)
    tracked_rows: list[dict[str, Any]] = []
    for fid in farm_ids:
        tracked = registry.get(fid)
        if not tracked:
            raise MembershipError("farm is not tracked", code="NOT_FOUND", status=404)
        tracked_rows.append(tracked)
    added: list[dict[str, Any]] = []
    now = utc_now_iso()
    for tracked in tracked_rows:
        fid = tracked["farm_id"]
        existing = store.get_member(tournament_id, fid)
        if existing and existing.get("status") == STATUS_ENROLLED:
            added.append(tracked)
            continue
        store.put_member(
            {
                "farm_id": fid,
                "tournament_id": tournament_id,
                "name": tracked.get("name") or (existing or {}).get("name") or "",
                "status": STATUS_ENROLLED,
                "submitted_at": (existing or {}).get("submitted_at") or now,
                "approved_at": now,
            }
        )
        if not store.get_score(fid):
            store.put_score(store.empty_score(fid, tracked.get("name") or ""))
        added.append(tracked)
    return added


def remove_farm_from_tournament(store: Store, *, tournament_id: str, farm_id: str) -> None:
    member = store.get_member(tournament_id, farm_id)
    if not member or member.get("status") != STATUS_ENROLLED:
        raise MembershipError(
            "farm is not enrolled in that tournament", code="NOT_FOUND", status=404
        )
    store.delete_member(tournament_id, farm_id)


def drop_tournament_members(store: Store, tournament_id: str) -> int:
    removed = 0
    for item in store.list_members(tournament_id=tournament_id):
        farm_id = str(item.get("farm_id") or "")
        if farm_id:
            store.delete_member(tournament_id, farm_id)
            removed += 1
    return removed


def drop_farm_members(store: Store, farm_id: str) -> int:
    removed = 0
    for item in store.list_members(farm_id=farm_id):
        tid = str(item.get("tournament_id") or "")
        if tid:
            store.delete_member(tid, farm_id)
            removed += 1
    return removed


def migrate_members(store: Store, old_tournament_id: str, new_tournament_id: str) -> int:
    if old_tournament_id == new_tournament_id:
        return 0
    moved = 0
    for item in store.list_members(tournament_id=old_tournament_id):
        farm_id = str(item.get("farm_id") or "")
        if not farm_id:
            continue
        store.delete_member(old_tournament_id, farm_id)
        item["tournament_id"] = new_tournament_id
        store.put_member(item)
        moved += 1
    return moved


def seed_legacy_roster(store: Store, registry: FarmRegistry) -> None:
    """One-shot: existing live/scheduled events with no roster keep today's tracked farms."""
    for row in store.list_tournament_items():
        if row.get("status") not in JOINABLE_STATUSES:
            continue
        if row.get("roster_seeded"):
            continue
        tid = str(row.get("tournament_id") or "")
        if not tid:
            continue
        if not store.list_members(tournament_id=tid):
            now = utc_now_iso()
            for farm in registry.list_farms(active_only=True):
                store.put_member(
                    {
                        "farm_id": farm["farm_id"],
                        "tournament_id": tid,
                        "name": farm.get("name") or "",
                        "status": STATUS_ENROLLED,
                        "submitted_at": now,
                        "approved_at": now,
                    }
                )
        row["roster_seeded"] = True
        store.put_tournament(row)


def roster_members(
    store: Store,
    registry: FarmRegistry,
    tournament_id: str,
) -> list[dict[str, Any]]:
    members: list[dict[str, Any]] = []
    for item in store.list_members(tournament_id=tournament_id):
        farm_id = str(item.get("farm_id") or "")
        tracked = registry.get(farm_id) or {}
        payload = public_member(item)
        payload["name"] = tracked.get("name") or payload["name"]
        payload["active"] = bool(tracked.get("active")) if tracked else False
        payload["tracked"] = bool(tracked)
        members.append(payload)
    members.sort(
        key=lambda item: (
            item.get("status") != STATUS_PENDING,
            item.get("name") or "",
            item.get("farm_id") or "",
        )
    )
    return members
