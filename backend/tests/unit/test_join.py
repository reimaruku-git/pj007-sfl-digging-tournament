"""Drive the shipped public submit/join path."""

import importlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from tournament.membership import first_day_join_cutoff, is_joinable
from tournament.sfl_client import SFLApiError

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lambda_functions" / "main_function"))


def _load_app(aws_env, monkeypatch):
    monkeypatch.setenv("DATA_BUCKET", aws_env["bucket"])
    monkeypatch.setenv("CONFIG_TABLE", aws_env["config_table"])
    monkeypatch.setenv("SCORES_TABLE", aws_env["scores_table"])
    monkeypatch.setenv("SUBMISSIONS_TABLE", aws_env["submissions_table"])
    monkeypatch.setenv("SFL_API_KEY", "test-key")
    monkeypatch.setenv("ALLOWED_ORIGIN", "*")
    monkeypatch.setenv("FARM_SYNC_FUNCTION", "")
    if "app" in sys.modules:
        del sys.modules["app"]
    module = importlib.import_module("app")
    module.DATA_BUCKET = aws_env["bucket"]
    module.CONFIG_TABLE = aws_env["config_table"]
    module.SCORES_TABLE = aws_env["scores_table"]
    module.SUBMISSIONS_TABLE = aws_env["submissions_table"]
    module.FARM_SYNC_FUNCTION = ""
    module.SECRETS_BUCKET = ""
    module.SFL_KEYS_OBJECT = "sfl-api-keys.json"
    module._store = None
    module._registry = None
    module._lambda = None
    return module


def _event(method: str, path: str, body=None):
    return {
        "rawPath": path,
        "requestContext": {"http": {"method": method}, "stage": "dev"},
        "headers": {"origin": "http://localhost:5173"},
        "body": json.dumps(body) if body is not None else None,
        "pathParameters": {},
    }


def _json(response):
    return json.loads(response["body"])


def _create_joinable(app, *, name, start, end, **extra):
    body = {
        "name": name,
        "start_at": start,
        "end_at": end,
        "prize_amount": "30",
    }
    body.update(extra)
    created = app.lambda_handler(
        _event(
            "POST",
            "/admin/tournaments",
            body,
        ),
        None,
    )
    assert created["statusCode"] == 201, created
    return _json(created)["tournament"]


def test_submit_without_tournament_id_is_invalid(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    missing = app.lambda_handler(
        _event("POST", "/submissions", {"farm_id": "3666918801844311", "name": "rmr"}),
        None,
    )
    assert missing["statusCode"] == 400
    body = _json(missing)
    assert body["error"] == "VALIDATION_ERROR"
    assert "tournament_id" in body["message"]


def test_submit_one_or_many_joinable_creates_pending(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Live cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
    )
    later = _create_joinable(
        app,
        name="September cup",
        start="2026-09-01T00:00:00+00:00",
        end="2026-09-08T00:00:00+00:00",
    )

    one = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "name": "rmr",
                "tournament_id": live["tournament_id"],
            },
        ),
        None,
    )
    assert one["statusCode"] == 201
    payload = _json(one)
    assert payload["count"] == 1
    assert payload["submissions"][0]["farm_id"] == "3666918801844311"
    assert payload["submissions"][0]["tournament_id"] == live["tournament_id"]
    assert payload["submissions"][0]["status"] == "pending"

    many = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "2791164672544774",
                "name": "bob",
                "tournament_ids": [live["tournament_id"], later["tournament_id"]],
            },
        ),
        None,
    )
    assert many["statusCode"] == 201
    many_body = _json(many)
    assert many_body["count"] == 2
    ids = {row["tournament_id"] for row in many_body["submissions"]}
    assert ids == {live["tournament_id"], later["tournament_id"]}


