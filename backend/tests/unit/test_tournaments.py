"""Named tournament catalog: queue, overlap, and rollover."""

import importlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from tournament.catalog import (
    create_tournament,
    delete_tournament,
    list_public_tournaments,
    rollover,
    seed_catalog,
    update_tournament,
)
from tournament.store import Store
from tournament.sync import apply_computed_score, refresh_leaderboard
from tournament.scoring import score_grid


def _store(aws_env) -> Store:
    return Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )


def test_create_overlapping_and_two_live(aws_env):
    store = _store(aws_env)
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    week = create_tournament(
        store,
        {
            "name": "Week cup",
            "start_at": "2026-08-14T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        },
        now=clock,
    )
    month = create_tournament(
        store,
        {
            "name": "Month cup",
            "start_at": "2026-08-01T00:00:00+00:00",
            "duration_days": 30,
            "prize_amount": "45",
        },
        now=clock,
    )
    assert week["status"] == "active"
    assert month["status"] == "active"
    ids = set(store.list_tournament_ids())
    assert week["tournament_id"] in ids
    assert month["tournament_id"] in ids
    featured = store.get_config()["current_tournament_id"]
    # Soonest-ending live event is the 7-day cup.
    assert featured == week["tournament_id"]

    later = create_tournament(
        store,
        {
            "name": "September cup",
            "start_at": "2026-09-01T14:00:00+00:00",
            "end_at": "2026-09-08T14:00:00+00:00",
            "prize_amount": "45",
        },
        now=clock,
    )
    assert later["status"] == "scheduled"
    assert later["name"] == "September cup"


def test_tournament_image_urls_round_trip(aws_env):
    store = _store(aws_env)
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    created = create_tournament(
        store,
        {
            "name": "Art cup",
            "start_at": "2026-08-14T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
            "image_1_url": "https://site/media/tournaments/x/image_1.webp",
            "image_2_url": "https://site/media/tournaments/x/image_2.webp",
        },
        now=clock,
    )
    assert created["image_1_url"].endswith("image_1.webp")
    assert created["image_2_url"].endswith("image_2.webp")
    stored = store.get_tournament(created["tournament_id"])
    assert stored.get("image_1_url") == created["image_1_url"], stored
    listed = list_public_tournaments(store, now=clock)
    match = next(row for row in listed if row["tournament_id"] == created["tournament_id"])
    assert match["image_1_url"] == created["image_1_url"]
    assert match["image_2_url"] == created["image_2_url"]
    updated = update_tournament(
        store,
        created["tournament_id"],
        {"image_1_url": None},
        now=clock,
    )
    assert "image_1_url" not in updated or updated.get("image_1_url") is None


def test_hero_text_round_trip_on_public_summary(aws_env):
    store = _store(aws_env)
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    created = create_tournament(
        store,
        {
            "name": "Art cup",
            "start_at": "2026-08-14T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
            "hero_text": {"color": "#1A1815", "outline": "#E4DFD5"},
        },
        now=clock,
    )
    assert created["hero_text"] == {"color": "#1a1815", "outline": "#e4dfd5"}
    listed = list_public_tournaments(store, now=clock)
    match = next(row for row in listed if row["tournament_id"] == created["tournament_id"])
    assert match["hero_text"] == created["hero_text"]
    updated = update_tournament(
        store,
        created["tournament_id"],
        {"hero_text": {"color": "#b89a56", "outline": "#1a1815"}},
        now=clock,
    )
    assert updated["hero_text"] == {"color": "#b89a56", "outline": "#1a1815"}


def test_one_day_tournament_is_allowed(aws_env):
    store = _store(aws_env)
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    created = create_tournament(
        store,
        {
            "name": "Sprint",
            "start_at": "2026-08-20T00:00:00+00:00",
            "duration_days": 1,
            "prize_amount": "10",
        },
        now=clock,
    )
    assert created["status"] == "scheduled"
    assert created["duration_days"] == 1
    assert created["end_at"].startswith("2026-08-21")


def test_empty_store_has_no_default_live(aws_env):
    store = _store(aws_env)
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    seed_catalog(store, now=clock)
    assert store.list_tournament_ids() == []
    assert list_public_tournaments(store, now=clock) == []
    assert not store.get_config().get("current_tournament_id")
    assert not store.get_config().get("start_at")


def test_can_edit_active_duration(aws_env):
    store = _store(aws_env)
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    live = create_tournament(
        store,
        {
            "name": "Now cup",
            "start_at": "2026-08-10T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        },
        now=clock,
    )
    assert live["status"] == "active"
    updated = update_tournament(
        store,
        live["tournament_id"],
        {
            "name": "Now cup long",
            "start_at": "2026-08-10T00:00:00+00:00",
            "duration_days": 14,
            "prize_amount": "45",
        },
        now=clock,
    )
    assert updated["status"] == "active"
    assert updated["name"] == "Now cup long"
    assert updated["duration_days"] == 14
    assert updated["prize_amount"] == "45"
    assert updated["end_at"].startswith("2026-08-24")
    assert store.get_config()["current_tournament_id"] == updated["tournament_id"]
    assert store.get_config()["duration_days"] == 14


def test_can_delete_active_and_scheduled(aws_env):
    store = _store(aws_env)
    clock = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
    live = create_tournament(
        store,
        {
            "name": "Now cup",
            "start_at": "2026-08-10T00:00:00+00:00",
            "end_at": "2026-08-20T00:00:00+00:00",
            "prize_amount": "30",
        },
        now=clock,
    )
    assert live["status"] == "active"
    delete_tournament(store, live["tournament_id"], now=clock)
    assert store.get_tournament(live["tournament_id"]) is None
    assert not store.get_config().get("current_tournament_id")
    assert not store.get_config().get("start_at")

    upcoming = create_tournament(
        store,
        {
            "name": "Later",
            "start_at": "2026-09-01T00:00:00+00:00",
            "end_at": "2026-09-08T00:00:00+00:00",
            "prize_amount": "30",
        },
        now=clock,
    )
    assert upcoming["status"] == "scheduled"
    delete_tournament(store, upcoming["tournament_id"], now=clock)
    assert store.get_tournament(upcoming["tournament_id"]) is None


def test_rollover_archives_then_promotes_next(aws_env):
    store = _store(aws_env)
    start_live = datetime(2026, 8, 1, tzinfo=timezone.utc)
    store.put_config(
        {
            "start_at": "2026-08-01T00:00:00+00:00",
            "end_at": "2026-08-08T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
            "name": "August one",
            "status": "active",
        }
    )
    computed = score_grid(
        [
            {
                "dugAt": int(datetime(2026, 8, 2, tzinfo=timezone.utc).timestamp() * 1000),
                "items": {"Otter Pebble": 3},
                "tool": "Sand Shovel",
            }
        ],
        now=start_live,
        window_start=start_live,
        window_end=datetime(2026, 8, 8, tzinfo=timezone.utc),
    )
    apply_computed_score(store, farm_id="99", name="rmr", computed=computed, now=start_live)
    store.write_snapshot("99", {"grid": [{"items": {"Otter Pebble": 3}, "tool": "Sand Shovel"}]})
    refresh_leaderboard(store)

    later = datetime(2026, 8, 10, 15, tzinfo=timezone.utc)
    nxt = create_tournament(
        store,
        {
            "name": "August two",
            "start_at": "2026-08-08T00:00:00+00:00",
            "duration_days": 7,
            "prize_amount": "30",
        },
        now=datetime(2026, 8, 7, tzinfo=timezone.utc),
    )
    assert nxt["status"] == "scheduled"

    result = rollover(store, now=later)
    assert result["archived"] is True
    assert result["promoted"] == nxt["tournament_id"]

    old_id = store.list_tournament_ids()
    ended = [store.get_tournament(tid) for tid in old_id]
    archived = next(row for row in ended if row and row["name"] == "August one")
    assert archived["status"] == "ended"
    freeze = store.read_archive(archived["tournament_id"])
    assert freeze is not None
    assert freeze["entries"][0]["farm_id"] == "99"
    assert store.read_archive_farm(archived["tournament_id"], "99") is not None
    live = store.get_config()
    assert live["current_tournament_id"] == nxt["tournament_id"]
    assert live["name"] == "August two"


def test_admin_http_create_and_cancel(aws_env, monkeypatch):
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "lambda_functions" / "main_function"))
    monkeypatch.setenv("DATA_BUCKET", aws_env["bucket"])
    monkeypatch.setenv("CONFIG_TABLE", aws_env["config_table"])
    monkeypatch.setenv("SCORES_TABLE", aws_env["scores_table"])
    monkeypatch.setenv("SUBMISSIONS_TABLE", aws_env["submissions_table"])
    monkeypatch.setenv("ALLOWED_ORIGIN", "*")
    monkeypatch.setenv("FARM_SYNC_FUNCTION", "")
    if "app" in sys.modules:
        del sys.modules["app"]
    app = importlib.import_module("app")
    app.DATA_BUCKET = aws_env["bucket"]
    app.CONFIG_TABLE = aws_env["config_table"]
    app.SCORES_TABLE = aws_env["scores_table"]
    app.SUBMISSIONS_TABLE = aws_env["submissions_table"]
    app.FARM_SYNC_FUNCTION = ""
    app._store = None
    app._registry = None

    created = app.lambda_handler(
        {
            "rawPath": "/admin/tournaments",
            "requestContext": {"http": {"method": "POST"}, "stage": "dev"},
            "headers": {},
            "body": json.dumps(
                {
                    "name": "Autumn",
                    "start_at": "2026-10-01T00:00:00+00:00",
                    "end_at": "2026-10-08T00:00:00+00:00",
                    "prize_amount": "30",
                }
            ),
            "pathParameters": {},
        },
        None,
    )
    assert created["statusCode"] == 201
    payload = json.loads(created["body"])["tournament"]
    tid = payload["tournament_id"]
    listed = app.lambda_handler(
        {
            "rawPath": "/tournaments",
            "requestContext": {"http": {"method": "GET"}, "stage": "dev"},
            "headers": {},
            "body": None,
            "pathParameters": {},
        },
        None,
    )
    names = [row["name"] for row in json.loads(listed["body"])["tournaments"]]
    assert "Autumn" in names
    deleted = app.lambda_handler(
        {
            "rawPath": f"/admin/tournaments/{tid}",
            "requestContext": {"http": {"method": "DELETE"}, "stage": "dev"},
            "headers": {},
            "body": None,
            "pathParameters": {"tournament_id": tid},
        },
        None,
    )
    assert deleted["statusCode"] == 200

    live = app.lambda_handler(
        {
            "rawPath": "/admin/tournaments",
            "requestContext": {"http": {"method": "POST"}, "stage": "dev"},
            "headers": {},
            "body": json.dumps(
                {
                    "name": "Live now",
                    "start_at": "2026-08-10T00:00:00+00:00",
                    "end_at": "2026-09-20T00:00:00+00:00",
                    "prize_amount": "30",
                }
            ),
            "pathParameters": {},
        },
        None,
    )
    assert live["statusCode"] == 201
    live_id = json.loads(live["body"])["tournament"]["tournament_id"]
    assert json.loads(live["body"])["tournament"]["status"] == "active"
    edited = app.lambda_handler(
        {
            "rawPath": f"/admin/tournaments/{live_id}",
            "requestContext": {"http": {"method": "PUT"}, "stage": "dev"},
            "headers": {},
            "body": json.dumps(
                {
                    "name": "Live now",
                    "start_at": "2026-08-10T00:00:00+00:00",
                    "duration_days": 14,
                    "prize_amount": "30",
                }
            ),
            "pathParameters": {"tournament_id": live_id},
        },
        None,
    )
    assert edited["statusCode"] == 200
    assert json.loads(edited["body"])["tournament"]["duration_days"] == 14
    live_id = json.loads(edited["body"])["tournament"]["tournament_id"]
    cancelled = app.lambda_handler(
        {
            "rawPath": f"/admin/tournaments/{live_id}",
            "requestContext": {"http": {"method": "DELETE"}, "stage": "dev"},
            "headers": {},
            "body": None,
            "pathParameters": {"tournament_id": live_id},
        },
        None,
    )
    assert cancelled["statusCode"] == 200
    public = app.lambda_handler(
        {
            "rawPath": "/tournaments",
            "requestContext": {"http": {"method": "GET"}, "stage": "dev"},
            "headers": {},
            "body": None,
            "pathParameters": {},
        },
        None,
    )
    assert json.loads(public["body"])["tournaments"] == []
    assert json.loads(public["body"])["count"] == 0

    public_create = app.lambda_handler(
        {
            "rawPath": "/tournaments",
            "requestContext": {"http": {"method": "POST"}, "stage": "dev"},
            "headers": {},
            "body": json.dumps(
                {"name": "nope", "start_at": "2026-10-01T00:00:00+00:00", "duration_days": 7}
            ),
            "pathParameters": {},
        },
        None,
    )
    assert public_create["statusCode"] == 404


