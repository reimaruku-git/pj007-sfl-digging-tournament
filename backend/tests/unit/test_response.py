from common.response import create_response, set_request_origin


def test_cors_echoes_allowlisted_origin(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGIN", "https://bumpkinclash.com")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    set_request_origin("https://bumpkinclash.com")
    try:
        response = create_response(200, {"ok": True})
        assert response["headers"]["Access-Control-Allow-Origin"] == "https://bumpkinclash.com"
    finally:
        set_request_origin(None)


def test_cors_omits_header_for_unknown_origin(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGIN", "https://bumpkinclash.com")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    set_request_origin("https://evil.example")
    try:
        response = create_response(200, {"ok": True})
        assert "Access-Control-Allow-Origin" not in response["headers"]
    finally:
        set_request_origin(None)


def test_cors_never_defaults_to_star(monkeypatch):
    monkeypatch.delenv("ALLOWED_ORIGIN", raising=False)
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    set_request_origin("https://bumpkinclash.com")
    try:
        response = create_response(200, {"ok": True})
        assert "Access-Control-Allow-Origin" not in response["headers"]
    finally:
        set_request_origin(None)
