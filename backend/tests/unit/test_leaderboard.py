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