def test_tracked_farm_can_request_another_tournament(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Live cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
    )
    later = _create_joinable(
        app,
        name="September cup",
        start="2026-09-01T00:00:00+00:00",
        end="2026-09-08T00:00:00+00:00",
    )
    added = app.lambda_handler(
        _event("POST", "/admin/farms", {"farm_id": "3666918801844311", "name": "rmr"}),
        None,
    )
    assert added["statusCode"] == 201

    joined = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "name": "rmr",
                "tournament_ids": [later["tournament_id"]],
            },
        ),
        None,
    )
    assert joined["statusCode"] == 201
    assert _json(joined)["submissions"][0]["tournament_id"] == later["tournament_id"]

    also_live = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "tournament_id": live["tournament_id"],
            },
        ),
        None,
    )
    assert also_live["statusCode"] == 201


def test_duplicate_pending_or_enrolled_pair_is_409(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Live cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
    )
    first = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "3666918801844311", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert first["statusCode"] == 201
    pending_dup = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "3666918801844311", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert pending_dup["statusCode"] == 409
    assert _json(pending_dup)["error"] == "CONFLICT"

    approved = app.lambda_handler(
        _event(
            "POST",
            f"/admin/submissions/3666918801844311/{live['tournament_id']}/approve",
        ),
        None,
    )
    assert approved["statusCode"] == 200
    enrolled_dup = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "3666918801844311", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert enrolled_dup["statusCode"] == 409
    assert _json(enrolled_dup)["error"] == "CONFLICT"


def test_first_day_join_cutoff_is_2230_utc_on_start_date():
    row = {
        "status": "active",
        "start_at": "2026-08-17T00:00:00+00:00",
    }
    cutoff = first_day_join_cutoff(row)
    assert cutoff == datetime(2026, 8, 17, 22, 30, tzinfo=timezone.utc)
    assert is_joinable(row, now=datetime(2026, 8, 17, 22, 29, 59, tzinfo=timezone.utc)) is True
    assert is_joinable(row, now=datetime(2026, 8, 17, 22, 30, tzinfo=timezone.utc)) is False
    assert is_joinable(row, now=datetime(2026, 8, 18, 10, 0, tzinfo=timezone.utc)) is False
    scheduled = {
        "status": "scheduled",
        "start_at": "2026-08-24T00:00:00+00:00",
    }
    assert is_joinable(scheduled, now=datetime(2026, 8, 18, 23, 0, tzinfo=timezone.utc)) is True


def test_submit_rejects_active_event_at_first_day_2230(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-17T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Creators Digging Tournament",
        start="2026-08-17T00:00:00+00:00",
        end="2026-08-24T00:00:00+00:00",
    )
    later = _create_joinable(
        app,
        name="Test Tournament 3",
        start="2026-08-24T00:00:00+00:00",
        end="2026-08-31T00:00:00+00:00",
    )
    monkeypatch.setattr(
        "tournament.membership.utc_clock",
        lambda now=None: datetime(2026, 8, 17, 22, 29, tzinfo=timezone.utc),
    )
    before = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "1111111111111111",
                "name": "early",
                "tournament_id": live["tournament_id"],
            },
        ),
        None,
    )
    assert before["statusCode"] == 201

    monkeypatch.setattr(
        "tournament.membership.utc_clock",
        lambda now=None: datetime(2026, 8, 17, 22, 30, tzinfo=timezone.utc),
    )
    closed = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "2222222222222222", "name": "late", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert closed["statusCode"] == 400
    assert _json(closed)["error"] == "VALIDATION_ERROR"
    assert "22:30" in _json(closed)["message"]

    scheduled = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3333333333333333",
                "name": "soon",
                "tournament_id": later["tournament_id"],
            },
        ),
        None,
    )
    assert scheduled["statusCode"] == 201

    listed = app.lambda_handler(
        _event("GET", f"/admin/tournaments/{live['tournament_id']}/roster"),
        None,
    )
    members = _json(listed)["members"]
    assert any(row["farm_id"] == "1111111111111111" for row in members)


