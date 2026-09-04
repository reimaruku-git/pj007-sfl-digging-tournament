"""Centralised HTTP response factory.

All Lambda handlers must call these helpers instead of building raw dicts.
"""

import json
import os
from typing import Any

ALLOWED_ORIGIN_ENV_VAR = "ALLOWED_ORIGIN"
ALLOWED_ORIGINS_ENV_VAR = "ALLOWED_ORIGINS"
_current_request_origin = ""


def set_request_origin(origin: str | None) -> None:
    """Store the request origin for dynamic CORS header selection."""
    global _current_request_origin
    _current_request_origin = (origin or "").strip()


def _allowed_origins() -> list[str]:
    allowed_origins_raw = os.environ.get(ALLOWED_ORIGINS_ENV_VAR, "")
    origins = [item.strip() for item in allowed_origins_raw.split(",") if item.strip()]
    single = os.environ.get(ALLOWED_ORIGIN_ENV_VAR, "").strip()
    if single and single != "*" and single not in origins:
        origins.append(single)
    return origins


def _resolve_allowed_origin() -> str | None:
    """Echo the request origin when it is on the allowlist. Never '*'."""
    if not _current_request_origin:
        return None
    if _current_request_origin in _allowed_origins():
        return _current_request_origin
    return None


def create_response(
    status_code: int, body: Any, extra_headers: dict[str, str] | None = None
) -> dict[str, Any]:
    """Build a standard API Gateway proxy response."""
    allowed_origin = _resolve_allowed_origin()
    headers = dict(extra_headers) if extra_headers else {}
    headers.update(
        {
            "Content-Type": "application/json",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        }
    )
    if allowed_origin:
        headers["Access-Control-Allow-Origin"] = allowed_origin
    return {
        "statusCode": status_code,
        "headers": headers,
        "body": json.dumps(body, default=str),
    }


def create_binary_response(
    status_code: int,
    body: bytes,
    content_type: str,
    *,
    extra_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build a binary API Gateway proxy response."""
    import base64

    allowed_origin = _resolve_allowed_origin()
    headers = dict(extra_headers) if extra_headers else {}
    headers.update(
        {
            "Content-Type": content_type,
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
            "Cache-Control": "public, max-age=300",
        }
    )
    if allowed_origin:
        headers["Access-Control-Allow-Origin"] = allowed_origin
    return {
        "statusCode": status_code,
        "headers": headers,
        "body": base64.b64encode(body).decode("ascii"),
        "isBase64Encoded": True,
    }


def create_error_response(
    status_code: int,
    message: str,
    code: str = "ERROR",
    details: Any | None = None,
) -> dict[str, Any]:
    """Build a standard error response: {error, message} and optional details."""
    body: dict[str, Any] = {"error": code, "message": message}
    if details is not None:
        body["details"] = details
    return create_response(status_code, body)
