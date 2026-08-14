"""Tracked Farm IDs — S3 JSON is the source of truth."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

TRACKED_FARMS_KEY = "config/tracked-farms.json"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def empty_registry() -> dict[str, Any]:
    return {"updated_at": utc_now_iso(), "farms": []}


def _as_bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).lower() in {"1", "true", "yes", "on"}


def normalize_farm(entry: Any) -> dict[str, Any] | None:
    if not isinstance(entry, dict):
        return None
    farm_id = str(entry.get("farm_id") or entry.get("farmId") or "").strip()
    if not farm_id:
        return None
    name = str(entry.get("name") or "").strip()
    return {
        "farm_id": farm_id,
        "name": name,
        "active": _as_bool(entry.get("active"), True),
    }


def normalize_registry(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return empty_registry()
    farms: list[dict[str, Any]] = []
    seen: set[str] = set()
    raw_farms = payload.get("farms")
    if isinstance(raw_farms, list):
        for entry in raw_farms:
            farm = normalize_farm(entry)
            if farm and farm["farm_id"] not in seen:
                seen.add(farm["farm_id"])
                farms.append(farm)
    updated_at = payload.get("updated_at") or payload.get("updatedAt") or utc_now_iso()
    return {"updated_at": str(updated_at), "farms": farms}


class FarmRegistry:
    """Read/write ``s3://bucket/config/tracked-farms.json``."""

    def __init__(self, bucket_name: str, *, s3_client=None) -> None:
        if not bucket_name:
            raise ValueError("DATA_BUCKET must be set")
        self._bucket = bucket_name
        self._s3 = s3_client or boto3.client("s3")

    def load(self) -> dict[str, Any]:
        try:
            response = self._s3.get_object(Bucket=self._bucket, Key=TRACKED_FARMS_KEY)
            payload = json.loads(response["Body"].read())
            return normalize_registry(payload)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in {"NoSuchKey", "NoSuchBucket", "404"}:
                return empty_registry()
            logger.error("Failed to read tracked farms: %s", exc, exc_info=True)
            raise
        except (ValueError, TypeError) as exc:
            logger.error("Tracked farms JSON is invalid: %s", exc)
            return empty_registry()

    def save(self, registry: dict[str, Any]) -> dict[str, Any]:
        normalized = normalize_registry(registry)
        normalized["updated_at"] = utc_now_iso()
        body = json.dumps(normalized, default=str, separators=(",", ":"))
        self._s3.put_object(
            Bucket=self._bucket,
            Key=TRACKED_FARMS_KEY,
            Body=body,
            ContentType="application/json",
        )
        return normalized

    def list_farms(self, *, active_only: bool = False) -> list[dict[str, Any]]:
        farms = self.load()["farms"]
        if active_only:
            return [farm for farm in farms if farm["active"]]
        return farms

    def upsert(self, farm_id: str, name: str = "", active: bool = True) -> dict[str, Any]:
        farm_id = str(farm_id).strip()
        if not farm_id:
            raise ValueError("farm_id is required")
        registry = self.load()
        found = False
        for farm in registry["farms"]:
            if farm["farm_id"] == farm_id:
                farm["name"] = name.strip()
                farm["active"] = active
                found = True
                break
        if not found:
            registry["farms"].append(
                {"farm_id": farm_id, "name": name.strip(), "active": active}
            )
        return self.save(registry)

    def remove(self, farm_id: str) -> dict[str, Any]:
        farm_id = str(farm_id).strip()
        registry = self.load()
        before = len(registry["farms"])
        registry["farms"] = [farm for farm in registry["farms"] if farm["farm_id"] != farm_id]
        if len(registry["farms"]) == before:
            raise KeyError(farm_id)
        return self.save(registry)

    def get(self, farm_id: str) -> dict[str, Any] | None:
        farm_id = str(farm_id).strip()
        for farm in self.list_farms():
            if farm["farm_id"] == farm_id:
                return farm
        return None
