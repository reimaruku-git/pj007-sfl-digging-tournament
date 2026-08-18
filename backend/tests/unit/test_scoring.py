"""Sand Drill = 4, 3rd Otter Pebble position is the official score."""

from datetime import datetime, timezone

from tournament.scoring import (
    STATUS_COMPLETED,
    STATUS_IN_PROGRESS,
    STATUS_NOT_STARTED,
    assign_incomplete_official_scores,
    extract_grid,
    extract_streak,
    flatten_grid,
    incomplete_official_score,
    is_finalize_clock,
    score_grid,
    scoring_window_end,
)

NOW = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)
TODAY_MS = int(NOW.timestamp() * 1000)
YESTERDAY_MS = TODAY_MS - 86_400_000


def shovel(items=None, dug_at=TODAY_MS):
    return {
        "dugAt": dug_at,
        "x": 1,
        "y": 1,
        "items": items or {"Sand": 1},
        "tool": "Sand Shovel",
    }


def pebble(dug_at=TODAY_MS):
    return shovel({"Otter Pebble": 1}, dug_at=dug_at)


def test_empty_grid_is_not_started():
    result = score_grid([], now=NOW)
    assert result.status == STATUS_NOT_STARTED
    assert result.total_digs == 0
    assert result.otter_count == 0
    assert result.digs_to_third_op is None


def test_three_shovel_pebbles_score_is_third_position():
    grid = [
        shovel(),
        pebble(),
        shovel(),
        pebble(),
        shovel(),
        pebble(),
        shovel({"Crab": 1}),
    ]
    result = score_grid(grid, now=NOW)
    assert result.digs_to_first_op == 2
    assert result.digs_to_second_op == 4
    assert result.digs_to_third_op == 6
    assert result.otter_count == 3
    assert result.total_digs == 7
    assert result.status == STATUS_COMPLETED


def test_further_digs_do_not_change_score():
    grid = [pebble(), pebble(), pebble(), pebble(), pebble()]
    result = score_grid(grid, now=NOW)
    assert result.digs_to_third_op == 3
    assert result.otter_count == 3
    assert result.total_digs == 5


def test_nested_sand_drill_is_four_flattened_positions():
    grid = [
        shovel(),
        [
            shovel({"Sand": 1}),
            pebble(),
            shovel({"Crab": 1}),
            shovel({"Sand": 1}),
        ],
    ]
    flat = flatten_grid(grid)
    assert len(flat) == 5
    assert [tile.source for tile in flat] == [
        "shovel",
        "drill_group",
        "drill_group",
        "drill_group",
        "drill_group",
    ]
    result = score_grid(grid, now=NOW)
    assert result.total_digs == 5
    assert result.otter_count == 1
    assert result.digs_to_third_op is None
    assert result.status == STATUS_IN_PROGRESS


def test_third_op_inside_nested_drill_lands_on_last_of_four():
    grid = [
        pebble(),
        pebble(),
        [
            shovel({"Sand": 1}),
            pebble(),
            shovel({"Sand": 1}),
            shovel({"Sand": 1}),
        ],
        shovel(),
    ]
    result = score_grid(grid, now=NOW)
    # 2 shovels + 4 drill slots; OP is attributed to the last drill slot
    assert result.digs_to_third_op == 6
    assert result.total_digs == 7
    assert result.status == STATUS_COMPLETED


def test_api_numbers_one_drill_as_fifth_official_count_is_eighth():
    """Four prior shovels + one drill the API stamps as the 5th dig on all 4 holes."""
    fifth = TODAY_MS + 5_000
    holes = [
        {"dugAt": fifth, "items": {"Otter Pebble": 1}, "tool": "Sand Shovel"},
        {"dugAt": fifth, "items": {"Sand": 1}, "tool": "Sand Shovel"},
        {"dugAt": fifth, "items": {"Sand": 1}, "tool": "Sand Shovel"},
        {"dugAt": fifth, "items": {"Sand": 1}, "tool": "Sand Shovel"},
    ]
    # Nested group (how SFL often returns a drill)
    nested = [pebble(), pebble(), shovel(), shovel(), holes]
    nested_score = score_grid(nested, now=NOW)
    assert [tile.source for tile in flatten_grid(nested)[4:]] == [
        "drill_group",
        "drill_group",
        "drill_group",
        "drill_group",
    ]
    assert nested_score.digs_to_third_op == 8
    assert nested_score.total_digs == 8
    assert nested_score.otter_count == 3
    assert nested_score.status == STATUS_COMPLETED

    # Four sibling Sand Drill holes stamped with the same dugAt
    drill_holes = [
        {"dugAt": fifth, "items": {"Otter Pebble": 1}, "tool": "Sand Drill"},
        {"dugAt": fifth, "items": {"Sand": 1}, "tool": "Sand Drill"},
        {"dugAt": fifth, "items": {"Sand": 1}, "tool": "Sand Drill"},
        {"dugAt": fifth, "items": {"Sand": 1}, "tool": "Sand Drill"},
    ]
    sibling_score = score_grid(
        [pebble(), pebble(), shovel(), shovel(), *drill_holes],
        now=NOW,
    )
    assert sibling_score.digs_to_third_op == 8
    assert sibling_score.total_digs == 8
    assert sibling_score.otter_count == 3


