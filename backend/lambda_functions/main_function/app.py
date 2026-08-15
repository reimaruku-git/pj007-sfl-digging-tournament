"""HTTP API router for the SFL Digging Tournament."""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote

import boto3

from common.response import create_error_response, create_response, set_request_origin
from tournament.archive import archive_current
from tournament.catalog import (
    CatalogError,
    active_tournament,
    apply_live_config,
    create_tournament,
    delete_tournament,
    get_public_tournament,
    get_public_tournament_farm,
    list_public_tournaments,
    parse_window,
    seed_catalog,
    tournament_record,
    update_tournament,
)
from tournament.farms import FarmRegistry
from tournament.leaderboard import official_score, public_entry, rank_scores
from tournament.scoring import STATUS_COMPLETED
from tournament.store import Store
from tournament.sync import (
    parse_iso,
    public_config,
    refresh_leaderboard,
    rescore_from_snapshots,
    tournament_status,
)
from tournament.window import configured_duration_days, tournament_id

logger = logging.getLogger()
logger.setLevel(logging.INFO)

DATA_BUCKET = os.environ.get("DATA_BUCKET", "")
CONFIG_TABLE = os.environ.get("CONFIG_TABLE", "")
SCORES_TABLE = os.environ.get("SCORES_TABLE", "")
SUBMISSIONS_TABLE = os.environ.get("SUBMISSIONS_TABLE", "")
FARM_SYNC_FUNCTION = os.environ.get("FARM_SYNC_FUNCTION", "")

_store: Store | None = None
_registry: FarmRegistry | None = None
_lambda = None


def _get_store() -> Store:
    global _store
    if _store is None:
        _store = Store(
            config_table=CONFIG_TABLE,
            scores_table=SCORES_TABLE,
            submissions_table=SUBMISSIONS_TABLE,
            data_bucket=DATA_BUCKET,
        )
    return _store


def _get_registry() -> FarmRegistry:
    global _registry
    if _registry is None:
        _registry = FarmRegistry(DATA_BUCKET)
    return _registry


def _lambda_client():
    global _lambda
    if _lambda is None:
        _lambda = boto3.client("lambda")
    return _lambda


def _headers(event: dict[str, Any]) -> dict[str, str]:
    raw = event.get("headers") or {}
    return {str(key).lower(): str(value) for key, value in raw.items()}


def _method(event: dict[str, Any]) -> str:
    http = (event.get("requestContext") or {}).get("http") or {}
    return str(http.get("method") or event.get("httpMethod") or "GET").upper()


def _path(event: dict[str, Any]) -> str:
    raw = event.get("rawPath") or event.get("path") or "/"
    stage = (event.get("requestContext") or {}).get("stage")
    if stage and raw.startswith(f"/{stage}/"):
        raw = raw[len(stage) + 1 :]
    elif stage and raw == f"/{stage}":
        raw = "/"
    if not raw.startswith("/"):
        raw = f"/{raw}"
    if len(raw) > 1:
        raw = raw.rstrip("/")
    return raw


def _body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body")
    if not raw:
        return {}
    if event.get("isBase64Encoded"):
        import base64

        raw = base64.b64decode(raw).decode("utf-8")
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _path_params(event: dict[str, Any]) -> dict[str, str]:
    params = event.get("pathParameters") or {}
    return {str(k): unquote(str(v)) for k, v in params.items() if v is not None}


def _farm_id_from_body(body: dict[str, Any]) -> str:
    return str(body.get("farm_id") or body.get("farmId") or "").strip()


def handle_health(_event: dict[str, Any]) -> dict[str, Any]:
    return create_response(200, {"status": "healthy"})


def handle_get_config(_event: dict[str, Any]) -> dict[str, Any]:
    store = _get_store()
    config = seed_catalog(store)
    start = parse_iso(config.get("start_at"))
    end = parse_iso(config.get("end_at"))
    if start and end:
        config["status"] = tournament_status(start, end, datetime.now(timezone.utc))
    return create_response(200, public_config(config))


def handle_get_leaderboard(_event: dict[str, Any]) -> dict[str, Any]:
    store = _get_store()
    seed_catalog(store)
    archive_current(store)
    if not active_tournament(store):
        return create_response(
            200,
            {
                "entries": [],
                "count": 0,
                "generated_at": None,
                "config": public_config(store.get_config()),
            },
            extra_headers={"Cache-Control": "public, max-age=30"},
        )
    cache = store.get_leaderboard_cache()
    if not cache or not cache.get("entries"):
        cache = refresh_leaderboard(store)
    entries = [public_entry(row) for row in (cache.get("entries") or [])]
    return create_response(
        200,
        {
            "entries": entries,
            "count": int(cache.get("count") or len(entries)),
            "generated_at": cache.get("generated_at"),
            "config": public_config(store.get_config()),
        },
        extra_headers={"Cache-Control": "public, max-age=30"},
    )


