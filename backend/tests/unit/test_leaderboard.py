from tournament.leaderboard import build_leaderboard, official_score, rank_scores


def test_completed_ranks_by_lowest_score():
    rows = [
        {
            "farm_id": "b",
            "name": "slow",
            "status": "completed",
            "digs_to_third_op": 40,
            "otter_count": 3,
            "total_digs": 40,
            "digs_today": 0,
        },
        {
            "farm_id": "a",
            "name": "fast",
            "status": "completed",
            "digs_to_third_op": 12,
            "otter_count": 3,
            "total_digs": 12,
            "digs_today": 0,
        },
    ]
    ranked = rank_scores(rows)
    assert [row["farm_id"] for row in ranked] == ["a", "b"]
    assert ranked[0]["rank"] == 1
    assert ranked[1]["rank"] == 2


def test_override_beats_computed_score():
    row = {
        "farm_id": "1",
        "status": "completed",
        "digs_to_third_op": 20,
        "override_digs_to_third_op": 9,
        "otter_count": 3,
        "total_digs": 20,
    }
    assert official_score(row) == 9
    board = build_leaderboard([row])
    assert board["entries"][0]["digs_to_third_op"] == 9
    assert board["leader_farm_id"] == "1"


def test_invalidated_is_unranked():
    rows = [
        {
            "farm_id": "good",
            "status": "completed",
            "digs_to_third_op": 15,
            "otter_count": 3,
            "total_digs": 15,
            "invalidated": False,
        },
        {
            "farm_id": "bad",
            "status": "completed",
            "digs_to_third_op": 5,
            "otter_count": 3,
            "total_digs": 5,
            "invalidated": True,
        },
    ]
    ranked = rank_scores(rows)
    assert ranked[0]["farm_id"] == "good"
    assert ranked[0]["rank"] == 1
    assert ranked[1]["farm_id"] == "bad"
    assert ranked[1]["rank"] is None
    assert ranked[1]["status"] == "invalidated"


def test_finalized_incompletes_rank_after_completers_by_penalty():
    rows = [
        {
            "farm_id": "done",
            "status": "completed",
            "digs_to_third_op": 12,
            "otter_count": 3,
            "total_digs": 12,
        },
        {
            "farm_id": "two-op",
            "status": "in_progress",
            "digs_to_third_op": 35,
            "otter_count": 2,
            "total_digs": 8,
        },
        {
            "farm_id": "zero-op",
            "status": "not_started",
            "digs_to_third_op": 45,
            "otter_count": 0,
            "total_digs": 0,
        },
    ]
    ranked = rank_scores(rows)
    assert [row["farm_id"] for row in ranked] == ["done", "two-op", "zero-op"]
    assert ranked[1]["digs_to_third_op"] == 35
    assert ranked[2]["digs_to_third_op"] == 45


def test_same_third_breaks_on_second_then_first_then_times():
    """Tie-break: 3rd digs, then 2nd, then 1st, then 3rd/2nd/1st times."""
    base = {
        "status": "completed",
        "digs_to_third_op": 12,
        "otter_count": 3,
        "total_digs": 12,
    }
    later = {
        **base,
        "farm_id": "later-second",
        "digs_to_second_op": 8,
        "digs_to_first_op": 2,
        "third_op_at": "2026-08-14T12:00:00+00:00",
        "second_op_at": "2026-08-14T11:00:00+00:00",
        "first_op_at": "2026-08-14T10:00:00+00:00",
    }
    earlier_second = {
        **base,
        "farm_id": "earlier-second",
        "digs_to_second_op": 6,
        "digs_to_first_op": 4,
        "third_op_at": "2026-08-14T12:00:00+00:00",
        "second_op_at": "2026-08-14T11:30:00+00:00",
        "first_op_at": "2026-08-14T10:30:00+00:00",
    }
    ranked = rank_scores([later, earlier_second])
    assert [row["farm_id"] for row in ranked] == ["earlier-second", "later-second"]

    same_digs_late = {
        **base,
        "farm_id": "late-clock",
        "digs_to_second_op": 6,
        "digs_to_first_op": 3,
        "third_op_at": "2026-08-14T15:00:00+00:00",
        "second_op_at": "2026-08-14T11:00:00+00:00",
        "first_op_at": "2026-08-14T10:00:00+00:00",
    }
    same_digs_early = {
        **base,
        "farm_id": "early-clock",
        "digs_to_second_op": 6,
        "digs_to_first_op": 3,
        "third_op_at": "2026-08-14T14:00:00+00:00",
        "second_op_at": "2026-08-14T12:00:00+00:00",
        "first_op_at": "2026-08-14T11:00:00+00:00",
    }
    by_time = rank_scores([same_digs_late, same_digs_early])
    assert [row["farm_id"] for row in by_time] == ["early-clock", "late-clock"]