def test_drill_does_not_count_the_same_op_four_times():
    fifth = TODAY_MS + 5_000
    holes = [{"dugAt": fifth, "items": {"Otter Pebble": 1}, "tool": "Sand Shovel"}] * 4
    result = score_grid([holes], now=NOW)
    assert result.total_digs == 4
    assert result.otter_count == 1
    assert result.digs_to_third_op is None


def test_nested_drill_with_fewer_than_four_tiles_still_costs_four():
    grid = [[pebble(), shovel({"Sand": 1})]]
    result = score_grid(grid, now=NOW)
    assert result.total_digs == 4
    assert result.otter_count == 1


def test_top_level_sand_drill_object_costs_four():
    grid = [
        {
            "dugAt": TODAY_MS,
            "items": {"Otter Pebble": 1},
            "tool": "Sand Drill",
        }
    ]
    result = score_grid(grid, now=NOW)
    assert result.total_digs == 4
    assert result.otter_count == 1
    assert result.digs_to_third_op is None


def test_five_shovels_then_last_tile_drill_op_is_ninth():
    """After 5 shovel digs the next drill is 6–9; OP on the last tile is #9."""
    grid = [
        pebble(),
        pebble(),
        shovel(),
        shovel(),
        shovel(),
        [
            shovel({"Sand": 1}),
            shovel({"Sand": 1}),
            shovel({"Sand": 1}),
            pebble(),
        ],
        pebble(),
        shovel(),
    ]
    result = score_grid(grid, now=NOW)
    assert result.digs_to_third_op == 9
    assert result.otter_count == 3
    assert result.status == STATUS_COMPLETED
    # Extra tiles after the 3rd OP do not move the official score.
    assert result.total_digs == 11

    standalone = [
        pebble(),
        pebble(),
        shovel(),
        shovel(),
        shovel(),
        {
            "dugAt": TODAY_MS,
            "items": {"Otter Pebble": 1},
            "tool": "Sand Drill",
        },
        pebble(),
    ]
    again = score_grid(standalone, now=NOW)
    assert again.digs_to_third_op == 9
    assert again.otter_count == 3


def test_third_op_on_standalone_drill_is_position_after_four_digs():
    grid = [
        pebble(),
        pebble(),
        {
            "dugAt": TODAY_MS,
            "items": {"Otter Pebble": 1},
            "tool": "Sand Drill",
        },
    ]
    result = score_grid(grid, now=NOW)
    # 2 shovels + 4 drill positions, items land on the 4th drill slot
    assert result.digs_to_third_op == 6
    assert result.total_digs == 6
    assert result.status == STATUS_COMPLETED


def test_multiple_pebbles_on_one_tile():
    grid = [shovel({"Otter Pebble": 3})]
    result = score_grid(grid, now=NOW)
    assert result.digs_to_first_op == 1
    assert result.digs_to_second_op == 1
    assert result.digs_to_third_op == 1
    assert result.otter_count == 3
    assert result.status == STATUS_COMPLETED
    assert result.first_op_at == result.third_op_at


def test_tournament_window_ignores_old_tiles():
    start = datetime(2026, 8, 14, 0, 0, tzinfo=timezone.utc)
    grid = [pebble(dug_at=YESTERDAY_MS), pebble(), pebble(), pebble()]
    result = score_grid(grid, now=NOW, window_start=start)
    assert result.total_digs == 3
    assert result.digs_to_third_op == 3


