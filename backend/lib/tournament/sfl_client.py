"""Sunflower Land Community API client.

Keys are a JSON list in a private S3 bucket (not Lambda env). The Community
API throttles **per IP** (~1 request / 5s, 10s if you hammer), so extra keys
from the same Lambda do not go faster — only the first loaded key is used.

Sweeps POST ``/community/getFarms`` (legacy, up to 100 ids). If that route
is gone (404/405/410/501) or an id still cannot be resolved, fall back to
``GET /community/farms/{id}``. Success waits 5.5s; 429/403/5xx wait ≥10s.
Logs only ``sfl.`` plus the token's first 4 and last 4 characters.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Sequence
from typing import Any

import boto3
import requests
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

SFL_API_BASE = "https://api.sunflower-land.com"
COMMUNITY_FARM_PATH = "/community/farms/{farm_id}"
COMMUNITY_GET_FARMS_PATH = "/community/getFarms"
MAX_GET_FARMS_IDS = 100
DEFAULT_BATCH_SIZE = 25
DEFAULT_FAILURE_INTERVAL_SECONDS = 10.0
DEFAULT_SUCCESS_INTERVAL_SECONDS = 5.5
DEFAULT_KEYS_OBJECT = "sfl-api-keys.json"
BATCH_UNAVAILABLE_STATUSES = {404, 405, 410, 501}
# HTTP join/identify must finish under API Gateway's ~30s cap.
HTTP_SFL_TIMEOUT_SECONDS = 8
HTTP_SFL_MAX_RETRIES = 1
IDENTIFY_TIMEOUT_SECONDS = HTTP_SFL_TIMEOUT_SECONDS
IDENTIFY_MAX_RETRIES = HTTP_SFL_MAX_RETRIES


class SFLApiError(Exception):
    """Raised when the Community API cannot be fetched."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class _BatchUnavailable(SFLApiError):
    """POST /community/getFarms is gone; use GET for the rest of this client."""


def key_fingerprint(api_key: str) -> str:
    """``sfl.xxxx...xxxx`` from the token after the ``sfl.`` prefix."""
    raw = (api_key or "").strip()
    token = raw[4:] if raw.lower().startswith("sfl.") else raw
    if len(token) < 8:
        return "sfl.****"
    return f"sfl.{token[:4]}...{token[-4:]}"


def community_numeric_id(farm_id: str) -> int | None:
    """Account/NFT id as a JSON number, or None if the token is not a positive int."""
    token = str(farm_id or "").strip()
    if not token.isdigit():
        return None
    value = int(token)
    return value if value >= 1 else None


def envelope_community_farm(farm_id: str, raw: Any) -> dict[str, Any]:
    """Normalize GET-shaped ``{id, farm}`` and legacy object-keyed farm blobs."""
    token = str(farm_id or "").strip()
    if not isinstance(raw, dict):
        raise SFLApiError("SFL returned an unexpected payload", status_code=502)
    parsed = community_numeric_id(token)
    if isinstance(raw.get("farm"), dict):
        payload = dict(raw)
        if payload.get("id") is None and parsed is not None:
            payload["id"] = parsed
        return payload
    nft = raw.get("nft_id")
    if nft is None:
        nft = raw.get("nftId")
    return {
        "id": raw.get("id", parsed),
        "nft_id": nft,
        "nftId": nft,
        "farm": raw,
        "isBlacklisted": raw.get("isBlacklisted", False),
        "updatedAt": raw.get("updatedAt"),
    }


def parse_sfl_keys_payload(payload: Any) -> list[str]:
    """Accept ``[\"sfl.…\"]`` or ``{\"keys\": […]}``."""
    if isinstance(payload, list):
        raw = payload
    elif isinstance(payload, dict):
        raw = payload.get("keys")
        if raw is None:
            raw = []
        if isinstance(raw, str):
            raw = [raw]
        if not isinstance(raw, list):
            raise SFLApiError("SFL keys JSON keys field must be a list", status_code=500)
    else:
        raise SFLApiError("SFL keys JSON must be a list or {keys: [...]}", status_code=500)
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in raw:
        key = str(item or "").strip()
        if key and key not in seen:
            cleaned.append(key)
            seen.add(key)
    return cleaned


