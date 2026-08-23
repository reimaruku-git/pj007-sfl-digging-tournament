"""Tournament window length and average-day helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from tournament.store import MIN_TOURNAMENT_DAYS


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def duration_days(start: datetime | None, end: datetime | None) -> int:
    if start is None or end is None or end <= start:
        return MIN_TOURNAMENT_DAYS
    return max(1, int((end - start).total_seconds() // 86_400))


def inclusive_calendar_days(start: datetime | None, last_day: datetime | None) -> int:
    """UTC calendar dates from ``start`` through ``last_day``, both included.

    August 23 through August 30 is 8. The same calendar day is 1.
    """
    if start is None or last_day is None:
        return 0
    start_d = start.date()
    last_d = last_day.date()
    if last_d < start_d:
        return 0
    return (last_d - start_d).days + 1


def last_inclusive_date(start: datetime, days: int):
    """Last UTC calendar date scored for a window of ``days`` exclusive length."""
    return (start + timedelta(days=max(int(days), 1) - 1)).date()


def tournament_days_for_average(
    start: datetime | None,
    end: datetime | None,
    now: datetime,
) -> int:
    """Days used for average digs.

    Uses elapsed UTC calendar days in the window (inclusive, at least 1),
    capped at the configured length. After the event ends, uses the full
    configured length. A 7-day and a 30-day window therefore divide the
    same total by 7 vs 30 once the event is over.
    """
    configured = duration_days(start, end)
    if start is None or end is None:
        return configured
    clock = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    if clock >= end:
        return configured
    if clock <= start:
        return 1
    elapsed = (clock.date() - start.date()).days + 1
    return max(1, min(configured, elapsed))


def avg_digs_per_day(total_digs: int, days: int) -> float:
    """Legacy helper. Official board score is ``official_score_average``."""
    return round(int(total_digs or 0) / max(int(days), 1), 2)


def official_score_average(digs_to_third: int | None, days: int) -> float | None:
    """3rd-pebble digs divided by the configured tournament length.

    Digs after the 3rd pebble are not in ``digs_to_third``. A missing
    official dig count yields ``None``.
    """
    if digs_to_third is None:
        return None
    try:
        value = int(digs_to_third)
    except (TypeError, ValueError):
        return None
    return round(value / max(int(days), 1), 2)


def configured_duration_days(config: dict[str, Any]) -> int:
    start = parse_iso(config.get("start_at"))
    end = parse_iso(config.get("end_at"))
    raw = config.get("duration_days")
    try:
        days = int(raw) if raw is not None else 0
    except (TypeError, ValueError):
        days = 0
    return days or duration_days(start, end)


def default_tournament_name(start: datetime | None) -> str:
    if start is None:
        return "Digging tournament"
    return f"Week of {start.day} {start.strftime('%b')}"


def tournament_id(config: dict[str, Any]) -> str:
    start = parse_iso(config.get("start_at"))
    end = parse_iso(config.get("end_at"))
    days = int(config.get("duration_days") or 0) or duration_days(start, end)
    stamp = start.strftime("%Y%m%dT%H%M%SZ") if start else "unknown"
    return f"{stamp}_{days}d"
