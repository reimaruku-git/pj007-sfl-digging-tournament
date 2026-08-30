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


def _resolve_allowed_origin() -> str:
    """Resolve the CORS origin header value for the current request."""
    allowed_origins_raw = os.environ.get(ALLOWED_ORIGINS_ENV_VAR, "")
    allowed_origins = [item.strip() for item in allowed_origins_raw.split(",") if item.strip()]

    if _current_request_origin and _current_request_origin in allowed_origins:
        return _current_request_origin

    if allowed_origins:
        return allowed_origins[0]

    return os.environ.get(ALLOWED_ORIGIN_ENV_VAR, "*")


def create_response(
    status_code: int, body: Any, extra_headers: dict[str, str] | None = None
) -> dict[str, Any]:
    """Build a standard API Gateway proxy response."""
    allowed_origin = _resolve_allowed_origin()
    headers = dict(extra_headers) if extra_headers else {}
    headers.update(
        {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": allowed_origin,
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        }
    )
    return {
        "statusCode": status_code,
        "headers": headers,
        "body": json.dumps(body, default=str),
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
