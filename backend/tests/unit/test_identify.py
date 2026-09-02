"""Drive the shipped identify + admin identities path."""

import importlib
import json
import sys
from pathlib import Path

import boto3
import responses

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lambda_functions" / "main_function"))

SECRETS_BUCKET = "pj007-test-identify-secrets"
IDENTIFY_KEY = "sfl.aaaabbbbcccc1111"
COMMUNITY_FARM_URL = "https://api.sunflower-land.com/community/farms/{farm_id}"


def _load_app(aws_env, monkeypatch, *, with_keys=True):
    monkeypatch.setenv("DATA_BUCKET", aws_env["bucket"])
    monkeypatch.setenv("CONFIG_TABLE", aws_env["config_table"])
    monkeypatch.setenv("SCORES_TABLE", aws_env["scores_table"])
    monkeypatch.setenv("SUBMISSIONS_TABLE", aws_env["submissions_table"])
    monkeypatch.setenv("SFL_API_KEY", "test-key")
    monkeypatch.setenv("ALLOWED_ORIGIN", "*")
    monkeypatch.setenv("FARM_SYNC_FUNCTION", "")
    monkeypatch.setenv("SECRETS_BUCKET", SECRETS_BUCKET)
    monkeypatch.setenv("SFL_KEYS_OBJECT", "sfl-api-keys.json")
    s3 = boto3.client("s3", region_name="ap-southeast-1")
    s3.create_bucket(
        Bucket=SECRETS_BUCKET,
        CreateBucketConfiguration={"LocationConstraint": "ap-southeast-1"},
    )
    if with_keys:
        s3.put_object(
            Bucket=SECRETS_BUCKET,
            Key="sfl-api-keys.json",
            Body=json.dumps([IDENTIFY_KEY]).encode("utf-8"),
        )
    if "app" in sys.modules:
        del sys.modules["app"]
    module = importlib.import_module("app")
    module.DATA_BUCKET = aws_env["bucket"]
    module.CONFIG_TABLE = aws_env["config_table"]
    module.SCORES_TABLE = aws_env["scores_table"]
    module.SUBMISSIONS_TABLE = aws_env["submissions_table"]
    module.FARM_SYNC_FUNCTION = ""
    module.SECRETS_BUCKET = SECRETS_BUCKET
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


def _stub_sfl_world(farm_id="3666918801844311", username="rmr", nft_id=220411, status=200):
    responses.add(
        responses.GET,
        f"https://sfl.world/api/v1/land/info/farm_id/{farm_id}",
        json={"username": username, "farm_id": int(farm_id), "nft_id": nft_id},
        status=status,
    )


def _stub_community(farm_id="3666918801844311", username="rmr", nft_id=220411, status=200):
    body = (
        {"farm": {"username": username, "nft_id": nft_id}}
        if status == 200
        else {"error": "missing"}
    )
    responses.add(
        responses.GET,
        COMMUNITY_FARM_URL.format(farm_id=farm_id),
        json=body,
        status=status,
    )


def _community_urls():
    return [
        call.request.url
        for call in responses.calls
        if "api.sunflower-land.com" in (call.request.url or "")
    ]


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
    assert _community_urls() == []

    listed = app.lambda_handler(_event("GET", "/admin/identities"), None)
    assert listed["statusCode"] == 200
    payload = _json(listed)
    assert payload["count"] == 1
    assert payload["identities"][0]["farm_id"] == "3666918801844311"
    assert payload["identities"][0]["name"] == "rmr"