def test_already_enrolled_farm_stays_after_join_closes(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-17T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Creators Digging Tournament",
        start="2026-08-17T00:00:00+00:00",
        end="2026-08-24T00:00:00+00:00",
    )
    submitted = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "3666918801844311", "name": "rmr", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert submitted["statusCode"] == 201
    approved = app.lambda_handler(
        _event(
            "POST",
            f"/admin/submissions/3666918801844311/{live['tournament_id']}/approve",
        ),
        None,
    )
    assert approved["statusCode"] == 200
    monkeypatch.setattr(
        "tournament.membership.utc_clock",
        lambda now=None: datetime(2026, 8, 17, 22, 30, tzinfo=timezone.utc),
    )
    roster = _json(
        app.lambda_handler(
            _event("GET", f"/admin/tournaments/{live['tournament_id']}/roster"),
            None,
        )
    )
    assert roster["members"][0]["farm_id"] == "3666918801844311"
    assert roster["members"][0]["status"] == "enrolled"


def test_public_tournament_hides_joins_after_first_day_2230(aws_env, monkeypatch):
    freeze = datetime(2026, 8, 17, 16, 0, tzinfo=timezone.utc)
    monkeypatch.setattr("tournament.catalog._clock", lambda now=None: now or freeze)
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Creators Digging Tournament",
        start="2026-08-17T00:00:00+00:00",
        end="2026-08-24T00:00:00+00:00",
    )
    from tournament.catalog import get_public_tournament

    store = app._get_store()
    open_payload = get_public_tournament(
        store, live["tournament_id"], now=datetime(2026, 8, 17, 16, 0, tzinfo=timezone.utc)
    )
    assert open_payload["accepts_joins"] is True
    closed_payload = get_public_tournament(
        store, live["tournament_id"], now=datetime(2026, 8, 17, 22, 30, tzinfo=timezone.utc)
    )
    assert closed_payload["accepts_joins"] is False


def test_auto_join_enrolls_immediately(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Auto cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
        join_mode="auto",
    )
    joined = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "name": "rmr",
                "tournament_id": live["tournament_id"],
            },
        ),
        None,
    )
    assert joined["statusCode"] == 201, joined
    payload = _json(joined)
    assert payload["count"] == 1
    assert payload["submissions"][0]["status"] == "enrolled"
    assert payload["submissions"][0]["approved_at"]
    roster = _json(
        app.lambda_handler(
            _event("GET", f"/admin/tournaments/{live['tournament_id']}/roster"), None
        )
    )
    assert roster["members"][0]["status"] == "enrolled"
    assert roster["members"][0]["farm_id"] == "3666918801844311"


def test_must_confirm_stays_pending_until_approve(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Confirm cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
        join_mode="confirm",
    )
    joined = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "3666918801844311", "name": "rmr", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert joined["statusCode"] == 201
    assert _json(joined)["submissions"][0]["status"] == "pending"
    approved = app.lambda_handler(
        _event("POST", f"/admin/submissions/3666918801844311/{live['tournament_id']}/approve"),
        None,
    )
    assert approved["statusCode"] == 200
    roster = _json(
        app.lambda_handler(
            _event("GET", f"/admin/tournaments/{live['tournament_id']}/roster"), None
        )
    )
    assert roster["members"][0]["status"] == "enrolled"


