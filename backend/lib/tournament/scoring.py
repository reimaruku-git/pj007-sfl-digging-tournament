"""Otter Pebble dig scoring.

Rules
-----
* Walk ``farm.desert.digging.grid`` in order.
* A Sand Drill always costs **4 numbered digs**. The API may stamp the
  whole drill once (the same ``dugAt`` / “Nth dig” on all 4 holes). Those
  still become four positions, and any items (including an Otter Pebble)
  sit on the **last** of those four.
* A nested list is one Sand Drill. A top-level ``tool == "Sand Drill"``
  object is one Sand Drill. Four sibling tiles that share the same
  ``dugAt`` are one Sand Drill the API numbered once.
* Every other top-level tile (Sand Shovel / unknown) costs **1 dig**.
* The official score is the 1-based flattened position of the tile that
  produced the **3rd Otter Pebble**.
* Once the score is set, later tiles do not change it.
* Tiles outside the tournament window (by ``dugAt``) are ignored.
* At 23:00 UTC finalize (and later that UTC day) the window end is also
  clipped to that day's 23:00 — tiles with ``dugAt`` after 23:00 UTC are
  not counted. Farms that still do not have 3 Otter Pebbles receive
  ``max(highest completed 3rd-OP that day, 30) + 5 * missing``.
  A missing 2nd pebble becomes that penalty minus 1; a missing 1st
  becomes penalty minus 2. Found 1st/2nd digs stay as recorded.
  Mid-day syncs (14/16/18/20 UTC) do not assign that penalty.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

OTTER_PEBBLE = "Otter Pebble"
SAND_DRILL = "Sand Drill"
SAND_SHOVEL = "Sand Shovel"

STATUS_NOT_STARTED = "not_started"
STATUS_IN_PROGRESS = "in_progress"
STATUS_COMPLETED = "completed"

FINALIZE_HOUR_UTC = 23
INCOMPLETE_SCORE_FLOOR = 30
INCOMPLETE_SCORE_PER_MISSING_OP = 5


@dataclass(frozen=True)
class FlatTile:
    """One position in the flattened dig sequence."""

    items: dict[str, Any]
    tool: str
    dug_at_ms: int | None
    source: str  # "shovel" | "drill_group" | "drill_object"


@dataclass(frozen=True)
class DigScore:
    """Computed score for one farm."""

    digs_to_third_op: int | None
    otter_count: int
    total_digs: int
    digs_today: int
    status: str
    digs_to_first_op: int | None = None
    digs_to_second_op: int | None = None
    first_op_at: str | None = None
    second_op_at: str | None = None
    third_op_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _tile_items(tile: Any) -> dict[str, Any]:
    if not isinstance(tile, dict):
        return {}
    items = tile.get("items") or {}
    return items if isinstance(items, dict) else {}


def _tile_dug_at_ms(tile: Any) -> int | None:
    if not isinstance(tile, dict):
        return None
    raw = tile.get("dugAt")
    if raw is None:
        return None
    value = _as_int(raw)
    return value if value > 0 else None


def _otter_count_in_items(items: dict[str, Any]) -> int:
    total = 0
    for name, qty in items.items():
        if str(name) == OTTER_PEBBLE:
            total += max(_as_int(qty), 0)
    return total


def _ms_to_utc(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def _in_window(
    dug_at_ms: int | None,
    window_start: datetime | None,
    window_end: datetime | None,
) -> bool:
    if window_start is None and window_end is None:
        return True
    if dug_at_ms is None:
        # Undated tiles still count — do not silently drop history.
        return True
    dug_at = _ms_to_utc(dug_at_ms)
    if window_start is not None and dug_at < window_start:
        return False
    if window_end is not None and dug_at > window_end:
        return False
    return True


def _merge_drill_items(tiles: list[Any]) -> dict[str, Any]:
    """Combine hole items onto one slot without quadrupling a duplicated OP."""
    merged: dict[str, int] = {}
    for tile in tiles:
        for name, qty in _tile_items(tile).items():
            key = str(name)
            merged[key] = max(merged.get(key, 0), _as_int(qty))
    return merged


def _expand_drill(
    *,
    items: dict[str, Any],
    dug_at_ms: int | None,
    source: str,
) -> list[FlatTile]:
    """One Sand Drill → four numbered positions; items on the last."""
    return [
        FlatTile(
            items=items if index == 3 else {},
            tool=SAND_DRILL,
            dug_at_ms=dug_at_ms,
            source=source,
        )
        for index in range(4)
    ]


def flatten_grid(grid: Any) -> list[FlatTile]:
    """Flatten ``desert.digging.grid`` into 1-dig positions.

    Every Sand Drill becomes four numbered slots with its items on the
    last slot. A nested list is one drill. A top-level ``Sand Drill``
    object is one drill. Four sibling tiles that share the same ``dugAt``
    are one drill the API numbered once (e.g. “5th dig” on all four holes).
    """
    if not isinstance(grid, list):
        return []

    tiles: list[FlatTile] = []
    index = 0
    while index < len(grid):
        entry = grid[index]
        if isinstance(entry, list):
            children = [child for child in entry if isinstance(child, dict)]
            last = children[-1] if children else None
            tiles.extend(
                _expand_drill(
                    items=_merge_drill_items(children),
                    dug_at_ms=_tile_dug_at_ms(last) if last else None,
                    source="drill_group",
                )
            )
            index += 1
            continue

        if not isinstance(entry, dict):
            index += 1
            continue

        tool = str(entry.get("tool") or SAND_SHOVEL)
        dug_at_ms = _tile_dug_at_ms(entry)
        if tool == SAND_DRILL:
            # One object, or four holes the API stamped as Sand Drill once.
            siblings = [entry]
            look = index + 1
            while look < len(grid) and len(siblings) < 4:
                nxt = grid[look]
                if not isinstance(nxt, dict):
                    break
                if str(nxt.get("tool") or "") != SAND_DRILL:
                    break
                if dug_at_ms is not None and _tile_dug_at_ms(nxt) != dug_at_ms:
                    break
                siblings.append(nxt)
                look += 1
            tiles.extend(
                _expand_drill(
                    items=_merge_drill_items(siblings),
                    dug_at_ms=dug_at_ms,
                    source="drill_object",
                )
            )
            index = look
            continue

        tiles.append(
            FlatTile(
                items=_tile_items(entry),
                tool=tool,
                dug_at_ms=dug_at_ms,
                source="shovel",
            )
        )
        index += 1
    return tiles


def score_grid(
    grid: Any,
    *,
    now: datetime | None = None,
    window_start: datetime | None = None,
    window_end: datetime | None = None,
) -> DigScore:
    """Score a digging grid.

    Args:
        grid: ``farm.desert.digging.grid`` value.
        now: Clock for "today" (UTC). Defaults to utcnow.
        window_start: Inclusive tournament start. ``None`` = no lower bound.
        window_end: Inclusive tournament end. ``None`` = no upper bound.
    """
    clock = now or datetime.now(timezone.utc)
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=timezone.utc)
    today = clock.date()

    otter_count = 0
    total_digs = 0
    digs_today = 0
    digs_to_first: int | None = None
    digs_to_second: int | None = None
    digs_to_third: int | None = None
    first_op_at: str | None = None
    second_op_at: str | None = None
    third_op_at: str | None = None

    for tile in flatten_grid(grid):
        if not _in_window(tile.dug_at_ms, window_start, window_end):
            continue

        total_digs += 1
        if tile.dug_at_ms is not None and _ms_to_utc(tile.dug_at_ms).date() == today:
            digs_today += 1

        gained = _otter_count_in_items(tile.items)
        if gained <= 0:
            continue

        previous = otter_count
        otter_count += gained
        found_at = _ms_to_utc(tile.dug_at_ms).isoformat() if tile.dug_at_ms is not None else None
        if previous < 1 <= otter_count and digs_to_first is None:
            digs_to_first = total_digs
            first_op_at = found_at
        if previous < 2 <= otter_count and digs_to_second is None:
            digs_to_second = total_digs
            second_op_at = found_at
        if previous < 3 <= otter_count and digs_to_third is None:
            digs_to_third = total_digs
            third_op_at = found_at

    if otter_count >= 3:
        status = STATUS_COMPLETED
        otter_count = 3
    elif total_digs == 0:
        status = STATUS_NOT_STARTED
    else:
        status = STATUS_IN_PROGRESS

    return DigScore(
        digs_to_third_op=digs_to_third,
        otter_count=otter_count,
        total_digs=total_digs,
        digs_today=digs_today,
        status=status,
        digs_to_first_op=digs_to_first,
        digs_to_second_op=digs_to_second,
        first_op_at=first_op_at,
        second_op_at=second_op_at,
        third_op_at=third_op_at,
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def day_cutoff_utc(clock: datetime) -> datetime:
    """23:00:00 UTC on the clock's UTC day — last counted instant that day."""
    day = _as_utc(clock).date()
    return datetime(day.year, day.month, day.day, FINALIZE_HOUR_UTC, 0, 0, tzinfo=timezone.utc)


