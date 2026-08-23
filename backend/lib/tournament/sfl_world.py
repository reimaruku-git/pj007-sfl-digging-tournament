"""sfl.world land-info lookup.

The browser never calls sfl.world. This client is the name source for
public farm-ID identify.
"""

from __future__ import annotations

import logging
from typing import Any

import requests

logger = logging.getLogger(__name__)

SFL_WORLD_BASE = "https://sfl.world"
LAND_INFO_PATH = "/api/v1/land/info/farm_id/{farm_id}"
LAND_SUMMARY_PATH = "/api/v1.1/land/{nft_id}"
DEFAULT_TIMEOUT = 15


class SflWorldError(Exception):
    """Raised when sfl.world cannot produce a farm name."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 502,
        code: str = "LOOKUP_FAILED",
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


def land_info_url(farm_id: str, *, base_url: str = SFL_WORLD_BASE) -> str:
    return f"{base_url.rstrip('/')}{LAND_INFO_PATH.format(farm_id=farm_id)}"


def land_summary_url(nft_id: Any, *, base_url: str = SFL_WORLD_BASE) -> str:
    return f"{base_url.rstrip('/')}{LAND_SUMMARY_PATH.format(nft_id=nft_id)}"


def lookup_farm_name(
    farm_id: str,
    *,
    session: requests.Session | None = None,
    timeout: int = DEFAULT_TIMEOUT,
    base_url: str = SFL_WORLD_BASE,
) -> dict[str, Any]:
    """GET sfl.world land-info by farm_id. Fails if username is missing."""
    farm_id = str(farm_id or "").strip()
    if not farm_id:
        raise SflWorldError("farm_id is required", status_code=400, code="VALIDATION_ERROR")

    url = land_info_url(farm_id, base_url=base_url)
    client = session or requests
    try:
        logger.info("GET %s", url)
        response = client.get(url, headers={"Accept": "application/json"}, timeout=timeout)
    except (requests.ConnectionError, requests.Timeout) as exc:
        raise SflWorldError(f"sfl.world request failed: {exc}") from exc

    if response.status_code == 404:
        raise SflWorldError("farm not found on sfl.world", status_code=404, code="NOT_FOUND")
    if response.status_code != 200:
        raise SflWorldError(
            f"sfl.world HTTP {response.status_code}",
            status_code=502,
            code="LOOKUP_FAILED",
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise SflWorldError("sfl.world returned non-JSON body") from exc
    if not isinstance(payload, dict):
        raise SflWorldError("sfl.world returned an unexpected payload")

    name = str(payload.get("username") or payload.get("name") or "").strip()
    if not name:
        raise SflWorldError(
            "farm name is not available yet",
            status_code=404,
            code="NOT_FOUND",
        )

    nft_id = payload.get("nft_id")
    return {
        "farm_id": farm_id,
        "name": name,
        "nft_id": nft_id,
    }


def lookup_bumpkin_level(
    nft_id: Any,
    *,
    session: requests.Session | None = None,
    timeout: int = DEFAULT_TIMEOUT,
    base_url: str = SFL_WORLD_BASE,
) -> int:
    """GET sfl.world land summary by nft_id. Fails if bumpkin.level is missing."""
    token = str(nft_id if nft_id is not None else "").strip()
    if not token:
        raise SflWorldError("nft_id is required", status_code=400, code="VALIDATION_ERROR")

    url = land_summary_url(token, base_url=base_url)
    client = session or requests
    try:
        logger.info("GET %s", url)
        response = client.get(url, headers={"Accept": "application/json"}, timeout=timeout)
    except (requests.ConnectionError, requests.Timeout) as exc:
        raise SflWorldError(f"sfl.world request failed: {exc}") from exc

    if response.status_code == 404:
        raise SflWorldError("farm not found on sfl.world", status_code=404, code="NOT_FOUND")
    if response.status_code != 200:
        raise SflWorldError(
            f"sfl.world HTTP {response.status_code}",
            status_code=502,
            code="LOOKUP_FAILED",
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise SflWorldError("sfl.world returned non-JSON body") from exc
    if not isinstance(payload, dict):
        raise SflWorldError("sfl.world returned an unexpected payload")

    bumpkin = payload.get("bumpkin")
    if not isinstance(bumpkin, dict):
        raise SflWorldError(
            "bumpkin level is not available yet",
            status_code=404,
            code="NOT_FOUND",
        )
    raw = bumpkin.get("level")
    try:
        level = int(raw)
    except (TypeError, ValueError) as exc:
        raise SflWorldError(
            "bumpkin level is not available yet",
            status_code=404,
            code="NOT_FOUND",
        ) from exc
    if level < 1:
        raise SflWorldError(
            "bumpkin level is not available yet",
            status_code=404,
            code="NOT_FOUND",
        )
    return level
