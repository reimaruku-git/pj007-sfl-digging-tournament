"""Drive GET /slogans and admin slogan writes through the shipped router."""

import importlib
import json
import sys
from pathlib import Path

from tournament.slogans import SEED_SLOGANS

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


def test_public_get_slogans_returns_seed_list(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    response = app.lambda_handler(_event("GET", "/slogans"), None)
    assert response["statusCode"] == 200
    payload = _json(response)
    assert payload["count"] == 6
    assert payload["slogans"] == SEED_SLOGANS
    assert [row["text"] for row in payload["slogans"]] == [
        "Slap my pets",
        "Grow my banana",
        "Squeeze my orange",
        "Clean my poop",
        "Want some weed?",
        "Erect my monument",
    ]


def test_admin_post_appends_after_seeding(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    created = app.lambda_handler(
        _event("POST", "/admin/slogans", {"text": "Feed my chicken", "icon": "hand"}),
        None,
    )
    assert created["statusCode"] == 201, created
    body = _json(created)
    assert body["slogan"] == {"text": "Feed my chicken", "icon": "hand"}
    assert body["count"] == 7
    assert body["slogans"][-1]["text"] == "Feed my chicken"
    assert body["slogans"][0]["text"] == "Slap my pets"

    listed = _json(app.lambda_handler(_event("GET", "/slogans"), None))
    assert listed["count"] == 7
    assert listed["slogans"][-1] == {"text": "Feed my chicken", "icon": "hand"}

    admin = _json(app.lambda_handler(_event("GET", "/admin/slogans"), None))
    assert admin["slogans"] == listed["slogans"]


def test_admin_put_replaces_the_list(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    replaced = app.lambda_handler(
        _event(
            "PUT",
            "/admin/slogans",
            {
                "slogans": [
                    {"text": "Slap my pets", "icon": "hand"},
                    {"text": "Grow my banana", "icon": "banana"},
                ]
            },
        ),
        None,
    )
    assert replaced["statusCode"] == 200
    payload = _json(replaced)
    assert payload["count"] == 2
    public = _json(app.lambda_handler(_event("GET", "/slogans"), None))
    assert public["slogans"] == payload["slogans"]


def test_admin_post_rejects_blank_text(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    response = app.lambda_handler(_event("POST", "/admin/slogans", {"text": "  "}), None)
    assert response["statusCode"] == 400
    payload = _json(response)
    assert payload["error"] == "VALIDATION_ERROR"
    assert "text" in payload["message"]