def test_get_farm_memberships_lists_pending_and_enrolled(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    confirm = _create_joinable(
        app,
        name="Confirm cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
        join_mode="confirm",
    )
    auto = _create_joinable(
        app,
        name="Auto cup",
        start="2026-09-01T00:00:00+00:00",
        end="2026-09-08T00:00:00+00:00",
        join_mode="auto",
    )
    empty = app.lambda_handler(_event("GET", "/farms/3666918801844311/memberships"), None)
    assert empty["statusCode"] == 200
    assert _json(empty) == {"memberships": [], "count": 0}

    pending = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "name": "rmr",
                "tournament_id": confirm["tournament_id"],
            },
        ),
        None,
    )
    assert pending["statusCode"] == 201
    enrolled = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "name": "rmr",
                "tournament_id": auto["tournament_id"],
            },
        ),
        None,
    )
    assert enrolled["statusCode"] == 201

    listed = app.lambda_handler(_event("GET", "/farms/3666918801844311/memberships"), None)
    assert listed["statusCode"] == 200
    payload = _json(listed)
    assert payload["count"] == 2
    by_event = {row["tournament_id"]: row for row in payload["memberships"]}
    assert by_event[confirm["tournament_id"]]["status"] == "pending"
    assert by_event[auto["tournament_id"]]["status"] == "enrolled"
    assert all(row["farm_id"] == "3666918801844311" for row in payload["memberships"])

    other = app.lambda_handler(_event("GET", "/farms/9999999999999999/memberships"), None)
    assert other["statusCode"] == 200
    assert _json(other)["count"] == 0

    bad = app.lambda_handler(_event("GET", "/farms/not-a-farm/memberships"), None)
    assert bad["statusCode"] == 400
    assert _json(bad)["error"] == "VALIDATION_ERROR"


def test_memberships_route_is_wired_in_sam_template():
    text = (ROOT / "template.yaml").read_text()
    assert "Path: /farms/{farm_id}/memberships" in text
    assert "GetFarmMemberships:" in text


def test_event_without_new_fields_still_creates_pending(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Legacy cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
    )
    assert live["join_mode"] == "confirm"
    assert live["min_bumpkin_island"] is None
    assert live["min_digging_streak"] is None
    assert live["vip_required"] is False
    assert live["max_players"] is None
    joined = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "3666918801844311", "name": "rmr", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert joined["statusCode"] == 201
    assert _json(joined)["submissions"][0]["status"] == "pending"


def test_full_roster_rejects_next_public_join(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Cap cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
        join_mode="auto",
        max_players=1,
    )
    first = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "1111111111111111", "name": "one", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert first["statusCode"] == 201
    assert _json(first)["submissions"][0]["status"] == "enrolled"
    second = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "2222222222222222", "name": "two", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert second["statusCode"] == 400
    body = _json(second)
    assert body["error"] == "VALIDATION_ERROR"
    assert "full" in body["message"]


def test_pending_joins_do_not_occupy_max_player_slots(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Pending cap",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
        join_mode="confirm",
        max_players=1,
    )
    first = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "1111111111111111", "name": "one", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert first["statusCode"] == 201
    assert _json(first)["submissions"][0]["status"] == "pending"
    second = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {"farm_id": "2222222222222222", "name": "two", "tournament_id": live["tournament_id"]},
        ),
        None,
    )
    assert second["statusCode"] == 201
    assert _json(second)["submissions"][0]["status"] == "pending"


def _write_profile(app, farm_id, *, island="desert", vip=True, digging_streak=5):
    app._get_store().write_snapshot(
        farm_id,
        {
            "farm_id": farm_id,
            "island": island,
            "vip": vip,
            "digging_streak": digging_streak,
        },
    )


class _FakeJoinClient:
    def __init__(self, payload=None, error=None):
        self.payload = payload or {}
        self.error = error
        self.called: list[str] = []

    def fetch_farm(self, farm_id: str):
        self.called.append(farm_id)
        if self.error is not None:
            raise self.error
        return self.payload


def _community_profile(*, island="desert", vip=True, streak=4, lifetime=False):
    later = int(datetime(2026, 8, 20, tzinfo=timezone.utc).timestamp() * 1000)
    farm = {
        "island": {"type": island},
        "desert": {"digging": {"grid": [], "streak": {"count": streak}}},
        "inventory": {},
    }
    if lifetime:
        farm["inventory"] = {"Lifetime Farmer Banner": 1}
        farm["vip"] = {}
    elif vip:
        farm["vip"] = {"expiresAt": later}
    else:
        farm["vip"] = {"expiresAt": 1}
    return {"farm": farm}


