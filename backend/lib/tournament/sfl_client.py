"""Sunflower Land Community API client.

The SFL API key never leaves the backend. Callers must wait at least
10–15 seconds between any requests to ``/community/farms/{id}``.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

SFL_API_BASE = "https://api.sunflower-land.com"
COMMUNITY_FARM_PATH = "/community/farms/{farm_id}"
DEFAULT_MIN_INTERVAL_SECONDS = 12.0


class SFLApiError(Exception):
    """Raised when the Community API cannot be fetched."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class RateLimitedSFLClient:
    """Fetch one farm at a time with a hard minimum interval and backoff."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = SFL_API_BASE,
        timeout: int = 30,
        min_interval_seconds: float = DEFAULT_MIN_INTERVAL_SECONDS,
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
        self._min_interval = min_interval_seconds
        self._max_retries = max_retries
        self._retry_delay = retry_delay
        self._session = session or requests.Session()
        self._sleep = sleeper
        self._monotonic = monotonic
        self._last_call_at: float | None = None

    def _wait_for_slot(self) -> None:
        if self._last_call_at is None:
            return
        elapsed = self._monotonic() - self._last_call_at
        remaining = self._min_interval - elapsed
        if remaining > 0:
            logger.info("SFL rate limit: sleeping %.1fs", remaining)
            self._sleep(remaining)

    def fetch_farm(self, farm_id: str) -> dict[str, Any]:
        """GET ``/community/farms/{farm_id}`` with retries on 429/403/5xx."""
        if not self._api_key:
            raise SFLApiError("SFL API key is not configured", status_code=500)

        url = f"{self._base_url}{COMMUNITY_FARM_PATH.format(farm_id=farm_id)}"
        last_error: Exception | None = None

        for attempt in range(self._max_retries):
            self._wait_for_slot()
            try:
                logger.info(
                    "GET %s (attempt %d/%d)", url, attempt + 1, self._max_retries
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
                logger.warning("SFL request failed for farm %s: %s", farm_id, exc)
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
                delay = max(delay, self._min_interval)
                logger.warning(
                    "SFL %s for farm %s, retry in %.1fs", status, farm_id, delay
                )
                last_error = SFLApiError(
                    f"SFL HTTP {status}", status_code=status
                )
                if attempt < self._max_retries - 1:
                    self._sleep(delay)
                    continue
                raise last_error

            raise SFLApiError(f"SFL HTTP {status}", status_code=status)

        raise SFLApiError(f"SFL request exhausted retries: {last_error}")
