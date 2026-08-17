"""Drive the shipped identify + admin identities path."""

import importlib
import json
import sys
from pathlib import Path

import responses

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


def _stub_sfl_world(farm_id="3666918801844311", username="rmr", nft_id=220411, status=200):
    responses.add(
        responses.GET,
        f"https://sfl.world/api/v1/land/info/farm_id/{farm_id}",
        json={"username": username, "farm_id": int(farm_id), "nft_id": nft_id},
        status=status,
    )


@responses.activate
def test_identify_looks_up_sfl_world_and_stores_name(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    _stub_sfl_world()
    response = app.lambda_handler(
        _event("POST", "/identify", {"farm_id": "3666918801844311"}),
        None,
    )
    assert response["statusCode"] == 200
    body = _json(response)
    assert body["farm_id"] == "3666918801844311"
    assert body["name"] == "rmr"
    assert body["nft_id"] == 220411
    assert body["identified_at"]
    assert responses.calls[0].request.url.endswith("/land/info/farm_id/3666918801844311")

    listed = app.lambda_handler(_event("GET", "/admin/identities"), None)
    assert listed["statusCode"] == 200
    payload = _json(listed)
    assert payload["count"] == 1
    assert payload["identities"][0]["farm_id"] == "3666918801844311"
    assert payload["identities"][0]["name"] == "rmr"


@responses.activate
def test_identify_fails_when_sfl_world_has_no_username(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    _stub_sfl_world(username="")
    response = app.lambda_handler(
        _event("POST", "/identify", {"farm_id": "3666918801844311"}),
        None,
    )
    assert response["statusCode"] == 404
    body = _json(response)
    assert body["error"] == "NOT_FOUND"
    listed = _json(app.lambda_handler(_event("GET", "/admin/identities"), None))
    assert listed["count"] == 0


def test_identify_rejects_non_numeric_farm_id(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    response = app.lambda_handler(_event("POST", "/identify", {"farm_id": "not-a-farm"}), None)
    assert response["statusCode"] == 400
    assert _json(response)["error"] == "VALIDATION_ERROR"


@responses.activate
def test_join_uses_identified_sfl_world_name(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    _stub_sfl_world(username="rmr")
    identified = app.lambda_handler(
        _event("POST", "/identify", {"farm_id": "3666918801844311"}),
        None,
    )
    assert identified["statusCode"] == 200
    created = app.lambda_handler(
        _event(
            "POST",
            "/admin/tournaments",
            {
                "name": "Live cup",
                "start_at": "2026-08-01T00:00:00+00:00",
                "end_at": "2026-08-31T00:00:00+00:00",
                "prize_amount": "30",
            },
        ),
        None,
    )
    assert created["statusCode"] == 201, created
    tid = _json(created)["tournament"]["tournament_id"]
    joined = app.lambda_handler(
        _event(
            "POST",
            "/submissions",
            {
                "farm_id": "3666918801844311",
                "name": "typed-over-sfl",
                "tournament_ids": [tid],
            },
        ),
        None,
    )
    assert joined["statusCode"] == 201
    body = _json(joined)
    assert body["submissions"][0]["name"] == "rmr"
    assert body["submissions"][0]["farm_id"] == "3666918801844311"