def test_island_streak_vip_gates_on_public_join(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Gated cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
        min_bumpkin_island="desert",
        min_digging_streak=3,
        vip_required=True,
    )
    _write_profile(app, "1111111111111111", island="spring", vip=True, digging_streak=9)
    _write_profile(app, "2222222222222222", island="volcano", vip=False, digging_streak=9)
    _write_profile(app, "3333333333333333", island="desert", vip=True, digging_streak=1)
    _write_profile(app, "4444444444444444", island="desert", vip=True, digging_streak=4)

    def _join(farm_id, name):
        return app.lambda_handler(
            _event(
                "POST",
                "/submissions",
                {"farm_id": farm_id, "name": name, "tournament_id": live["tournament_id"]},
            ),
            None,
        )

    island_low = _join("1111111111111111", "spring")
    assert island_low["statusCode"] == 400
    assert "minimum bumpkin island" in _json(island_low)["message"]

    no_vip = _join("2222222222222222", "novip")
    assert no_vip["statusCode"] == 400
    assert "VIP" in _json(no_vip)["message"]

    streak_low = _join("3333333333333333", "short")
    assert streak_low["statusCode"] == 400
    assert "minimum digging streak" in _json(streak_low)["message"]

    ok = _join("4444444444444444", "ok")
    assert ok["statusCode"] == 201
    assert _json(ok)["submissions"][0]["status"] == "pending"


def test_join_lists_every_unmet_island_streak_and_vip_gate(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Gated cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
        min_bumpkin_island="desert",
        min_digging_streak=3,
        vip_required=True,
    )
    _write_profile(app, "5555555555555555", island="basic", vip=False, digging_streak=1)
    response = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "5555555555555555",
                "name": "low",
                "tournament_id": live["tournament_id"],
            },
        ),
        None,
    )
    assert response["statusCode"] == 400
    body = _json(response)
    assert body["error"] == "VALIDATION_ERROR"
    message = body["message"]
    assert "minimum bumpkin island desert (farm is basic)" in message
    assert "minimum digging streak 3 (farm is 1)" in message
    assert "VIP required (farm is not VIP)" in message
    gates = {item["gate"]: item for item in body["details"]}
    assert gates["min_bumpkin_island"] == {
        "gate": "min_bumpkin_island",
        "required": "desert",
        "farm": "basic",
        "readable": True,
    }
    assert gates["min_digging_streak"]["required"] == 3
    assert gates["min_digging_streak"]["farm"] == 1
    assert gates["vip_required"]["required"] is True
    assert gates["vip_required"]["farm"] is False


def test_join_gates_fail_closed_when_snapshot_unread(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Gated cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
        min_bumpkin_island="basic",
        min_digging_streak=1,
        vip_required=True,
    )
    missing = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3333333333333333",
                "name": "ghost",
                "tournament_id": live["tournament_id"],
            },
        ),
        None,
    )
    assert missing["statusCode"] == 400
    body = _json(missing)
    assert body["error"] == "VALIDATION_ERROR"
    assert "could not be read" in body["message"]
    assert "minimum bumpkin island basic (could not be read)" in body["message"]
    assert "minimum digging streak 1 (could not be read)" in body["message"]
    assert "VIP required (could not be read)" in body["message"]
    assert {item["gate"] for item in body["details"]} == {
        "min_bumpkin_island",
        "min_digging_streak",
        "vip_required",
    }
    assert all(item["readable"] is False for item in body["details"])


def test_gated_join_fetches_live_sfl_profile_when_snapshot_missing(
    aws_env, monkeypatch, live_join_open
):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Gated cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
        min_bumpkin_island="desert",
        min_digging_streak=3,
        vip_required=True,
    )
    client = _FakeJoinClient(_community_profile(island="desert", vip=True, streak=9))
    app._join_sfl_client = lambda: client
    response = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "name": "rmr",
                "tournament_id": live["tournament_id"],
            },
        ),
        None,
    )
    assert response["statusCode"] == 201, response
    assert client.called == ["3666918801844311"]
    snapshot = app._get_store().read_snapshot("3666918801844311")
    assert snapshot["vip"] is True
    assert snapshot["island"] == "desert"
    assert snapshot["digging_streak"] == 9
    assert app._get_store().get_score("3666918801844311") is None


