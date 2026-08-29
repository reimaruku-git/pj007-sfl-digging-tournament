"""Sunflower Land Community API client.

Keys are a JSON list in a private S3 bucket (not Lambda env). Adding a
key is editing that object. Each successful pass through the pool waits
10 seconds before the next fetch. Failed calls (429/403/5xx) keep the
existing longer backoff. Logs only ``sfl.`` plus the token's first 4 and
last 4 characters.
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
DEFAULT_FAILURE_INTERVAL_SECONDS = 12.0
DEFAULT_SUCCESS_ROUND_SECONDS = 10.0
DEFAULT_KEYS_OBJECT = "sfl-api-keys.json"


class SFLApiError(Exception):
    """Raised when the Community API cannot be fetched."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def key_fingerprint(api_key: str) -> str:
    """``sfl.xxxx...xxxx`` from the token after the ``sfl.`` prefix."""
    raw = (api_key or "").strip()
    token = raw[4:] if raw.lower().startswith("sfl.") else raw
    if len(token) < 8:
        return "sfl.****"
    return f"sfl.{token[:4]}...{token[-4:]}"


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


class RateLimitedSFLClient:
    """Fetch one farm at a time. Failure backoff is per key; success wait is the pool."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = SFL_API_BASE,
        timeout: int = 30,
        min_interval_seconds: float = DEFAULT_FAILURE_INTERVAL_SECONDS,
        success_interval_seconds: float = 0.0,
        max_retries: int = 4,
        retry_delay: float = 2.0,
        session: requests.Session | None = None,
        sleeper=time.sleep,
        monotonic=time.monotonic,
    ) -> None:
        if min_interval_seconds < 10:
            raise ValueError("min_interval_seconds must be at least 10")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._failure_interval = min_interval_seconds
        self._success_interval = max(0.0, float(success_interval_seconds))
        self._max_retries = max_retries
        self._retry_delay = retry_delay
        self._session = session or requests.Session()
        self._sleep = sleeper
        self._monotonic = monotonic
        self._last_call_at: float | None = None

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

    def fetch_farm(self, farm_id: str) -> dict[str, Any]:
        """GET ``/community/farms/{farm_id}`` with retries on 429/403/5xx."""
        if not self._api_key:
            raise SFLApiError("SFL API key is not configured", status_code=500)

        url = f"{self._base_url}{COMMUNITY_FARM_PATH.format(farm_id=farm_id)}"
        last_error: Exception | None = None
        stamp = key_fingerprint(self._api_key)

        for attempt in range(self._max_retries):
            self._wait_for_slot()
            try:
                logger.info(
                    "SFL %s GET farm %s (attempt %d/%d)",
                    stamp,
                    farm_id,
                    attempt + 1,
                    self._max_retries,
                )
                response = self._session.get(
                    url,
                    headers={
                        "X-Api-Key": self._api_key,
                        "Accept": "application/json",
                    },
                    timeout=self._timeout,
                )
                self._last_call_at = self._monotonic()
            except (requests.ConnectionError, requests.Timeout) as exc:
                last_error = exc
                logger.warning("SFL %s request failed for farm %s: %s", stamp, farm_id, exc)
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
                    "SFL %s HTTP %s for farm %s, retry in %.1fs",
                    stamp,
                    status,
                    farm_id,
                    delay,
                )
                last_error = SFLApiError(f"SFL HTTP {status}", status_code=status)
                if attempt < self._max_retries - 1:
                    self._sleep(delay)
                    continue
                raise last_error

            raise SFLApiError(f"SFL HTTP {status}", status_code=status)

        raise SFLApiError(f"SFL request exhausted retries: {last_error}")


class PooledSFLClient:
    """Use each key once per round, then wait before the next round."""

    def __init__(
        self,
        clients: Sequence[RateLimitedSFLClient],
        *,
        success_round_seconds: float = DEFAULT_SUCCESS_ROUND_SECONDS,
        sleeper=time.sleep,
    ) -> None:
        if not clients:
            raise ValueError("at least one SFL client is required")
        if success_round_seconds < 10:
            raise ValueError("success_round_seconds must be at least 10")
        self._clients = list(clients)
        self._next = 0
        self._successes = 0
        self._success_round_seconds = success_round_seconds
        self._sleep = sleeper

    def _pick(self) -> RateLimitedSFLClient:
        n = len(self._clients)
        best_i = 0
        best_wait: float | None = None
        for offset in range(n):
            i = (self._next + offset) % n
            wait = self._clients[i].seconds_until_ready()
            if best_wait is None or wait < best_wait:
                best_i = i
                best_wait = wait
                if wait <= 0:
                    break
        self._next = (best_i + 1) % n
        return self._clients[best_i]

    def fetch_farm(self, farm_id: str) -> dict[str, Any]:
        if self._successes >= len(self._clients):
            logger.info(
                "SFL success round complete (%s keys); waiting %.1fs",
                len(self._clients),
                self._success_round_seconds,
            )
            self._sleep(self._success_round_seconds)
            self._successes = 0
        payload = self._pick().fetch_farm(farm_id)
        self._successes += 1
        return payload


def build_sfl_client(
    keys: Sequence[str] | None = None,
    *,
    min_interval_seconds: float = DEFAULT_FAILURE_INTERVAL_SECONDS,
    success_round_seconds: float = DEFAULT_SUCCESS_ROUND_SECONDS,
    **kwargs,
) -> RateLimitedSFLClient | PooledSFLClient:
    """Build a pool for one or more keys. Empty list keeps a no-key client."""
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in keys or ():
        key = (raw or "").strip()
        if key and key not in seen:
            cleaned.append(key)
            seen.add(key)
    sleeper = kwargs.get("sleeper", time.sleep)
    if not cleaned:
        return RateLimitedSFLClient("", min_interval_seconds=min_interval_seconds, **kwargs)
    inner_kwargs = dict(kwargs)
    inner_kwargs["success_interval_seconds"] = 0.0
    clients = [
        RateLimitedSFLClient(
            key,
            min_interval_seconds=min_interval_seconds,
            **inner_kwargs,
        )
        for key in cleaned
    ]
    return PooledSFLClient(
        clients,
        success_round_seconds=success_round_seconds,
        sleeper=sleeper,
    )