def load_sfl_keys(
    bucket: str,
    object_key: str = DEFAULT_KEYS_OBJECT,
    *,
    s3_client=None,
) -> list[str]:
    """Read the keys object. Missing object → empty list (empty sweeps still run)."""
    wanted_bucket = (bucket or "").strip()
    wanted_key = (object_key or "").strip() or DEFAULT_KEYS_OBJECT
    if not wanted_bucket:
        return []
    client = s3_client or boto3.client("s3")
    try:
        body = client.get_object(Bucket=wanted_bucket, Key=wanted_key)["Body"].read()
    except ClientError as exc:
        code = str((exc.response or {}).get("Error", {}).get("Code") or "")
        if code in {"NoSuchKey", "NoSuchBucket", "404"}:
            logger.warning("SFL keys object s3://%s/%s is missing", wanted_bucket, wanted_key)
            return []
        raise SFLApiError(
            f"SFL keys object could not be read: {code or exc}", status_code=500
        ) from exc
    try:
        payload = json.loads(body)
    except ValueError as exc:
        raise SFLApiError("SFL keys object is not valid JSON", status_code=500) from exc
    return parse_sfl_keys_payload(payload)


def _clean_keys(keys: Sequence[str] | None) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in keys or ():
        key = (raw or "").strip()
        if key and key not in seen:
            cleaned.append(key)
            seen.add(key)
    return cleaned


