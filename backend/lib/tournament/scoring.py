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
  Mid-day syncs (14/16/18/20 UTC) do not assign that penalty.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
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


def assign_incomplete_official_scores(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Copy rows and fill ``digs_to_third_op`` for farms that are not completed.

    Completers keep their 3rd-OP score. Invalidated rows are left alone.
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
        updated["digs_to_third_op"] = incomplete_official_score(otter, highest)
        assigned.append(updated)
    return assigned


def extract_grid(farm_payload: Any) -> list[Any]:
    """Pull ``farm.desert.digging.grid`` out of a Community API payload."""
    if not isinstance(farm_payload, dict):
        return []
    farm = farm_payload.get("farm")
    if not isinstance(farm, dict):
        farm = farm_payload
    desert = farm.get("desert") if isinstance(farm, dict) else None
    if not isinstance(desert, dict):
        return []
    digging = desert.get("digging")
    if not isinstance(digging, dict):
        return []
    grid = digging.get("grid")
    return grid if isinstance(grid, list) else []


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
