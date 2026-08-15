"""DynamoDB + S3 snapshot access for config, scores, submissions, cache."""

from __future__ import annotations

import json
import logging
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from botocore.exceptions import ClientError

from tournament.farms import utc_now_iso
from tournament.scoring import STATUS_NOT_STARTED

logger = logging.getLogger(__name__)

CONFIG_PK = "CONFIG"
CACHE_PK = "LEADERBOARD"
TOURNAMENT_INDEX_PK = "TOURNAMENT_INDEX"
TOURNAMENT_PK_PREFIX = "TOURNAMENT#"
DEFAULT_PRIZE = "30"
MIN_TOURNAMENT_DAYS = 1
NAME_MAX_LEN = 80


class Store:
    def __init__(
        self,
        *,
        config_table: str,
        scores_table: str,
        submissions_table: str,
        data_bucket: str,
        dynamodb_resource=None,
        s3_client=None,
    ) -> None:
        resource = dynamodb_resource or boto3.resource("dynamodb")
        self.config_table = resource.Table(config_table)
        self.scores_table = resource.Table(scores_table)
        self.submissions_table = resource.Table(submissions_table)
        self._bucket = data_bucket
        self._s3 = s3_client or boto3.client("s3")

    # ------------------------------------------------------------------
    # Config
    # ------------------------------------------------------------------

    def default_config(self) -> dict[str, Any]:
        now = utc_now_iso()
        return {
            "pk": CONFIG_PK,
            "start_at": "",
            "end_at": "",
            "duration_days": 0,
            "prize_amount": DEFAULT_PRIZE,
            "name": "",
            "status": "scheduled",
            "last_full_sync_at": None,
            "updated_at": now,
            "leader_farm_id": None,
            "current_tournament_id": None,
        }

    def get_config(self) -> dict[str, Any]:
        response = self.config_table.get_item(Key={"pk": CONFIG_PK})
        item = response.get("Item")
        if not item:
            return self.default_config()
        return _from_ddb(item)

    def put_config(self, config: dict[str, Any]) -> dict[str, Any]:
        item = dict(config)
        item["pk"] = CONFIG_PK
        item["updated_at"] = utc_now_iso()
        self.config_table.put_item(Item=_to_ddb(item))
        return item

    def mark_synced(self) -> None:
        self.config_table.update_item(
            Key={"pk": CONFIG_PK},
            UpdateExpression="SET last_full_sync_at = :ts, updated_at = :ts",
            ExpressionAttributeValues={":ts": utc_now_iso()},
        )

    # ------------------------------------------------------------------
    # Scores
    # ------------------------------------------------------------------

    def put_score(self, score: dict[str, Any]) -> dict[str, Any]:
        item = dict(score)
        item["last_updated_at"] = utc_now_iso()
        self.scores_table.put_item(Item=_to_ddb(item))
        return item

    def get_score(self, farm_id: str) -> dict[str, Any] | None:
        response = self.scores_table.get_item(Key={"farm_id": str(farm_id)})
        item = response.get("Item")
        return _from_ddb(item) if item else None

    def delete_score(self, farm_id: str) -> None:
        self.scores_table.delete_item(Key={"farm_id": str(farm_id)})

    def list_scores(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        scan_kwargs: dict[str, Any] = {}
        while True:
            response = self.scores_table.scan(**scan_kwargs)
            items.extend(_from_ddb(item) for item in response.get("Items", []))
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            scan_kwargs["ExclusiveStartKey"] = last_key
        return items

    def empty_score(self, farm_id: str, name: str = "") -> dict[str, Any]:
        return {
            "farm_id": str(farm_id),
            "name": name,
            "digs_to_third_op": None,
            "digs_to_first_op": None,
            "digs_to_second_op": None,
            "otter_count": 0,
            "total_digs": 0,
            "digs_today": 0,
            "status": STATUS_NOT_STARTED,
            "invalidated": False,
            "override_digs_to_third_op": None,
            "override_reason": None,
            "error": None,
            "first_op_at": None,
            "second_op_at": None,
            "third_op_at": None,
            "last_updated_at": utc_now_iso(),
        }

    # ------------------------------------------------------------------
    # Submissions
    # ------------------------------------------------------------------

    def put_submission(self, farm_id: str, name: str = "") -> dict[str, Any]:
        item = {
            "farm_id": str(farm_id).strip(),
            "name": name.strip(),
            "submitted_at": utc_now_iso(),
            "status": "pending",
        }
        self.submissions_table.put_item(Item=_to_ddb(item))
        return item

    def get_submission(self, farm_id: str) -> dict[str, Any] | None:
        response = self.submissions_table.get_item(Key={"farm_id": str(farm_id)})
        item = response.get("Item")
        return _from_ddb(item) if item else None

    def list_submissions(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        scan_kwargs: dict[str, Any] = {}
        while True:
            response = self.submissions_table.scan(**scan_kwargs)
            items.extend(_from_ddb(item) for item in response.get("Items", []))
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            scan_kwargs["ExclusiveStartKey"] = last_key
        return items

    def delete_submission(self, farm_id: str) -> None:
        self.submissions_table.delete_item(Key={"farm_id": str(farm_id)})

    # ------------------------------------------------------------------
    # Leaderboard cache
    # ------------------------------------------------------------------

    def put_leaderboard_cache(self, payload: dict[str, Any]) -> dict[str, Any]:
        item = dict(payload)
        item["pk"] = CACHE_PK
        item["generated_at"] = utc_now_iso()
        self.config_table.put_item(Item=_to_ddb(item))
        return item

    def get_leaderboard_cache(self) -> dict[str, Any] | None:
        response = self.config_table.get_item(Key={"pk": CACHE_PK})
        item = response.get("Item")
        return _from_ddb(item) if item else None

    # ------------------------------------------------------------------
    # Raw snapshots (S3)
    # ------------------------------------------------------------------

    def write_snapshot(self, farm_id: str, payload: dict[str, Any]) -> str:
        key = f"snapshots/{farm_id}.json"
        body = json.dumps(payload, default=str, separators=(",", ":"))
        self._s3.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=body,
            ContentType="application/json",
        )
        return key

    def read_snapshot(self, farm_id: str) -> dict[str, Any] | None:
        key = f"snapshots/{farm_id}.json"
        try:
            response = self._s3.get_object(Bucket=self._bucket, Key=key)
            return json.loads(response["Body"].read())
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in {"NoSuchKey", "NoSuchBucket", "404"}:
                return None
            raise

    def _put_json(self, key: str, payload: dict[str, Any]) -> str:
        body = json.dumps(payload, default=str, separators=(",", ":"))
        self._s3.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=body,
            ContentType="application/json",
        )
        return key

    def _get_json(self, key: str) -> dict[str, Any] | None:
        try:
            response = self._s3.get_object(Bucket=self._bucket, Key=key)
            parsed = json.loads(response["Body"].read())
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in {"NoSuchKey", "NoSuchBucket", "404"}:
                return None
            raise
        return parsed if isinstance(parsed, dict) else None

    def _list_keys(self, prefix: str) -> list[str]:
        keys: list[str] = []
        token: str | None = None
        while True:
            kwargs: dict[str, Any] = {"Bucket": self._bucket, "Prefix": prefix}
            if token:
                kwargs["ContinuationToken"] = token
            response = self._s3.list_objects_v2(**kwargs)
            for obj in response.get("Contents") or []:
                key = str(obj.get("Key") or "")
                if key:
                    keys.append(key)
            if not response.get("IsTruncated"):
                break
            token = response.get("NextContinuationToken")
        return keys

    def tournament_pk(self, tournament_id: str) -> str:
        return f"{TOURNAMENT_PK_PREFIX}{tournament_id}"

    def get_tournament(self, tournament_id: str) -> dict[str, Any] | None:
        response = self.config_table.get_item(Key={"pk": self.tournament_pk(tournament_id)})
        item = response.get("Item")
        return _from_ddb(item) if item else None

    def put_tournament(self, item: dict[str, Any]) -> dict[str, Any]:
        tid = str(item.get("tournament_id") or "").strip()
        if not tid:
            raise ValueError("tournament_id is required")
        stored = dict(item)
        stored["pk"] = self.tournament_pk(tid)
        stored["updated_at"] = utc_now_iso()
        self.config_table.put_item(Item=_to_ddb(stored))
        ids = self.list_tournament_ids()
        if tid not in ids:
            ids.append(tid)
            self._put_tournament_index(ids)
        return stored

    def delete_tournament(self, tournament_id: str) -> None:
        self.config_table.delete_item(Key={"pk": self.tournament_pk(tournament_id)})
        ids = [item for item in self.list_tournament_ids() if item != tournament_id]
        self._put_tournament_index(ids)

    def list_tournament_ids(self) -> list[str]:
        response = self.config_table.get_item(Key={"pk": TOURNAMENT_INDEX_PK})
        item = response.get("Item")
        if not item:
            return []
        data = _from_ddb(item)
        raw = data.get("ids") or []
        return [str(value) for value in raw if str(value).strip()]

    def _put_tournament_index(self, ids: list[str]) -> None:
        self.config_table.put_item(
            Item=_to_ddb({"pk": TOURNAMENT_INDEX_PK, "ids": ids, "updated_at": utc_now_iso()})
        )

    def list_tournament_items(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for tid in self.list_tournament_ids():
            row = self.get_tournament(tid)
            if row:
                items.append(row)
        return items

    def write_archive(self, tournament_id: str, payload: dict[str, Any]) -> str:
        prefix = f"archives/{tournament_id}"
        meta = {
            key: payload.get(key)
            for key in (
                "tournament_id",
                "archived_at",
                "config",
                "count",
                "leader_farm_id",
            )
        }
        standings = {
            "tournament_id": tournament_id,
            "entries": payload.get("entries") or [],
            "count": int(payload.get("count") or 0),
            "leader_farm_id": payload.get("leader_farm_id"),
        }
        self._put_json(f"{prefix}/meta.json", meta)
        self._put_json(f"{prefix}/standings.json", standings)
        return f"{prefix}/standings.json"

    def write_archive_farm(self, tournament_id: str, farm_id: str, payload: dict[str, Any]) -> str:
        return self._put_json(f"archives/{tournament_id}/farms/{farm_id}.json", payload)

    def read_archive_farm(self, tournament_id: str, farm_id: str) -> dict[str, Any] | None:
        return self._get_json(f"archives/{tournament_id}/farms/{farm_id}.json")

    def read_archive(self, tournament_id: str) -> dict[str, Any] | None:
        meta = self._get_json(f"archives/{tournament_id}/meta.json")
        standings = self._get_json(f"archives/{tournament_id}/standings.json")
        if meta or standings:
            merged = dict(meta or {})
            if standings:
                merged["entries"] = standings.get("entries") or []
                merged["count"] = standings.get("count", merged.get("count"))
                if standings.get("leader_farm_id") is not None:
                    merged["leader_farm_id"] = standings.get("leader_farm_id")
                if standings.get("tournament_id"):
                    merged["tournament_id"] = standings.get("tournament_id")
            return merged
        return self._get_json(f"archives/{tournament_id}.json")

    def list_archive_ids(self) -> list[str]:
        ids: set[str] = set()
        for key in self._list_keys("archives/"):
            rest = key[len("archives/") :] if key.startswith("archives/") else key
            if not rest:
                continue
            if "/" not in rest:
                if rest.endswith(".json"):
                    ids.add(rest[: -len(".json")])
                continue
            ids.add(rest.split("/", 1)[0])
        return sorted(ids)

    def list_archives(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for tournament_id in self.list_archive_ids():
            payload = self.read_archive(tournament_id)
            if not payload:
                continue
            items.append(archive_summary(payload))
        items.sort(key=lambda item: str(item.get("start_at") or ""), reverse=True)
        return items

    def write_daily_snapshot(self, day: str, payload: dict[str, Any]) -> str:
        key = f"snapshots/daily/{day}.json"
        body = json.dumps(payload, default=str, separators=(",", ":"))
        self._s3.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=body,
            ContentType="application/json",
        )
        return key


def archive_summary(payload: dict[str, Any]) -> dict[str, Any]:
    config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
    return {
        "tournament_id": payload.get("tournament_id"),
        "name": config.get("name") or payload.get("name") or "",
        "start_at": config.get("start_at") or payload.get("start_at"),
        "end_at": config.get("end_at") or payload.get("end_at"),
        "duration_days": config.get("duration_days") or payload.get("duration_days"),
        "prize_amount": str(config.get("prize_amount") or payload.get("prize_amount") or "30"),
        "status": config.get("status") or payload.get("status") or "ended",
        "archived_at": payload.get("archived_at"),
        "count": int(payload.get("count") or 0),
        "leader_farm_id": payload.get("leader_farm_id"),
    }


_SERIALIZER = TypeSerializer()
_DESERIALIZER = TypeDeserializer()


def _to_ddb(item: dict[str, Any]) -> dict[str, Any]:
    """Convert floats to Decimal; leave None as NULL-friendly omit? keep None."""
    return json.loads(json.dumps(item, default=str), parse_float=Decimal)


def _from_ddb(item: dict[str, Any]) -> dict[str, Any]:
    def convert(value: Any) -> Any:
        if isinstance(value, Decimal):
            if value % 1 == 0:
                return int(value)
            return float(value)
        if isinstance(value, dict):
            return {k: convert(v) for k, v in value.items()}
        if isinstance(value, list):
            return [convert(v) for v in value]
        return value

    return convert(item)