def is_finalize_clock(clock: datetime) -> bool:
    """True at 23:00 UTC and later that UTC day."""
    return _as_utc(clock).hour >= FINALIZE_HOUR_UTC


def scoring_window_end(window_end: datetime | None, clock: datetime) -> datetime | None:
    """Intersect the tournament end with that day's 23:00 cutoff when finalizing."""
    if not is_finalize_clock(clock):
        return window_end
    cutoff = day_cutoff_utc(clock)
    if window_end is None:
        return cutoff
    return min(_as_utc(window_end), cutoff)


def incomplete_official_score(otter_count: int, highest_completed: int | None) -> int:
    """Official score for a farm that did not find all 3 Otter Pebbles.

    ``max(highest 3rd-OP among completers, 30) + 5 * missing``.
    If nobody finished, the floor is 30.
    """
    missing = max(0, 3 - max(int(otter_count), 0))
    if highest_completed is None:
        base = INCOMPLETE_SCORE_FLOOR
    else:
        base = max(int(highest_completed), INCOMPLETE_SCORE_FLOOR)
    return base + INCOMPLETE_SCORE_PER_MISSING_OP * missing


def _recorded_digs(value: Any) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def fill_incomplete_pebble_digs(row: dict[str, Any], penalty: int) -> dict[str, Any]:
    """Keep found 1st/2nd digs; invent harsh placeholders for missing ones.

    No 2nd pebble → ``penalty - 1``. No 1st pebble → ``penalty - 2``.
    """
    updated = dict(row)
    updated["digs_to_third_op"] = int(penalty)
    if _recorded_digs(updated.get("digs_to_second_op")) is None:
        updated["digs_to_second_op"] = int(penalty) - 1
    if _recorded_digs(updated.get("digs_to_first_op")) is None:
        updated["digs_to_first_op"] = int(penalty) - 2
    return updated