def _load_http(aws_env, monkeypatch):
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "lambda_functions" / "main_function"))
    monkeypatch.setenv("DATA_BUCKET", aws_env["bucket"])
    monkeypatch.setenv("CONFIG_TABLE", aws_env["config_table"])
    monkeypatch.setenv("SCORES_TABLE", aws_env["scores_table"])
    monkeypatch.setenv("SUBMISSIONS_TABLE", aws_env["submissions_table"])
    monkeypatch.setenv("ALLOWED_ORIGIN", "*")
    monkeypatch.setenv("FARM_SYNC_FUNCTION", "")
    if "app" in sys.modules:
        del sys.modules["app"]
    app = importlib.import_module("app")
    app.DATA_BUCKET = aws_env["bucket"]
    app.CONFIG_TABLE = aws_env["config_table"]
    app.SCORES_TABLE = aws_env["scores_table"]
    app.SUBMISSIONS_TABLE = aws_env["submissions_table"]
    app.FARM_SYNC_FUNCTION = ""
    app._store = None
    app._registry = None
    return app


def _http(method: str, path: str, body=None, path_parameters=None):
    return {
        "rawPath": path,
        "requestContext": {"http": {"method": method}, "stage": "dev"},
        "headers": {},
        "body": json.dumps(body) if body is not None else None,
        "pathParameters": path_parameters or {},
    }