def test_gated_join_uses_live_sfl_profile_over_stale_snapshot(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Gated cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
        min_bumpkin_island="desert",
        min_digging_streak=3,
        vip_required=True,
    )
    _write_profile(app, "3666918801844311", island="basic", vip=False, digging_streak=0)
    client = _FakeJoinClient(_community_profile(island="volcano", vip=True, streak=12))
    app._join_sfl_client = lambda: client
    response = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "name": "rmr",
                "tournament_id": live["tournament_id"],
            },
        ),
        None,
    )
    assert response["statusCode"] == 201, response
    snapshot = app._get_store().read_snapshot("3666918801844311")
    assert snapshot["vip"] is True
    assert snapshot["island"] == "volcano"
    assert snapshot["digging_streak"] == 12


def test_gated_join_accepts_lifetime_farmer_banner(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="VIP cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
        vip_required=True,
    )
    client = _FakeJoinClient(_community_profile(vip=False, lifetime=True, streak=1))
    app._join_sfl_client = lambda: client
    response = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "name": "rmr",
                "tournament_id": live["tournament_id"],
            },
        ),
        None,
    )
    assert response["statusCode"] == 201, response
    assert app._get_store().read_snapshot("3666918801844311")["vip"] is True


def test_gated_join_keeps_fail_closed_when_sfl_fetch_fails(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Gated cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
        vip_required=True,
    )
    client = _FakeJoinClient(error=SFLApiError("SFL HTTP 500", status_code=500))
    app._join_sfl_client = lambda: client
    response = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3333333333333333",
                "name": "ghost",
                "tournament_id": live["tournament_id"],
            },
        ),
        None,
    )
    assert response["statusCode"] == 400
    assert "could not be read" in _json(response)["message"]
    assert client.called == ["3333333333333333"]


def test_ungated_join_does_not_fetch_sfl(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Open cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
    )
    client = _FakeJoinClient(_community_profile())
    app._join_sfl_client = lambda: client
    response = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "name": "rmr",
                "tournament_id": live["tournament_id"],
            },
        ),
        None,
    )
    assert response["statusCode"] == 201, response
    assert client.called == []


def test_admin_force_add_ignores_public_cap_and_level(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-10T00:00:00+00:00")
    app = _load_app(aws_env, monkeypatch)
    live = _create_joinable(
        app,
        name="Gated cup",
        start="2026-08-10T00:00:00+00:00",
        end="2026-08-20T00:00:00+00:00",
        join_mode="auto",
        max_players=1,
        min_bumpkin_island="volcano+",
        min_digging_streak=99,
        vip_required=True,
    )
    added = app.lambda_handler(
        _event("POST", "/admin/farms", {"farm_id": "3666918801844311", "name": "rmr"}),
        None,
    )
    assert added["statusCode"] == 201
    extra = app.lambda_handler(
        _event("POST", "/admin/farms", {"farm_id": "2791164672544774", "name": "bob"}),
        None,
    )
    assert extra["statusCode"] == 201
    first = app.lambda_handler(
        _event(
            "POST",
            f"/admin/tournaments/{live['tournament_id']}/farms",
            {"farm_ids": ["3666918801844311"]},
        ),
        None,
    )
    assert first["statusCode"] == 200, first
    second = app.lambda_handler(
        _event(
            "POST",
            f"/admin/tournaments/{live['tournament_id']}/farms",
            {"farm_ids": ["2791164672544774"]},
        ),
        None,
    )
    assert second["statusCode"] == 200, second
    roster = _json(
        app.lambda_handler(
            _event("GET", f"/admin/tournaments/{live['tournament_id']}/roster"), None
        )
    )
    ids = {row["farm_id"] for row in roster["members"]}
    assert ids == {"3666918801844311", "2791164672544774"}