def assign_incomplete_official_scores(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Copy rows and fill unfinished 3rd/2nd/1st pebble digs.

    Completers keep their scores. Invalidated rows are left alone.
    """
    completed_scores: list[int] = []
    for row in rows:
        if row.get("invalidated"):
            continue
        if row.get("status") != STATUS_COMPLETED:
            continue
        raw = row.get("digs_to_third_op")
        if raw is None:
            continue
        try:
            completed_scores.append(int(raw))
        except (TypeError, ValueError):
            continue
    highest = max(completed_scores) if completed_scores else None
    assigned: list[dict[str, Any]] = []
    for row in rows:
        updated = dict(row)
        if updated.get("invalidated") or updated.get("status") == STATUS_COMPLETED:
            assigned.append(updated)
            continue
        otter = int(updated.get("otter_count") or 0)
        penalty = incomplete_official_score(otter, highest)
        assigned.append(fill_incomplete_pebble_digs(updated, penalty))
    return assigned


def _farm_section(farm_payload: Any) -> dict[str, Any]:
    if not isinstance(farm_payload, dict):
        return {}
    farm = farm_payload.get("farm")
    if isinstance(farm, dict):
        return farm
    return farm_payload


def _digging_section(farm_payload: Any) -> dict[str, Any] | None:
    farm = _farm_section(farm_payload)
    desert = farm.get("desert") if isinstance(farm, dict) else None
    if not isinstance(desert, dict):
        return None
    digging = desert.get("digging")
    return digging if isinstance(digging, dict) else None


def extract_grid(farm_payload: Any) -> list[Any]:
    """Pull ``farm.desert.digging.grid`` out of a Community API payload."""
    digging = _digging_section(farm_payload)
    if digging is None:
        return []
    grid = digging.get("grid")
    return grid if isinstance(grid, list) else []


def extract_streak(farm_payload: Any) -> dict[str, Any]:
    """Pull ``farm.desert.digging.streak`` out of a Community API payload.

    Shape is ``{ count, collectedAt, totalClaimed }``. A missing streak
    (or a stored snapshot that never synced one) is count ``0``.
    """
    empty = {"count": 0, "collectedAt": None, "totalClaimed": None}
    if not isinstance(farm_payload, dict):
        return empty

    raw = None
    digging = _digging_section(farm_payload)
    if digging is not None:
        raw = digging.get("streak")
    if not isinstance(raw, dict):
        raw = farm_payload.get("streak")
    if isinstance(raw, dict):
        try:
            count = int(raw.get("count") or 0)
        except (TypeError, ValueError):
            count = 0
        return {
            "count": max(0, count),
            "collectedAt": raw.get("collectedAt", raw.get("collected_at")),
            "totalClaimed": raw.get("totalClaimed", raw.get("total_claimed")),
        }

    if "digging_streak" in farm_payload:
        try:
            count = int(farm_payload.get("digging_streak") or 0)
        except (TypeError, ValueError):
            count = 0
        return {**empty, "count": max(0, count)}
    return empty


def extract_island(farm_payload: Any) -> str | None:
    """Pull ``farm.island.type`` (or a stored snapshot ``island`` string)."""
    farm = _farm_section(farm_payload)
    island = farm.get("island") if isinstance(farm, dict) else None
    if island is None and isinstance(farm_payload, dict):
        island = farm_payload.get("island")
    if isinstance(island, str):
        token = island.strip().lower()
        return token or None
    if isinstance(island, dict):
        token = str(island.get("type") or island.get("name") or "").strip().lower()
        return token or None
    return None


LIFETIME_FARMER_BANNER = "Lifetime Farmer Banner"
VIP_TRIAL_PERIOD = timedelta(days=7)


def _utc_clock(now: datetime | None) -> datetime:
    clock = now or datetime.now(timezone.utc)
    if clock.tzinfo is None:
        return clock.replace(tzinfo=timezone.utc)
    return clock.astimezone(timezone.utc)


def _item_count(raw: Any) -> float:
    if raw is None or raw is False:
        return 0.0
    if raw is True:
        return 1.0
    if isinstance(raw, dict):
        raw = raw.get("value", raw.get("amount", raw.get("toNumber", 0)))
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0


def _inventory_map(source: Any) -> dict[str, Any]:
    if not isinstance(source, dict):
        return {}
    inventory = source.get("inventory")
    return inventory if isinstance(inventory, dict) else {}


def _has_lifetime_farmer_banner(farm_payload: Any) -> bool:
    farm = _farm_section(farm_payload)
    for source in (farm, farm_payload):
        if _item_count(_inventory_map(source).get(LIFETIME_FARMER_BANNER)) > 0:
            return True
    return False


def _stamp_to_utc(raw: Any) -> datetime | None:
    try:
        stamp = float(raw)
    except (TypeError, ValueError):
        return None
    if stamp > 1e12:
        return datetime.fromtimestamp(stamp / 1000, tz=timezone.utc)
    return datetime.fromtimestamp(stamp, tz=timezone.utc)


def extract_vip(farm_payload: Any, *, now: datetime | None = None) -> bool:
    """True when the farm has unexpired VIP, an active trial, or a lifetime banner.

    Matches SFL ``hasVipAccess``: ``vip.expiresAt``, a 7-day ``trialStartedAt``,
    or inventory ``Lifetime Farmer Banner``.
    """
    if _has_lifetime_farmer_banner(farm_payload):
        return True
    farm = _farm_section(farm_payload)
    raw = None
    if isinstance(farm, dict) and "vip" in farm:
        raw = farm.get("vip")
    elif isinstance(farm_payload, dict) and "vip" in farm_payload:
        raw = farm_payload.get("vip")
    if isinstance(raw, bool):
        return raw
    clock = _utc_clock(now)
    if isinstance(raw, dict):
        trial = raw.get("trialStartedAt", raw.get("trial_started_at"))
        started = _stamp_to_utc(trial) if trial is not None else None
        if started is not None and started <= clock < started + VIP_TRIAL_PERIOD:
            return True
        expires = raw.get("expiresAt", raw.get("expires_at"))
        if expires is None:
            return False
        expires_at = _stamp_to_utc(expires)
        if expires_at is None:
            return False
        return expires_at > clock
    if isinstance(farm, dict):
        for key in ("isVIP", "is_vip"):
            if key in farm:
                return bool(farm.get(key))
    return False


def farm_profile_fields(farm_payload: Any, *, now: datetime | None = None) -> dict[str, Any]:
    """Island, VIP, and digging streak used by join gates and FarmSync snapshots."""
    streak = extract_streak(farm_payload)
    return {
        "streak": streak,
        "digging_streak": streak["count"],
        "island": extract_island(farm_payload),
        "vip": extract_vip(farm_payload, now=now),
    }


def iter_raw_tiles(grid: Any) -> Iterable[dict[str, Any]]:
    """Yield original tile dicts (no padding) for debug snapshots."""
    if not isinstance(grid, list):
        return
    for entry in grid:
        if isinstance(entry, list):
            for child in entry:
                if isinstance(child, dict):
                    yield child
        elif isinstance(entry, dict):
            yield entry