@responses.activate
def test_identify_falls_back_to_community_when_sfl_world_has_no_username(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    _stub_sfl_world(username="")
    _stub_community(username="community-rmr", nft_id=220411)
    response = app.lambda_handler(
        _event("POST", "/identify", {"farm_id": "3666918801844311"}),
        None,
    )
    assert response["statusCode"] == 200
    body = _json(response)
    assert body["farm_id"] == "3666918801844311"
    assert body["name"] == "community-rmr"
    assert body["nft_id"] == 220411
    assert _community_urls() == ["https://api.sunflower-land.com/community/farms/3666918801844311"]
    assert responses.calls[1].request.headers["X-Api-Key"] == IDENTIFY_KEY
    listed = _json(app.lambda_handler(_event("GET", "/admin/identities"), None))
    assert listed["count"] == 1
    assert listed["identities"][0]["name"] == "community-rmr"
    assert listed["identities"][0]["nft_id"] == 220411


@responses.activate
def test_identify_falls_back_to_community_on_sfl_world_404(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    _stub_sfl_world(status=404)
    _stub_community(username="from-sfl", nft_id=9)
    response = app.lambda_handler(
        _event("POST", "/identify", {"farm_id": "3666918801844311"}),
        None,
    )
    assert response["statusCode"] == 200
    body = _json(response)
    assert body["name"] == "from-sfl"
    assert body["nft_id"] == 9


@responses.activate
def test_identify_falls_back_to_community_when_sfl_world_returns_non_json(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    responses.add(
        responses.GET,
        "https://sfl.world/api/v1/land/info/farm_id/3666918801844311",
        body="not-json",
        status=200,
        content_type="text/plain",
    )
    _stub_community(username="from-community", nft_id=7)
    response = app.lambda_handler(
        _event("POST", "/identify", {"farm_id": "3666918801844311"}),
        None,
    )
    assert response["statusCode"] == 200
    assert _json(response)["name"] == "from-community"
    assert _json(response)["nft_id"] == 7


@responses.activate
def test_identify_uses_farm_id_when_community_farm_has_no_username(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    _stub_sfl_world(username="")
    _stub_community(username="", nft_id=None)
    response = app.lambda_handler(
        _event("POST", "/identify", {"farm_id": "3666918801844311"}),
        None,
    )
    assert response["statusCode"] == 200
    body = _json(response)
    assert body["name"] == "3666918801844311"
    listed = _json(app.lambda_handler(_event("GET", "/admin/identities"), None))
    assert listed["identities"][0]["name"] == "3666918801844311"


@responses.activate
def test_identify_fails_when_sfl_world_and_community_miss(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    _stub_sfl_world(username="")
    _stub_community(status=404)
    response = app.lambda_handler(
        _event("POST", "/identify", {"farm_id": "3666918801844311"}),
        None,
    )
    assert response["statusCode"] == 404
    body = _json(response)
    assert body["error"] == "NOT_FOUND"
    listed = _json(app.lambda_handler(_event("GET", "/admin/identities"), None))
    assert listed["count"] == 0


@responses.activate
def test_identify_fails_when_sfl_world_misses_and_no_community_keys(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch, with_keys=False)
    _stub_sfl_world(status=404)
    response = app.lambda_handler(
        _event("POST", "/identify", {"farm_id": "3666918801844311"}),
        None,
    )
    assert response["statusCode"] == 404
    assert _json(response)["error"] == "NOT_FOUND"
    assert _community_urls() == []
    listed = _json(app.lambda_handler(_event("GET", "/admin/identities"), None))
    assert listed["count"] == 0


@responses.activate
def test_identify_community_fallback_does_not_retry_429(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    _stub_sfl_world(status=404)
    responses.add(
        responses.GET,
        COMMUNITY_FARM_URL.format(farm_id="3666918801844311"),
        status=429,
    )
    response = app.lambda_handler(
        _event("POST", "/identify", {"farm_id": "3666918801844311"}),
        None,
    )
    assert response["statusCode"] == 404
    assert _json(response)["error"] == "NOT_FOUND"
    assert len(_community_urls()) == 1


def test_identify_rejects_non_numeric_farm_id(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    response = app.lambda_handler(_event("POST", "/identify", {"farm_id": "not-a-farm"}), None)
    assert response["statusCode"] == 400
    assert _json(response)["error"] == "VALIDATION_ERROR"


@responses.activate
def test_join_uses_identified_sfl_world_name(aws_env, monkeypatch, live_join_open):
    live_join_open("2026-08-01T00:00:00+00:00")
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