class RateLimitedSFLClient:
    """One key, per-IP spacing. POST getFarms for a set of ids; GET as backup."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = SFL_API_BASE,
        timeout: int = 30,
        min_interval_seconds: float = DEFAULT_FAILURE_INTERVAL_SECONDS,
        success_interval_seconds: float = DEFAULT_SUCCESS_INTERVAL_SECONDS,
        batch_size: int = DEFAULT_BATCH_SIZE,
        max_retries: int = 4,
        retry_delay: float = 2.0,
        session: requests.Session | None = None,
        sleeper=time.sleep,
        monotonic=time.monotonic,
    ) -> None:
        if min_interval_seconds < 10:
            raise ValueError("min_interval_seconds must be at least 10")
        if success_interval_seconds < 5:
            raise ValueError("success_interval_seconds must be at least 5")
        size = int(batch_size)
        if size < 1 or size > MAX_GET_FARMS_IDS:
            raise ValueError("batch_size must be between 1 and 100")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._failure_interval = min_interval_seconds
        self._success_interval = max(5.0, float(success_interval_seconds))
        self._batch_size = size
        self._max_retries = max_retries
        self._retry_delay = retry_delay
        self._session = session or requests.Session()
        self._sleep = sleeper
        self._monotonic = monotonic
        self._last_call_at: float | None = None
        self._batch_disabled = False

    def seconds_until_ready(self) -> float:
        if self._last_call_at is None:
            return 0.0
        elapsed = self._monotonic() - self._last_call_at
        return max(0.0, self._success_interval - elapsed)

    def _wait_for_slot(self) -> None:
        remaining = self.seconds_until_ready()
        if remaining > 0:
            logger.info("SFL rate limit: sleeping %.1fs", remaining)
            self._sleep(remaining)

    def _headers(self) -> dict[str, str]:
        return {
            "X-Api-Key": self._api_key,
            "Accept": "application/json",
        }

    def _request(self, method: str, url: str, *, json_body: Any | None = None, label: str):
        if not self._api_key:
            raise SFLApiError("SFL API key is not configured", status_code=500)
        last_error: Exception | None = None
        stamp = key_fingerprint(self._api_key)
        for attempt in range(self._max_retries):
            self._wait_for_slot()
            try:
                logger.info(
                    "SFL %s %s %s (attempt %d/%d)",
                    stamp,
                    method,
                    label,
                    attempt + 1,
                    self._max_retries,
                )
                if method == "POST":
                    response = self._session.post(
                        url,
                        headers={**self._headers(), "Content-Type": "application/json"},
                        json=json_body,
                        timeout=self._timeout,
                    )
                else:
                    response = self._session.get(
                        url,
                        headers=self._headers(),
                        timeout=self._timeout,
                    )
                self._last_call_at = self._monotonic()
            except (requests.ConnectionError, requests.Timeout) as exc:
                last_error = exc
                logger.warning("SFL %s request failed for %s: %s", stamp, label, exc)
                if attempt < self._max_retries - 1:
                    self._sleep(self._retry_delay * (2**attempt))
                    continue
                raise SFLApiError(f"SFL request failed: {exc}") from exc

            status = response.status_code
            if status == 200:
                try:
                    payload = response.json()
                except ValueError as exc:
                    raise SFLApiError("SFL returned non-JSON body", status_code=502) from exc
                if not isinstance(payload, dict):
                    raise SFLApiError("SFL returned an unexpected payload", status_code=502)
                return payload

            if status in (429, 403) or status >= 500:
                retry_after = response.headers.get("Retry-After")
                try:
                    delay = float(retry_after) if retry_after else self._retry_delay * (2**attempt)
                except ValueError:
                    delay = self._retry_delay * (2**attempt)
                delay = max(delay, self._failure_interval)
                logger.warning(
                    "SFL %s HTTP %s for %s, retry in %.1fs",
                    stamp,
                    status,
                    label,
                    delay,
                )
                last_error = SFLApiError(f"SFL HTTP {status}", status_code=status)
                if attempt < self._max_retries - 1:
                    self._sleep(delay)
                    continue
                raise last_error

            raise SFLApiError(f"SFL HTTP {status}", status_code=status)

        raise SFLApiError(f"SFL request exhausted retries: {last_error}")

    def fetch_farm(self, farm_id: str) -> dict[str, Any]:
        """GET ``/community/farms/{farm_id}`` with retries on 429/403/5xx."""
        token = str(farm_id or "").strip()
        if not token:
            raise SFLApiError("farm_id is required", status_code=400)
        url = f"{self._base_url}{COMMUNITY_FARM_PATH.format(farm_id=token)}"
        payload = self._request("GET", url, label=f"farm {token}")
        return envelope_community_farm(token, payload)

    def fetch_farms(self, farm_ids: Sequence[str]) -> dict[str, dict[str, Any]]:
        """Map farm_id → payload. Missing farms are omitted.

        Prefers legacy POST ``/community/getFarms``. Falls back to GET when
        that route is unavailable or an id is not a positive integer.
        """
        wanted: list[str] = []
        seen: set[str] = set()
        for raw in farm_ids:
            token = str(raw or "").strip()
            if token and token not in seen:
                wanted.append(token)
                seen.add(token)
        if not wanted:
            return {}
        numeric: list[str] = []
        others: list[str] = []
        for token in wanted:
            if community_numeric_id(token) is None:
                others.append(token)
            else:
                numeric.append(token)
        result: dict[str, dict[str, Any]] = {}
        if numeric and not self._batch_disabled:
            try:
                result.update(self._fetch_farms_batched(numeric))
            except _BatchUnavailable:
                self._batch_disabled = True
                logger.warning(
                    "SFL POST /community/getFarms unavailable; using GET for remaining farms"
                )
                others = numeric + others
                numeric = []
        elif numeric:
            others = numeric + others
        result.update(self._fetch_farms_one_by_one(others))
        return result

    def _fetch_farms_one_by_one(self, farm_ids: Sequence[str]) -> dict[str, dict[str, Any]]:
        found: dict[str, dict[str, Any]] = {}
        for farm_id in farm_ids:
            try:
                found[farm_id] = self.fetch_farm(farm_id)
            except SFLApiError as exc:
                if exc.status_code == 404:
                    logger.info("SFL farm %s not found", farm_id)
                    continue
                raise
        return found

    def _fetch_farms_batched(self, farm_ids: Sequence[str]) -> dict[str, dict[str, Any]]:
        pending = list(farm_ids)
        found: dict[str, dict[str, Any]] = {}
        chunk_size = self._batch_size
        while pending:
            chunk, pending = pending[:chunk_size], pending[chunk_size:]
            found.update(self._resolve_get_farms(chunk))
        return found

    def _resolve_get_farms(self, farm_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not farm_ids:
            return {}
        got, skipped = self._post_get_farms(farm_ids)
        if not skipped:
            return got
        if len(farm_ids) == 1:
            fid = farm_ids[0]
            logger.info("SFL getFarms still skipped %s; GET fallback", fid)
            got.update(self._fetch_farms_one_by_one([fid]))
            return got
        mid = max(1, len(skipped) // 2)
        got.update(self._resolve_get_farms(skipped[:mid]))
        got.update(self._resolve_get_farms(skipped[mid:]))
        return got

    def _post_get_farms(self, farm_ids: list[str]) -> tuple[dict[str, dict[str, Any]], list[str]]:
        numbers: list[int] = []
        for token in farm_ids:
            parsed = community_numeric_id(token)
            if parsed is None:
                raise SFLApiError(f"SFL getFarms id is not numeric: {token}", status_code=500)
            numbers.append(parsed)
        if not numbers or len(numbers) > MAX_GET_FARMS_IDS:
            raise SFLApiError("SFL getFarms ids must be 1–100 numbers", status_code=500)
        url = f"{self._base_url}{COMMUNITY_GET_FARMS_PATH}"
        label = f"getFarms x{len(numbers)}"
        try:
            payload = self._request("POST", url, json_body={"ids": numbers}, label=label)
        except SFLApiError as exc:
            if exc.status_code in BATCH_UNAVAILABLE_STATUSES:
                raise _BatchUnavailable(str(exc), status_code=exc.status_code) from exc
            raise
        warning = payload.get("warning")
        if warning:
            logger.info("SFL getFarms warning: %s", warning)
        farms_obj = payload.get("farms")
        if not isinstance(farms_obj, dict):
            raise SFLApiError("SFL getFarms returned an unexpected payload", status_code=502)
        wanted = {token: token for token in farm_ids}
        got: dict[str, dict[str, Any]] = {}
        for key, raw in farms_obj.items():
            token = str(key).strip()
            match = wanted.get(token)
            if match is None:
                parsed = community_numeric_id(token)
                if parsed is not None:
                    match = wanted.get(str(parsed))
            if match is None:
                continue
            got[match] = envelope_community_farm(match, raw)
        skipped_raw = payload.get("skipped")
        skipped: list[str] = []
        seen_skip: set[str] = set()
        if isinstance(skipped_raw, list):
            for item in skipped_raw:
                token = str(item).strip()
                match = wanted.get(token)
                if match is None:
                    parsed = community_numeric_id(token)
                    if parsed is not None:
                        match = wanted.get(str(parsed))
                if match and match not in got and match not in seen_skip:
                    skipped.append(match)
                    seen_skip.add(match)
        for token in farm_ids:
            if token not in got and token not in seen_skip:
                skipped.append(token)
                seen_skip.add(token)
        return got, skipped


def build_sfl_client(
    keys: Sequence[str] | None = None,
    *,
    min_interval_seconds: float = DEFAULT_FAILURE_INTERVAL_SECONDS,
    success_interval_seconds: float = DEFAULT_SUCCESS_INTERVAL_SECONDS,
    **kwargs,
) -> RateLimitedSFLClient:
    """One client on the first loaded key. Extra keys are ignored (per-IP throttle)."""
    cleaned = _clean_keys(keys)
    if len(cleaned) > 1:
        logger.info(
            "SFL using first of %s keys; extras ignored (per-IP throttle)",
            len(cleaned),
        )
    key = cleaned[0] if cleaned else ""
    kwargs.setdefault("success_interval_seconds", success_interval_seconds)
    return RateLimitedSFLClient(key, min_interval_seconds=min_interval_seconds, **kwargs)


def build_identify_sfl_client(
    keys: Sequence[str] | None = None,
    **kwargs,
) -> RateLimitedSFLClient | None:
    """One timed Community GET for public identify. None if no keys."""
    cleaned = _clean_keys(keys)
    if not cleaned:
        return None
    inner = dict(kwargs)
    inner.setdefault("timeout", IDENTIFY_TIMEOUT_SECONDS)
    inner.setdefault("max_retries", IDENTIFY_MAX_RETRIES)
    inner.setdefault("min_interval_seconds", DEFAULT_FAILURE_INTERVAL_SECONDS)
    return RateLimitedSFLClient(cleaned[0], **inner)


def identity_from_community_payload(payload: Any, farm_id: str) -> dict[str, Any] | None:
    """Name and optional nft_id from a Community farm payload. None if no farm.

    ``farm.username`` is optional; a farm that exists without a name still
    identifies using ``farm_id`` so the visitor can connect.
    """
    if not isinstance(payload, dict):
        return None
    farm = payload.get("farm")
    if not isinstance(farm, dict):
        return None
    token = str(farm_id or "").strip()
    if not token:
        return None
    name = str(farm.get("username") or payload.get("username") or farm.get("name") or "").strip()
    if not name:
        name = token
    nft_id = payload.get("nft_id")
    if nft_id is None:
        nft_id = payload.get("nftId")
    if nft_id is None:
        nft_id = farm.get("nft_id")
    if nft_id is None:
        nft_id = farm.get("nftId")
    return {"farm_id": token, "name": name, "nft_id": nft_id}
