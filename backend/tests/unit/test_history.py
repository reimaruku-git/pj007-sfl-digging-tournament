"""Drive shipped scored-days average — not a reimplementation."""

from datetime import datetime, timezone

from tournament.history import (
    aggregate_days,
    average_scored_days,
    put_farm_day,
    recorded_farm_stats,
    today_live_fields,
)
from tournament.leaderboard import public_entry, rank_scores
from tournament.store import Store


def test_average_scored_days_omits_unscored_today_and_keeps_penalty():
    yesterday_14_today_20 = average_scored_days(
        [
            {"day": "2026-08-17", "digs_to_third_op": 14},
            {"day": "2026-08-18", "digs_to_third_op": 20},
        ]
    )
    assert yesterday_14_today_20 == {"total": 34, "average": 17.0, "scored_days": 2}

    yesterday_only = average_scored_days(
        [
            {"day": "2026-08-17", "digs_to_third_op": 14},
            {"day": "2026-08-18", "digs_to_third_op": None},
        ]
    )
    assert yesterday_only == {"total": 14, "average": 14.0, "scored_days": 1}

    missed_with_penalty = average_scored_days(
        [
            {"day": "2026-08-17", "digs_to_third_op": 14},
            {"day": "2026-08-18", "digs_to_third_op": 40},
        ]
    )
    assert missed_with_penalty["total"] == 54
    assert missed_with_penalty["average"] == 27.0
    assert missed_with_penalty["scored_days"] == 2

    assert average_scored_days([]) == {"total": None, "average": None, "scored_days": 0}


def test_recorded_farm_stats_average_all_stored_days_not_the_featured_window(aws_env):
    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    put_farm_day(
        store,
        "99",
        "2026-07-08",
        {"day": "2026-07-08", "digs_to_third_op": 14, "otter_count": 3, "status": "completed"},
        overwrite_finalized=True,
    )
    put_farm_day(
        store,
        "99",
        "2026-08-17",
        {"day": "2026-08-17", "digs_to_third_op": 20, "otter_count": 3, "status": "completed"},
        overwrite_finalized=True,
    )
    put_farm_day(
        store,
        "99",
        "2026-08-18",
        {
            "day": "2026-08-18",
            "digs_to_third_op": 18,
            "otter_count": 2,
            "digs_today": 12,
            "status": "in_progress",
        },
    )
    stats = recorded_farm_stats(store, "99", now=datetime(2026, 8, 18, 16, tzinfo=timezone.utc))
    assert stats["recorded_average_per_day"] == 17.33
    assert stats["score_today"] == 18
    empty = recorded_farm_stats(store, "missing")
    assert empty["recorded_average_per_day"] is None
    assert empty["score_today"] is None


def test_aggregate_days_writes_total_average_and_today_fields():
    days = [
        {
            "day": "2026-08-17",
            "digs_to_third_op": 14,
            "otter_count": 3,
            "total_digs": 29,
            "digs_today": 29,
            "status": "completed",
        },
        {
            "day": "2026-08-18",
            "digs_to_third_op": None,
            "otter_count": 1,
            "total_digs": 8,
            "digs_today": 8,
            "status": "in_progress",
        },
    ]
    row = aggregate_days(days, farm_id="99", name="rmr", today="2026-08-18")
    assert row["digs_to_third_op"] == 14
    assert row["score"] == 14.0
    assert row["scored_days"] == 1
    assert row["score_today"] is None
    assert row["otter_count"] == 1
    assert row["digs_today"] == 8

    days[1]["digs_to_third_op"] = 20
    days[1]["otter_count"] = 3
    scored = aggregate_days(days, farm_id="99", name="rmr", today="2026-08-18")
    assert scored["digs_to_third_op"] == 34
    assert scored["score"] == 17.0
    assert scored["score_today"] == 20
    assert scored["otter_count"] == 3


def test_today_live_fields_do_not_use_yesterday_pebbles():
    days = [
        {"day": "2026-08-17", "digs_to_third_op": 14, "otter_count": 3, "digs_today": 29},
        {"day": "2026-08-18", "digs_to_third_op": None, "otter_count": 0, "digs_today": 0},
    ]
    assert today_live_fields(days, "2026-08-18") == {
        "score_today": None,
        "otter_count": 0,
        "digs_today": 0,
    }
    assert today_live_fields(days, "2026-08-19")["score_today"] is None


