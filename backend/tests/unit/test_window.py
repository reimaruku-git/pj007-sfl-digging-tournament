from datetime import datetime, timezone

from tournament.stats import iter_window_days
from tournament.window import inclusive_calendar_days, last_inclusive_date, parse_iso


def test_inclusive_calendar_days_counts_both_dates():
    start = datetime(2026, 8, 23, tzinfo=timezone.utc)
    last = datetime(2026, 8, 30, tzinfo=timezone.utc)
    assert inclusive_calendar_days(start, last) == 8
    assert last_inclusive_date(start, 8) == last.date()


def test_inclusive_same_day_is_one():
    day = datetime(2026, 8, 23, tzinfo=timezone.utc)
    assert inclusive_calendar_days(day, day) == 1


def test_stored_exclusive_end_includes_last_calendar_day():
    start = parse_iso("2026-08-23T00:00:00+00:00")
    end = parse_iso("2026-08-31T00:00:00+00:00")
    days = list(iter_window_days(start, end))
    assert days[0].isoformat() == "2026-08-23"
    assert days[-1].isoformat() == "2026-08-30"
    assert len(days) == 8