def test_tournament_window_ignores_tiles_after_end():
    start = datetime(2026, 8, 14, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 8, 14, 18, 0, tzinfo=timezone.utc)
    after = int(datetime(2026, 8, 14, 20, 0, tzinfo=timezone.utc).timestamp() * 1000)
    grid = [pebble(), pebble(), pebble(dug_at=after)]
    result = score_grid(grid, now=NOW, window_start=start, window_end=end)
    assert result.total_digs == 2
    assert result.otter_count == 2
    assert result.digs_to_third_op is None
    assert result.status == STATUS_IN_PROGRESS


def test_missing_dug_at_still_counts_inside_a_window():
    start = datetime(2026, 8, 14, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 8, 21, 0, 0, tzinfo=timezone.utc)
    grid = [
        pebble(),
        pebble(),
        {"items": {"Otter Pebble": 1}, "tool": "Sand Shovel"},
    ]
    result = score_grid(grid, now=NOW, window_start=start, window_end=end)
    assert result.total_digs == 3
    assert result.digs_to_third_op == 3
    assert result.status == STATUS_COMPLETED


def test_unknown_tool_costs_one():
    grid = [
        {"dugAt": TODAY_MS, "items": {"Sand": 1}, "tool": "Mystery Scoop"},
        pebble(),
    ]
    result = score_grid(grid, now=NOW)
    assert result.total_digs == 2
    assert result.otter_count == 1
    assert result.status == STATUS_IN_PROGRESS


def test_digs_today_only_counts_today():
    grid = [pebble(dug_at=YESTERDAY_MS), shovel(), shovel()]
    result = score_grid(grid, now=NOW)
    assert result.total_digs == 3
    assert result.digs_today == 2


def test_extract_grid_from_community_payload():
    payload = {
        "farm": {
            "desert": {
                "digging": {
                    "grid": [shovel()],
                }
            }
        }
    }
    assert len(extract_grid(payload)) == 1
    assert extract_grid({}) == []
    assert extract_grid({"farm": {}}) == []


def test_extract_streak_from_community_payload():
    payload = {
        "farm": {
            "desert": {
                "digging": {
                    "grid": [shovel()],
                    "streak": {
                        "count": 9,
                        "collectedAt": "2026-08-16T00:00:00.000Z",
                        "totalClaimed": 9,
                    },
                }
            }
        }
    }
    streak = extract_streak(payload)
    assert streak["count"] == 9
    assert streak["collectedAt"] == "2026-08-16T00:00:00.000Z"
    assert extract_streak({})["count"] == 0
    assert extract_streak({"farm": {}})["count"] == 0
    assert extract_streak({"digging_streak": 4})["count"] == 4


def _ms(year, month, day, hour, minute=0, second=0):
    return int(
        datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc).timestamp() * 1000
    )


def test_tile_after_2300_utc_is_ignored_on_finalize_window():
    clock = datetime(2026, 8, 14, 23, 0, tzinfo=timezone.utc)
    before = _ms(2026, 8, 14, 22, 59)
    after = _ms(2026, 8, 14, 23, 0, 1)
    grid = [pebble(dug_at=before), pebble(dug_at=before), pebble(dug_at=after)]
    result = score_grid(grid, now=clock, window_end=scoring_window_end(None, clock))
    assert result.total_digs == 2
    assert result.otter_count == 2
    assert result.digs_to_third_op is None
    assert result.status == STATUS_IN_PROGRESS


def test_tile_at_exactly_2300_still_counts():
    clock = datetime(2026, 8, 14, 23, 0, tzinfo=timezone.utc)
    at_cutoff = _ms(2026, 8, 14, 23, 0)
    grid = [pebble(dug_at=at_cutoff), pebble(dug_at=at_cutoff), pebble(dug_at=at_cutoff)]
    result = score_grid(grid, now=clock, window_end=scoring_window_end(None, clock))
    assert result.digs_to_third_op == 3
    assert result.status == STATUS_COMPLETED


def test_completed_farm_keeps_third_op_score():
    rows = [
        {
            "farm_id": "done",
            "status": STATUS_COMPLETED,
            "digs_to_third_op": 12,
            "otter_count": 3,
        },
        {
            "farm_id": "short",
            "status": STATUS_IN_PROGRESS,
            "digs_to_third_op": None,
            "otter_count": 2,
        },
    ]
    assigned = assign_incomplete_official_scores(rows)
    by_id = {row["farm_id"]: row for row in assigned}
    assert by_id["done"]["digs_to_third_op"] == 12
    assert by_id["done"]["status"] == STATUS_COMPLETED


