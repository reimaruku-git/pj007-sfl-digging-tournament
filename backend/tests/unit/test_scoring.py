"""Sand Drill = 4, 3rd Otter Pebble position is the official score."""

from datetime import datetime, timezone

from tournament.scoring import (
    STATUS_COMPLETED,
    STATUS_IN_PROGRESS,
    STATUS_NOT_STARTED,
    extract_grid,
    flatten_grid,
    score_grid,
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


def test_third_op_inside_nested_drill_uses_flattened_index():
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
    # 2 shovels + 2nd tile of the drill = position 4
    assert result.digs_to_third_op == 4
    assert result.total_digs == 7
    assert result.status == STATUS_COMPLETED


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
    assert result.digs_to_third_op == 1
    assert result.otter_count == 3
    assert result.status == STATUS_COMPLETED


def test_tournament_window_ignores_old_tiles():
    start = datetime(2026, 8, 14, 0, 0, tzinfo=timezone.utc)
    grid = [pebble(dug_at=YESTERDAY_MS), pebble(), pebble(), pebble()]
    result = score_grid(grid, now=NOW, window_start=start)
    assert result.total_digs == 3
    assert result.digs_to_third_op == 3


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