def test_rank_scores_uses_scored_days_average_not_duration():
    rows = [
        {
            "farm_id": "99",
            "name": "rmr",
            "status": "completed",
            "days": [
                {"day": "2026-08-17", "digs_to_third_op": 14},
                {"day": "2026-08-18", "digs_to_third_op": 20},
            ],
        }
    ]
    ranked = rank_scores(rows, tournament_days=7)
    assert ranked[0]["digs_to_third_op"] == 34
    assert ranked[0]["score"] == 17.0
    entry = public_entry(ranked[0])
    assert entry["digs_to_third_op"] == 34
    assert entry["score"] == 17.0
    assert entry["scored_days"] == 2


def test_public_entry_first_and_second_pebble_averages_omit_null_days():
    ranked = rank_scores(
        [
            {
                "farm_id": "99",
                "name": "rmr",
                "status": "completed",
                "days": [
                    {
                        "day": "2026-08-17",
                        "digs_to_first_op": 4,
                        "digs_to_second_op": 8,
                        "digs_to_third_op": 14,
                    },
                    {
                        "day": "2026-08-18",
                        "digs_to_first_op": 6,
                        "digs_to_second_op": None,
                        "digs_to_third_op": 20,
                    },
                    {
                        "day": "2026-08-19",
                        "digs_to_first_op": None,
                        "digs_to_second_op": None,
                        "digs_to_third_op": None,
                    },
                ],
            }
        ],
        tournament_days=7,
    )
    entry = public_entry(ranked[0])
    assert entry["score"] == 17.0
    assert entry["score_first_op"] == 5.0
    assert entry["score_second_op"] == 8.0

    empty = public_entry(
        rank_scores(
            [
                {
                    "farm_id": "99",
                    "name": "rmr",
                    "status": "not_started",
                    "days": [
                        {
                            "day": "2026-08-17",
                            "digs_to_first_op": None,
                            "digs_to_second_op": None,
                        },
                    ],
                }
            ],
            tournament_days=7,
        )[0]
    )
    assert empty["score_first_op"] is None
    assert empty["score_second_op"] is None


def test_first_day_score_still_counts_after_later_empty_day(aws_env):
    """Farms that already dug on day one keep that 3rd-OP in total and average."""
    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    store.put_config(
        {
            "start_at": "2026-08-17T00:00:00+00:00",
            "end_at": "2026-08-24T00:00:00+00:00",
            "duration_days": 7,
        }
    )
    from tournament.history import put_farm_day, rebuild_score_from_days
    from tournament.membership import is_joinable

    put_farm_day(
        store,
        "3666918801844311",
        "2026-08-17",
        {
            "day": "2026-08-17",
            "digs_to_third_op": 14,
            "otter_count": 3,
            "total_digs": 14,
            "status": "completed",
            "finalized": True,
        },
        overwrite_finalized=True,
    )
    put_farm_day(
        store,
        "3666918801844311",
        "2026-08-18",
        {
            "day": "2026-08-18",
            "digs_to_third_op": None,
            "otter_count": 0,
            "total_digs": 0,
            "status": "in_progress",
        },
    )
    assert (
        is_joinable(
            {
                "status": "active",
                "start_at": "2026-08-17T00:00:00+00:00",
            },
            now=datetime(2026, 8, 18, 16, tzinfo=timezone.utc),
        )
        is False
    )
    row = rebuild_score_from_days(
        store,
        "3666918801844311",
        name="rmr",
        now=datetime(2026, 8, 18, 16, tzinfo=timezone.utc),
    )
    assert row["digs_to_third_op"] == 14
    assert row["score"] == 14.0
    assert row["days"][0]["digs_to_third_op"] == 14


def test_empty_grid_day_does_not_erase_yesterday(aws_env):
    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    store.put_config(
        {
            "start_at": "2026-08-17T00:00:00+00:00",
            "end_at": "2026-08-24T00:00:00+00:00",
            "duration_days": 7,
        }
    )
    from tournament.history import put_farm_day, rebuild_score_from_days

    put_farm_day(
        store,
        "99",
        "2026-08-17",
        {
            "day": "2026-08-17",
            "digs_to_third_op": 14,
            "otter_count": 3,
            "total_digs": 14,
            "status": "completed",
            "finalized": True,
        },
        overwrite_finalized=True,
    )
    put_farm_day(
        store,
        "99",
        "2026-08-18",
        {
            "day": "2026-08-18",
            "digs_to_third_op": None,
            "otter_count": 0,
            "total_digs": 0,
            "status": "not_started",
            "grid": [],
        },
    )
    row = rebuild_score_from_days(
        store,
        "99",
        name="rmr",
        now=datetime(2026, 8, 18, 16, tzinfo=timezone.utc),
    )
    assert row["digs_to_third_op"] == 14
    assert row["score"] == 14.0
    assert row["score_today"] is None
    assert store.read_farm_day("99", "2026-08-17")["digs_to_third_op"] == 14