def test_incomplete_formula_missing_one_two_three_op():
    highest = 18
    assert incomplete_official_score(2, highest) == max(highest, 30) + 5 * 1
    assert incomplete_official_score(1, highest) == max(highest, 30) + 5 * 2
    assert incomplete_official_score(0, highest) == max(highest, 30) + 5 * 3

    rows = [
        {"farm_id": "c", "status": STATUS_COMPLETED, "digs_to_third_op": 18, "otter_count": 3},
        {"farm_id": "m1", "status": STATUS_IN_PROGRESS, "digs_to_third_op": None, "otter_count": 2},
        {"farm_id": "m2", "status": STATUS_IN_PROGRESS, "digs_to_third_op": None, "otter_count": 1},
        {"farm_id": "m3", "status": STATUS_NOT_STARTED, "digs_to_third_op": None, "otter_count": 0},
    ]
    assigned = {row["farm_id"]: row for row in assign_incomplete_official_scores(rows)}
    assert assigned["c"]["digs_to_third_op"] == 18
    assert assigned["m1"]["digs_to_third_op"] == 35
    assert assigned["m2"]["digs_to_third_op"] == 40
    assert assigned["m3"]["digs_to_third_op"] == 45
    assert assigned["m3"]["digs_to_second_op"] == 44
    assert assigned["m3"]["digs_to_first_op"] == 43


def test_incomplete_keeps_found_pebbles_and_fills_missing_from_penalty():
    rows = [
        {
            "farm_id": "dug",
            "status": STATUS_IN_PROGRESS,
            "otter_count": 1,
            "digs_to_first_op": 8,
            "digs_to_second_op": None,
            "digs_to_third_op": None,
        },
        {
            "farm_id": "idle",
            "status": STATUS_NOT_STARTED,
            "otter_count": 0,
            "digs_to_first_op": None,
            "digs_to_second_op": None,
            "digs_to_third_op": None,
        },
    ]
    assigned = {row["farm_id"]: row for row in assign_incomplete_official_scores(rows)}
    assert assigned["dug"]["digs_to_third_op"] == 40
    assert assigned["dug"]["digs_to_second_op"] == 39
    assert assigned["dug"]["digs_to_first_op"] == 8
    assert assigned["idle"]["digs_to_third_op"] == 45
    assert assigned["idle"]["digs_to_second_op"] == 44
    assert assigned["idle"]["digs_to_first_op"] == 43


def test_incomplete_floor_is_30_when_highest_completed_is_lower():
    assert incomplete_official_score(2, 12) == 35


def test_no_completers_uses_floor_30():
    assert incomplete_official_score(1, None) == 40
    rows = [
        {"farm_id": "a", "status": STATUS_IN_PROGRESS, "digs_to_third_op": None, "otter_count": 2},
        {"farm_id": "b", "status": STATUS_NOT_STARTED, "digs_to_third_op": None, "otter_count": 0},
    ]
    assigned = {row["farm_id"]: row for row in assign_incomplete_official_scores(rows)}
    assert assigned["a"]["digs_to_third_op"] == 35
    assert assigned["a"]["digs_to_second_op"] == 34
    assert assigned["a"]["digs_to_first_op"] == 33
    assert assigned["b"]["digs_to_third_op"] == 45
    assert assigned["b"]["digs_to_second_op"] == 44
    assert assigned["b"]["digs_to_first_op"] == 43


def test_midday_clock_does_not_apply_2300_cutoff():
    tournament_end = datetime(2026, 8, 21, 0, 0, tzinfo=timezone.utc)
    after = _ms(2026, 8, 14, 23, 30)
    grid = [pebble(dug_at=after)]
    for hour in (14, 16, 18, 20):
        midday = datetime(2026, 8, 14, hour, 0, tzinfo=timezone.utc)
        assert is_finalize_clock(midday) is False
        assert scoring_window_end(tournament_end, midday) == tournament_end
        result = score_grid(grid, now=midday, window_end=scoring_window_end(tournament_end, midday))
        assert result.total_digs == 1
        assert result.otter_count == 1


def test_finalize_clock_is_2300_and_later_same_day():
    assert is_finalize_clock(datetime(2026, 8, 14, 22, 59, tzinfo=timezone.utc)) is False
    assert is_finalize_clock(datetime(2026, 8, 14, 23, 0, tzinfo=timezone.utc)) is True
    assert is_finalize_clock(datetime(2026, 8, 14, 23, 45, tzinfo=timezone.utc)) is True
    assert is_finalize_clock(datetime(2026, 8, 15, 0, 0, tzinfo=timezone.utc)) is False
