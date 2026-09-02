"""Profile picture presets, uploads, and public overlay."""

import base64
import importlib
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
import responses

from tournament.avatars import (
    PRESET_IDS,
    apply_avatar_update,
    attach_avatars,
    avatar_key_from_path,
    avatar_object_key,
    public_avatar,
    public_profile,
)
from tournament.images import MediaError

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


def _event(method: str, path: str, body=None, path_parameters=None):
    return {
        "rawPath": path,
        "requestContext": {
            "http": {"method": method},
            "stage": "dev",
            "domainName": "oacun88q99.execute-api.ap-southeast-1.amazonaws.com",
        },
        "headers": {"origin": "http://localhost:5173"},
        "body": json.dumps(body) if body is not None else None,
        "pathParameters": path_parameters or {},
    }


def _json(response):
    return json.loads(response["body"])


def _stub_sfl_world(farm_id="3666918801844311", username="rmr", nft_id=220411):
    responses.add(
        responses.GET,
        f"https://sfl.world/api/v1/land/info/farm_id/{farm_id}",
        json={"username": username, "farm_id": int(farm_id), "nft_id": nft_id},
        status=200,
    )


def test_avatar_object_key_and_path():
    assert avatar_object_key("7916", "webp") == "media/avatars/7916/avatar.webp"
    assert avatar_object_key("3666918801844311", "webp") == (
        "media/avatars/3666918801844311/avatar.webp"
    )
    assert (
        avatar_key_from_path("7916", "avatar.jpg")
        == "media/avatars/7916/avatar.jpg"
    )
    with pytest.raises(MediaError):
        avatar_object_key("../x", "png")
    with pytest.raises(MediaError):
        avatar_key_from_path("3666918801844311", "other.png")


def test_public_avatar_omits_unknown_or_empty():
    assert public_avatar(None) == {}
    assert public_avatar({"avatar_kind": "preset", "avatar_preset": "missing"}) == {}
    assert public_avatar({"avatar_kind": "preset", "avatar_preset": "betty"}) == {
        "avatar_kind": "preset",
        "avatar_preset": "betty",
    }
    assert public_avatar(
        {"avatar_kind": "upload", "avatar_url": "https://api.example/media/avatars/1/avatar.jpg"}
    ) == {
        "avatar_kind": "upload",
        "avatar_url": "https://api.example/media/avatars/1/avatar.jpg",
    }


def test_betty_is_a_known_preset():
    assert "betty" in PRESET_IDS
    assert "jafar" in PRESET_IDS
    assert "hoot" not in PRESET_IDS


@responses.activate
def test_put_preset_requires_identify(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    missing = app.lambda_handler(
        _event("PUT", "/farms/3666918801844311/avatar", {"kind": "preset", "preset_id": "betty"}),
        None,
    )
    assert missing["statusCode"] == 404
    profile = app.lambda_handler(_event("GET", "/farms/3666918801844311/profile"), None)
    assert profile["statusCode"] == 404


@responses.activate
def test_preset_avatar_round_trip_and_survives_reidentify(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    _stub_sfl_world()
    identified = app.lambda_handler(
        _event("POST", "/identify", {"farm_id": "3666918801844311"}),
        None,
    )
    assert identified["statusCode"] == 200
    assert "avatar_kind" not in _json(identified)

    updated = app.lambda_handler(
        _event(
            "PUT",
            "/farms/3666918801844311/avatar",
            {"kind": "preset", "preset_id": "victoria"},
        ),
        None,
    )
    assert updated["statusCode"] == 200, updated
    body = _json(updated)
    assert body["avatar_kind"] == "preset"
    assert body["avatar_preset"] == "victoria"
    assert "avatar_url" not in body

    profile = _json(app.lambda_handler(_event("GET", "/farms/3666918801844311/profile"), None))
    assert profile["avatar_preset"] == "victoria"

    listed = _json(app.lambda_handler(_event("GET", "/admin/identities"), None))
    assert listed["identities"][0]["avatar_preset"] == "victoria"

    again = app.lambda_handler(
        _event("POST", "/identify", {"farm_id": "3666918801844311"}),
        None,
    )
    assert _json(again)["avatar_preset"] == "victoria"

    cleared = app.lambda_handler(
        _event("PUT", "/farms/3666918801844311/avatar", {"kind": "none"}),
        None,
    )
    assert "avatar_kind" not in _json(cleared)


@responses.activate
def test_unknown_preset_is_rejected(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    _stub_sfl_world()
    app.lambda_handler(_event("POST", "/identify", {"farm_id": "3666918801844311"}), None)
    bad = app.lambda_handler(
        _event("PUT", "/farms/3666918801844311/avatar", {"kind": "preset", "preset_id": "hoot"}),
        None,
    )
    assert bad["statusCode"] == 400
    assert _json(bad)["error"] == "VALIDATION_ERROR"


@responses.activate
def test_upload_avatar_stores_s3_and_serves_bytes(aws_env, monkeypatch):
    app = _load_app(aws_env, monkeypatch)
    _stub_sfl_world()
    app.lambda_handler(_event("POST", "/identify", {"farm_id": "3666918801844311"}), None)
    png = base64.b64encode(b"\x89PNG-bytes").decode("ascii")
    uploaded = app.lambda_handler(
        _event(
            "PUT",
            "/farms/3666918801844311/avatar",
            {"kind": "upload", "content_type": "image/png", "data": png},
        ),
        None,
    )
    assert uploaded["statusCode"] == 200, uploaded
    body = _json(uploaded)
    assert body["avatar_kind"] == "upload"
    assert "/media/avatars/3666918801844311/avatar.png?v=" in body["avatar_url"]

    media = app.lambda_handler(
        _event("GET", "/media/avatars/3666918801844311/avatar.png"),
        None,
    )
    assert media["statusCode"] == 200
    assert media["headers"]["Content-Type"] == "image/png"
    assert media["isBase64Encoded"] is True
    assert base64.b64decode(media["body"]) == b"\x89PNG-bytes"


def test_attach_avatars_overlays_identity_on_entries(aws_env):
    from tournament.store import Store

    store = Store(
        config_table=aws_env["config_table"],
        scores_table=aws_env["scores_table"],
        submissions_table=aws_env["submissions_table"],
        data_bucket=aws_env["bucket"],
    )
    store.put_identity("111111111111", "Ada")
    store.put_identity_avatar("111111111111", kind="preset", preset="betty")
    rows = attach_avatars(
        store,
        [{"farm_id": "111111111111", "name": "Ada"}, {"farm_id": "222222222222", "name": "Bea"}],
    )
    assert rows[0]["avatar_kind"] == "preset"
    assert rows[0]["avatar_preset"] == "betty"
    assert "avatar_kind" not in rows[1]


def test_apply_avatar_update_preset_without_s3():
    store = MagicMock()
    store.get_identity.return_value = {"farm_id": "1", "name": "Ada"}
    store.put_identity_avatar.return_value = {
        "farm_id": "1",
        "name": "Ada",
        "avatar_kind": "preset",
        "avatar_preset": "jafar",
    }
    payload = apply_avatar_update(
        store,
        farm_id="1",
        body={"kind": "preset", "preset_id": "jafar"},
        api_base="https://api.example/dev",
        s3_client=MagicMock(),
    )
    assert payload == public_profile(store.put_identity_avatar.return_value)
    store.put_identity_avatar.assert_called_once_with("1", kind="preset", preset="jafar")