def handle_get_farm(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = _path_params(event).get("farm_id", "").strip()
    if not farm_id:
        return create_error_response(400, "farm_id is required", "VALIDATION_ERROR")
    store = _get_store()
    registry = _get_registry()
    tracked = registry.get(farm_id)
    score = store.get_score(farm_id)
    if not tracked and not score:
        return create_error_response(404, "farm not found", "NOT_FOUND")
    row = score or store.empty_score(farm_id, (tracked or {}).get("name") or "")
    if tracked:
        row["name"] = tracked.get("name") or row.get("name") or ""
    config = store.get_config()
    days = configured_duration_days(config)
    ranked = rank_scores(store.list_scores(), tournament_days=days)
    match = next((item for item in ranked if item.get("farm_id") == farm_id), row)
    return create_response(200, {"farm": public_entry(match)})


def handle_submit_farm(event: dict[str, Any]) -> dict[str, Any]:
    body = _body(event)
    farm_id = _farm_id_from_body(body)
    name = str(body.get("name") or "").strip()
    if not farm_id:
        return create_error_response(400, "farm_id is required", "VALIDATION_ERROR")
    if not re.fullmatch(r"[0-9]{6,32}", farm_id):
        return create_error_response(400, "farm_id must be a numeric id", "VALIDATION_ERROR")
    registry = _get_registry()
    if registry.get(farm_id):
        return create_error_response(409, "farm is already tracked", "CONFLICT")
    store = _get_store()
    existing = store.get_submission(farm_id)
    if existing:
        return create_error_response(409, "farm is already pending approval", "CONFLICT")
    submission = store.put_submission(farm_id, name)
    return create_response(201, {"submission": submission})


def handle_admin_session(_event: dict[str, Any]) -> dict[str, Any]:
    # API Gateway Cognito JWT authorizer already verified the ID token.
    return create_response(200, {"ok": True})


def _kick_farm_sync(source: str, farm_id: str | None = None) -> bool:
    if not FARM_SYNC_FUNCTION:
        return False
    payload: dict[str, Any] = {"source": source}
    if farm_id:
        payload["farm_id"] = farm_id
    try:
        _lambda_client().invoke(
            FunctionName=FARM_SYNC_FUNCTION,
            InvocationType="Event",
            Payload=json.dumps(payload),
        )
        return True
    except Exception:
        logger.exception("Failed to invoke farm sync (%s)", source)
        return False


def handle_admin_get_config(_event: dict[str, Any]) -> dict[str, Any]:
    store = _get_store()
    config = seed_catalog(store)
    start = parse_iso(config.get("start_at"))
    end = parse_iso(config.get("end_at"))
    if start and end:
        config["status"] = tournament_status(start, end, datetime.now(timezone.utc))
    return create_response(200, {"config": public_config(config)})


def handle_list_tournaments(_event: dict[str, Any]) -> dict[str, Any]:
    tournaments = list_public_tournaments(_get_store())
    return create_response(200, {"tournaments": tournaments, "count": len(tournaments)})


def handle_get_tournament(event: dict[str, Any]) -> dict[str, Any]:
    tournament = _path_params(event).get("tournament_id", "").strip()
    if not tournament:
        return create_error_response(400, "tournament_id is required", "VALIDATION_ERROR")
    payload = get_public_tournament(_get_store(), tournament)
    if payload is None:
        return create_error_response(404, "tournament archive not found", "NOT_FOUND")
    return create_response(200, {"tournament": payload})


def handle_get_tournament_farm(event: dict[str, Any]) -> dict[str, Any]:
    params = _path_params(event)
    tournament = params.get("tournament_id", "").strip()
    farm_id = params.get("farm_id", "").strip()
    if not tournament or not farm_id:
        return create_error_response(400, "tournament_id and farm_id are required", "VALIDATION_ERROR")
    entry = get_public_tournament_farm(_get_store(), tournament, farm_id)
    if entry is None:
        return create_error_response(404, "farm not found in that tournament", "NOT_FOUND")
    return create_response(200, {"farm": entry})


def _catalog_error(exc: CatalogError) -> dict[str, Any]:
    return create_error_response(exc.status, exc.message, exc.code)


def handle_admin_list_tournaments(_event: dict[str, Any]) -> dict[str, Any]:
    tournaments = list_public_tournaments(_get_store())
    return create_response(200, {"tournaments": tournaments, "count": len(tournaments)})


def handle_admin_create_tournament(event: dict[str, Any]) -> dict[str, Any]:
    try:
        row = create_tournament(_get_store(), _body(event))
    except CatalogError as exc:
        return _catalog_error(exc)
    return create_response(201, {"tournament": row})


def handle_admin_update_tournament(event: dict[str, Any]) -> dict[str, Any]:
    tournament = _path_params(event).get("tournament_id", "").strip()
    if not tournament:
        return create_error_response(400, "tournament_id is required", "VALIDATION_ERROR")
    try:
        row = update_tournament(_get_store(), tournament, _body(event))
    except CatalogError as exc:
        return _catalog_error(exc)
    return create_response(200, {"tournament": row})


def handle_admin_delete_tournament(event: dict[str, Any]) -> dict[str, Any]:
    tournament = _path_params(event).get("tournament_id", "").strip()
    if not tournament:
        return create_error_response(400, "tournament_id is required", "VALIDATION_ERROR")
    try:
        delete_tournament(_get_store(), tournament)
    except CatalogError as exc:
        return _catalog_error(exc)
    return create_response(200, {"ok": True})


def handle_admin_put_config(event: dict[str, Any]) -> dict[str, Any]:
    body = _body(event)
    store = _get_store()
    seed_catalog(store)
    try:
        start, end, days = parse_window(body)
        from tournament.catalog import normalize_name

        name = normalize_name(body.get("name"), start)
    except CatalogError as exc:
        return _catalog_error(exc)
    prize = str(body.get("prize_amount") or body.get("prizeAmount") or "").strip() or "30"
    existing = store.get_config()
    new_id = tournament_id(
        {"start_at": start.isoformat(), "end_at": end.isoformat(), "duration_days": days}
    )
    old_id = str(existing.get("current_tournament_id") or "").strip() or tournament_id(existing)
    if existing.get("start_at") and old_id != new_id:
        archive_current(store, force=True)
    status = tournament_status(start, end, datetime.now(timezone.utc))
    row = tournament_record(
        start=start,
        end=end,
        days=days,
        name=name,
        prize=prize,
        status="active" if status == "ended" else status,
        tournament_id_value=new_id,
    )
    store.put_tournament(row)
    config = apply_live_config(store, row, existing=existing)
    rescore = rescore_from_snapshots(store)
    sync_accepted = _kick_farm_sync("admin-config")
    return create_response(
        200,
        {
            "config": public_config(config),
            "rescore": {
                "rescored": rescore["rescored"],
                "missing_snapshots": rescore["missing_snapshots"],
                "sync_accepted": sync_accepted,
            },
        },
    )


def handle_admin_list_farms(event: dict[str, Any]) -> dict[str, Any]:
    farms = _get_registry().list_farms()
    return create_response(200, {"farms": farms, "count": len(farms)})


def handle_admin_add_farm(event: dict[str, Any]) -> dict[str, Any]:
    body = _body(event)
    farm_id = _farm_id_from_body(body)
    if not farm_id:
        return create_error_response(400, "farm_id is required", "VALIDATION_ERROR")
    name = str(body.get("name") or "").strip()
    active = body.get("active", True)
    if isinstance(active, str):
        active = active.lower() in {"1", "true", "yes"}
    registry = _get_registry()
    saved = registry.upsert(farm_id, name=name, active=bool(active))
    store = _get_store()
    if not store.get_score(farm_id):
        store.put_score(store.empty_score(farm_id, name))
        refresh_leaderboard(store)
    farm = next(item for item in saved["farms"] if item["farm_id"] == farm_id)
    return create_response(
        201, {"farm": farm, "farms": saved["farms"], "count": len(saved["farms"])}
    )


def handle_admin_update_farm(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = _path_params(event).get("farm_id", "").strip()
    if not farm_id:
        return create_error_response(400, "farm_id is required", "VALIDATION_ERROR")
    registry = _get_registry()
    existing = registry.get(farm_id)
    if not existing:
        return create_error_response(404, "farm not found", "NOT_FOUND")
    body = _body(event)
    name = existing["name"] if "name" not in body else str(body.get("name") or "").strip()
    active = existing["active"] if "active" not in body else bool(body.get("active"))
    saved = registry.upsert(farm_id, name=name, active=active)
    farm = next(item for item in saved["farms"] if item["farm_id"] == farm_id)
    score = _get_store().get_score(farm_id)
    if score:
        score["name"] = name
        _get_store().put_score(score)
        refresh_leaderboard(_get_store())
    return create_response(200, {"farm": farm})


def handle_admin_delete_farm(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = _path_params(event).get("farm_id", "").strip()
    if not farm_id:
        return create_error_response(400, "farm_id is required", "VALIDATION_ERROR")
    try:
        saved = _get_registry().remove(farm_id)
    except KeyError:
        return create_error_response(404, "farm not found", "NOT_FOUND")
    return create_response(200, {"farms": saved["farms"], "count": len(saved["farms"])})


def handle_admin_list_submissions(event: dict[str, Any]) -> dict[str, Any]:
    submissions = _get_store().list_submissions()
    submissions.sort(key=lambda item: item.get("submitted_at") or "", reverse=True)
    return create_response(200, {"submissions": submissions, "count": len(submissions)})


def handle_admin_approve_submission(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = _path_params(event).get("farm_id", "").strip()
    store = _get_store()
    submission = store.get_submission(farm_id)
    if not submission:
        return create_error_response(404, "submission not found", "NOT_FOUND")
    saved = _get_registry().upsert(farm_id, name=submission.get("name") or "", active=True)
    store.delete_submission(farm_id)
    if not store.get_score(farm_id):
        store.put_score(store.empty_score(farm_id, submission.get("name") or ""))
        refresh_leaderboard(store)
    farm = next(item for item in saved["farms"] if item["farm_id"] == farm_id)
    return create_response(200, {"farm": farm})


def handle_admin_reject_submission(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = _path_params(event).get("farm_id", "").strip()
    store = _get_store()
    if not store.get_submission(farm_id):
        return create_error_response(404, "submission not found", "NOT_FOUND")
    store.delete_submission(farm_id)
    return create_response(200, {"ok": True})


def handle_admin_refresh_farm(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = _path_params(event).get("farm_id", "").strip()
    if not farm_id:
        return create_error_response(400, "farm_id is required", "VALIDATION_ERROR")
    if not _get_registry().get(farm_id):
        return create_error_response(404, "farm is not tracked", "NOT_FOUND")
    if not FARM_SYNC_FUNCTION:
        return create_error_response(500, "sync function is not configured", "CONFIG_ERROR")
    if not _kick_farm_sync("admin-refresh", farm_id):
        return create_error_response(500, "failed to start refresh", "SYNC_ERROR")
    return create_response(202, {"accepted": True, "farm_id": farm_id})


def handle_admin_sync(event: dict[str, Any]) -> dict[str, Any]:
    if not FARM_SYNC_FUNCTION:
        return create_error_response(500, "sync function is not configured", "CONFIG_ERROR")
    if not _kick_farm_sync("admin"):
        return create_error_response(500, "failed to start sync", "SYNC_ERROR")
    return create_response(202, {"accepted": True})


def handle_admin_put_score(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = _path_params(event).get("farm_id", "").strip()
    store = _get_store()
    row = store.get_score(farm_id)
    if not row:
        tracked = _get_registry().get(farm_id)
        if not tracked:
            return create_error_response(404, "score not found", "NOT_FOUND")
        row = store.empty_score(farm_id, tracked.get("name") or "")
    body = _body(event)
    if "invalidated" in body:
        row["invalidated"] = bool(body.get("invalidated"))
    if "override_digs_to_third_op" in body or "overrideDigsToThirdOp" in body:
        raw = body.get("override_digs_to_third_op", body.get("overrideDigsToThirdOp"))
        if raw is None or raw == "":
            row["override_digs_to_third_op"] = None
        else:
            try:
                value = int(raw)
            except (TypeError, ValueError):
                return create_error_response(
                    400, "override_digs_to_third_op must be an integer", "VALIDATION_ERROR"
                )
            if value < 1:
                return create_error_response(
                    400, "override_digs_to_third_op must be >= 1", "VALIDATION_ERROR"
                )
            row["override_digs_to_third_op"] = value
            row["status"] = STATUS_COMPLETED
            row["otter_count"] = 3
    if "override_reason" in body or "overrideReason" in body:
        row["override_reason"] = (
            str(body.get("override_reason") or body.get("overrideReason") or "").strip() or None
        )
    stored = store.put_score(row)
    refresh_leaderboard(store)
    stored["digs_to_third_op"] = official_score(stored)
    return create_response(200, {"score": stored})


def handle_admin_get_snapshot(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = _path_params(event).get("farm_id", "").strip()
    snapshot = _get_store().read_snapshot(farm_id)
    if snapshot is None:
        return create_error_response(404, "snapshot not found", "NOT_FOUND")
    return create_response(200, {"snapshot": snapshot})


ROUTES: list[tuple[str, re.Pattern[str], Any]] = [
    ("GET", re.compile(r"^/health$"), handle_health),
    ("GET", re.compile(r"^/config$"), handle_get_config),
    ("GET", re.compile(r"^/leaderboard$"), handle_get_leaderboard),
    ("GET", re.compile(r"^/tournaments$"), handle_list_tournaments),
    (
        "GET",
        re.compile(r"^/tournaments/(?P<tournament_id>[^/]+)/farms/(?P<farm_id>[^/]+)$"),
        handle_get_tournament_farm,
    ),
    ("GET", re.compile(r"^/tournaments/(?P<tournament_id>[^/]+)$"), handle_get_tournament),
    ("GET", re.compile(r"^/farms/(?P<farm_id>[^/]+)$"), handle_get_farm),
    ("POST", re.compile(r"^/submissions$"), handle_submit_farm),
    ("GET", re.compile(r"^/admin/session$"), handle_admin_session),
    ("GET", re.compile(r"^/admin/config$"), handle_admin_get_config),
    ("PUT", re.compile(r"^/admin/config$"), handle_admin_put_config),
    ("GET", re.compile(r"^/admin/tournaments$"), handle_admin_list_tournaments),
    ("POST", re.compile(r"^/admin/tournaments$"), handle_admin_create_tournament),
    (
        "PUT",
        re.compile(r"^/admin/tournaments/(?P<tournament_id>[^/]+)$"),
        handle_admin_update_tournament,
    ),
    (
        "DELETE",
        re.compile(r"^/admin/tournaments/(?P<tournament_id>[^/]+)$"),
        handle_admin_delete_tournament,
    ),
    ("GET", re.compile(r"^/admin/farms$"), handle_admin_list_farms),
    ("POST", re.compile(r"^/admin/farms$"), handle_admin_add_farm),
    ("PUT", re.compile(r"^/admin/farms/(?P<farm_id>[^/]+)$"), handle_admin_update_farm),
    ("DELETE", re.compile(r"^/admin/farms/(?P<farm_id>[^/]+)$"), handle_admin_delete_farm),
    ("GET", re.compile(r"^/admin/submissions$"), handle_admin_list_submissions),
    (
        "POST",
        re.compile(r"^/admin/submissions/(?P<farm_id>[^/]+)/approve$"),
        handle_admin_approve_submission,
    ),
    (
        "DELETE",
        re.compile(r"^/admin/submissions/(?P<farm_id>[^/]+)$"),
        handle_admin_reject_submission,
    ),
    (
        "POST",
        re.compile(r"^/admin/farms/(?P<farm_id>[^/]+)/refresh$"),
        handle_admin_refresh_farm,
    ),
    ("POST", re.compile(r"^/admin/sync$"), handle_admin_sync),
    ("PUT", re.compile(r"^/admin/scores/(?P<farm_id>[^/]+)$"), handle_admin_put_score),
    (
        "GET",
        re.compile(r"^/admin/scores/(?P<farm_id>[^/]+)/snapshot$"),
        handle_admin_get_snapshot,
    ),
]


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    headers = _headers(event)
    set_request_origin(headers.get("origin"))
    method = _method(event)
    path = _path(event)
    logger.info("%s %s", method, path)

    if method == "OPTIONS":
        return create_response(200, {"ok": True})

    for route_method, pattern, handler in ROUTES:
        if method != route_method:
            continue
        match = pattern.fullmatch(path)
        if not match:
            continue
        params = event.get("pathParameters") or {}
        params.update(match.groupdict())
        event["pathParameters"] = params
        try:
            return handler(event)
        except ValueError as exc:
            return create_error_response(400, str(exc), "VALIDATION_ERROR")
        except Exception:
            logger.exception("Unhandled error on %s %s", method, path)
            return create_error_response(500, "internal server error", "INTERNAL_ERROR")

    return create_error_response(404, "route not found", "NOT_FOUND")