def test_http_create_inclusive_window_and_event_settings(aws_env, monkeypatch):
    clock = datetime(2026, 8, 23, 12, tzinfo=timezone.utc)
    monkeypatch.setattr("tournament.catalog._clock", lambda now=None: now or clock)
    app = _load_http(aws_env, monkeypatch)
    settings = {
        "name": "Settings cup",
        "start_at": "2026-08-23T00:00:00+00:00",
        "end_at": "2026-08-30T00:00:00+00:00",
        "prize_amount": "80",
        "min_bumpkin_island": "desert",
        "min_digging_streak": 3,
        "vip_required": True,
        "max_players": 32,
        "join_mode": "auto",
        "description": "Bring a shovel.",
        "nft_giveaway": False,
        "prize_places": [
            {"place": 1, "amount": "50"},
            {"place": 2, "amount": "20"},
            {"place": 3, "amount": "10"},
        ],
    }
    created = app.lambda_handler(_http("POST", "/admin/tournaments", settings), None)
    assert created["statusCode"] == 201, created
    row = json.loads(created["body"])["tournament"]
    assert row["duration_days"] == 8
    assert row["start_at"].startswith("2026-08-23")
    assert row["end_at"].startswith("2026-08-31")
    from tournament.stats import iter_window_days
    from tournament.window import parse_iso

    window_days = list(iter_window_days(parse_iso(row["start_at"]), parse_iso(row["end_at"])))
    assert window_days[0].isoformat() == "2026-08-23"
    assert window_days[-1].isoformat() == "2026-08-30"
    assert len(window_days) == 8
    assert row["min_bumpkin_island"] == "desert"
    assert row["min_digging_streak"] == 3
    assert row["vip_required"] is True
    assert row["max_players"] == 32
    assert row["join_mode"] == "auto"
    assert row["description"] == "Bring a shovel."
    assert row["nft_giveaway"] is False
    assert row["hero_text"] == {"color": "#e4dfd5", "outline": "#1a1815"}
    assert row["prize_places"] == [
        {"place": 1, "amount": "50"},
        {"place": 2, "amount": "20"},
        {"place": 3, "amount": "10"},
    ]
    assert row["prize_amount"] == "80"
    tid = row["tournament_id"]

    listed = app.lambda_handler(_http("GET", "/tournaments"), None)
    assert listed["statusCode"] == 200
    found = next(
        item for item in json.loads(listed["body"])["tournaments"] if item["tournament_id"] == tid
    )
    assert found["duration_days"] == 8
    assert found["min_bumpkin_island"] == "desert"
    assert found["min_digging_streak"] == 3
    assert found["vip_required"] is True
    assert found["max_players"] == 32
    assert found["nft_giveaway"] is False
    assert found["prize_places"][0]["amount"] == "50"

    detail = app.lambda_handler(
        _http("GET", f"/tournaments/{tid}", path_parameters={"tournament_id": tid}),
        None,
    )
    assert detail["statusCode"] == 200
    config = json.loads(detail["body"])["tournament"]["config"]
    assert config["min_bumpkin_island"] == "desert"
    assert config["min_digging_streak"] == 3
    assert config["vip_required"] is True
    assert config["nft_giveaway"] is False
    assert config["prize_places"] == row["prize_places"]

    nft_edit = app.lambda_handler(
        _http(
            "PUT",
            f"/admin/tournaments/{tid}",
            {
                "nft_giveaway": True,
                "join_mode": "confirm",
                "description": "Updated blurb.",
                "prize_places": [
                    {"place": 1, "amount": "40", "nft_name": "Rare Key"},
                    {"place": 2, "amount": "10", "nft_name": ""},
                ],
            },
            path_parameters={"tournament_id": tid},
        ),
        None,
    )
    assert nft_edit["statusCode"] == 200, nft_edit
    updated = json.loads(nft_edit["body"])["tournament"]
    assert updated["nft_giveaway"] is True
    assert updated["join_mode"] == "confirm"
    assert updated["description"] == "Updated blurb."
    assert updated["prize_places"] == [
        {"place": 1, "amount": "40", "nft_name": "Rare Key"},
        {"place": 2, "amount": "10", "nft_name": ""},
    ]
    assert updated["prize_amount"] == "80"
    assert updated["min_bumpkin_island"] == "desert"

    omitted = app.lambda_handler(
        _http(
            "POST",
            "/admin/tournaments",
            {
                "name": "Plain cup",
                "start_at": "2026-11-01T00:00:00+00:00",
                "duration_days": 7,
                "prize_amount": "30",
            },
        ),
        None,
    )
    assert omitted["statusCode"] == 201, omitted
    plain = json.loads(omitted["body"])["tournament"]
    assert plain["min_bumpkin_island"] is None
    assert plain["min_digging_streak"] is None
    assert plain["vip_required"] is False
    assert plain["max_players"] is None
    assert plain["join_mode"] == "confirm"
    assert plain["description"] == ""
    assert plain["prize_places"] == []
    assert plain["nft_giveaway"] is False

    public_plain = app.lambda_handler(
        _http(
            "GET",
            f"/tournaments/{plain['tournament_id']}",
            path_parameters={"tournament_id": plain["tournament_id"]},
        ),
        None,
    )
    public_config = json.loads(public_plain["body"])["tournament"]["config"]
    assert public_config["join_mode"] == "confirm"
    assert public_config["min_bumpkin_island"] is None
    assert public_config["min_digging_streak"] is None
    assert public_config["vip_required"] is False
    assert public_config["nft_giveaway"] is False

    mismatch = app.lambda_handler(
        _http(
            "POST",
            "/admin/tournaments",
            {
                "name": "Bad prizes",
                "start_at": "2026-12-01T00:00:00+00:00",
                "duration_days": 7,
                "prize_amount": "50",
                "nft_giveaway": False,
                "prize_places": [
                    {"place": 1, "amount": "40"},
                    {"place": 2, "amount": "20"},
                ],
            },
        ),
        None,
    )
    assert mismatch["statusCode"] == 400
    assert json.loads(mismatch["body"])["error"] == "VALIDATION_ERROR"
    assert "sum" in json.loads(mismatch["body"])["message"]

    bad = app.lambda_handler(
        _http(
            "POST",
            "/admin/tournaments",
            {
                "name": "Bad mode",
                "start_at": "2026-12-01T00:00:00+00:00",
                "duration_days": 7,
                "prize_amount": "30",
                "join_mode": "maybe",
            },
        ),
        None,
    )
    assert bad["statusCode"] == 400
    assert json.loads(bad["body"])["error"] == "VALIDATION_ERROR"


def test_nft_giveaway_accepts_a_text_prize_pool(aws_env, monkeypatch):
    clock = datetime(2026, 8, 23, 12, tzinfo=timezone.utc)
    monkeypatch.setattr("tournament.catalog._clock", lambda now=None: now or clock)
    app = _load_http(aws_env, monkeypatch)
    created = app.lambda_handler(
        _http(
            "POST",
            "/admin/tournaments",
            {
                "name": "NFT pack cup",
                "start_at": "2026-09-01T00:00:00+00:00",
                "duration_days": 7,
                "prize_amount": "3x Rare Key",
                "nft_giveaway": True,
            },
        ),
        None,
    )
    assert created["statusCode"] == 201, created
    row = json.loads(created["body"])["tournament"]
    assert row["prize_amount"] == "3x Rare Key"
    assert row["nft_giveaway"] is True
    listed = app.lambda_handler(_http("GET", "/tournaments"), None)
    found = next(
        item
        for item in json.loads(listed["body"])["tournaments"]
        if item["tournament_id"] == row["tournament_id"]
    )
    assert found["prize_amount"] == "3x Rare Key"
