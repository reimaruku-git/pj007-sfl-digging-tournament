"""HTTP API router for the SFL Digging Tournament."""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote

import boto3

from common.response import (
    create_binary_response,
    create_error_response,
    create_response,
    set_request_origin,
)
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
    normalize_name,
    parse_window,
    seed_catalog,
    set_featured_tournament,
    showcase_featured_id,
    tournament_record,
    update_tournament,
)
from tournament.farms import FarmRegistry
from tournament.history import recorded_farm_stats
from tournament.avatars import (
    apply_avatar_update,
    attach_avatars,
    avatar_key_from_path,
    public_profile,
)
from tournament.images import (
    CONTENT_TYPE_BY_EXT,
    MediaError,
    media_key_from_path,
    store_tournament_image,
    public_api_base_from_event,
)
from tournament.leaderboard import official_score, public_entry, rank_scores
from tournament.membership import (
    MembershipError,
    add_farms_to_tournament,
    approve_join,
    drop_farm_members,
    enrolled_farm_ids,
    farm_live_tournament_ids,
    parse_farm_ids,
    parse_tournament_ids,
    public_farm_memberships,
    public_member,
    reject_join,
    remove_farm_from_tournament,
    request_joins,
    roster_members,
)
from tournament.scoring import STATUS_COMPLETED
from tournament.slogans import (
    SloganError,
    add_slogan,
    replace_slogans,
    slogans_document,
)
from tournament.stats import player_detail, player_list_row
from tournament.sfl_client import (
    SFLApiError,
    build_identify_sfl_client,
    build_sfl_client,
    identity_from_community_payload,
    load_sfl_keys,
)
from tournament.sfl_world import SflWorldError, lookup_farm_name
from tournament.store import Store
from tournament.sync import (
    drop_untracked_scores,
    parse_iso,
    public_config,
    refresh_leaderboard,
    rescore_from_snapshots,
    tournament_status,
)
from tournament.window import configured_duration_days, tournament_id

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "")
DATA_BUCKET = os.environ.get("DATA_BUCKET", "")
CONFIG_TABLE = os.environ.get("CONFIG_TABLE", "")
SCORES_TABLE = os.environ.get("SCORES_TABLE", "")
SUBMISSIONS_TABLE = os.environ.get("SUBMISSIONS_TABLE", "")
FARM_SYNC_FUNCTION = os.environ.get("FARM_SYNC_FUNCTION", "")
SECRETS_BUCKET = os.environ.get("SECRETS_BUCKET", "")
SFL_KEYS_OBJECT = os.environ.get("SFL_KEYS_OBJECT", "sfl-api-keys.json")

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


def _join_sfl_client():
    """One-farm Community API client for gated public joins. None if no keys."""
    keys = load_sfl_keys(SECRETS_BUCKET, SFL_KEYS_OBJECT)
    if not keys:
        return None
    return build_sfl_client(keys)


def _identify_from_community(farm_id: str) -> dict[str, Any] | None:
    """Timed Community fallback after sfl.world misses. None if that farm is gone."""
    client = build_identify_sfl_client(load_sfl_keys(SECRETS_BUCKET, SFL_KEYS_OBJECT))
    if client is None:
        logger.warning("identify Community fallback skipped for %s: no SFL keys", farm_id)
        return None
    try:
        payload = client.fetch_farm(farm_id)
    except SFLApiError as exc:
        logger.warning("identify Community fallback failed for %s: %s", farm_id, exc)
        return None
    looked_up = identity_from_community_payload(payload, farm_id)
    if looked_up is None:
        logger.warning("identify Community payload had no farm for %s", farm_id)
    return looked_up


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


def handle_get_slogans(_event: dict[str, Any]) -> dict[str, Any]:
    return create_response(200, slogans_document(_get_store()))


def _slogan_error(exc: SloganError) -> dict[str, Any]:
    return create_error_response(exc.status, exc.message, exc.code)


def handle_admin_get_slogans(_event: dict[str, Any]) -> dict[str, Any]:
    return create_response(200, slogans_document(_get_store()))


def handle_admin_post_slogans(event: dict[str, Any]) -> dict[str, Any]:
    try:
        slogan, payload = add_slogan(_get_store(), _body(event))
    except SloganError as exc:
        return _slogan_error(exc)
    payload["slogan"] = slogan
    return create_response(201, payload)


def handle_admin_put_slogans(event: dict[str, Any]) -> dict[str, Any]:
    try:
        payload = replace_slogans(_get_store(), _body(event))
    except SloganError as exc:
        return _slogan_error(exc)
    return create_response(200, payload)


def handle_get_config(_event: dict[str, Any]) -> dict[str, Any]:
    store = _get_store()
    config = seed_catalog(store)
    start = parse_iso(config.get("start_at"))
    end = parse_iso(config.get("end_at"))
    if start and end:
        config["status"] = tournament_status(start, end, datetime.now(timezone.utc))
    return create_response(200, public_config(config))


def _refresh_public_board(store: Store | None = None) -> dict[str, Any]:
    store = store or _get_store()
    registry = _get_registry()
    drop_untracked_scores(store, registry)
    return refresh_leaderboard(store, registry=registry)


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
    cache = _refresh_public_board(store)
    entries = attach_avatars(store, [public_entry(row) for row in (cache.get("entries") or [])])
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
    if not tracked:
        if score:
            store.delete_score(farm_id)
            _refresh_public_board(store)
        return create_error_response(404, "farm not found", "NOT_FOUND")
    row = score or store.empty_score(farm_id, tracked.get("name") or "")
    row["name"] = tracked.get("name") or row.get("name") or ""
    config = store.get_config()
    days = configured_duration_days(config)
    tid = str(config.get("current_tournament_id") or "").strip()
    allowed = registry.farm_ids(active_only=True)
    event = store.get_tournament(tid) if tid else None
    if tid and event and event.get("roster_seeded"):
        allowed = allowed & enrolled_farm_ids(store, tid)
    ranked = rank_scores(
        [item for item in store.list_scores() if str(item.get("farm_id") or "") in allowed],
        tournament_days=days,
    )
    match = next((item for item in ranked if item.get("farm_id") == farm_id), row)
    entry = attach_avatars(store, [public_entry(match)])[0]
    stats = recorded_farm_stats(store, farm_id)
    entry["recorded_average_per_day"] = stats["recorded_average_per_day"]
    if stats["score_today"] is not None:
        entry["score_today"] = stats["score_today"]
    return create_response(200, {"farm": entry})


def handle_get_farm_memberships(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = _path_params(event).get("farm_id", "").strip()
    if not farm_id:
        return create_error_response(400, "farm_id is required", "VALIDATION_ERROR")
    if not re.fullmatch(r"[0-9]{6,32}", farm_id):
        return create_error_response(400, "farm_id must be a numeric id", "VALIDATION_ERROR")
    memberships = public_farm_memberships(_get_store(), farm_id)
    return create_response(200, {"memberships": memberships, "count": len(memberships)})


def _public_identity(row: dict[str, Any]) -> dict[str, Any]:
    return public_profile(row)


def handle_identify_farm(event: dict[str, Any]) -> dict[str, Any]:
    body = _body(event)
    farm_id = _farm_id_from_body(body)
    if not farm_id:
        return create_error_response(400, "farm_id is required", "VALIDATION_ERROR")
    if not re.fullmatch(r"[0-9]{6,32}", farm_id):
        return create_error_response(400, "farm_id must be a numeric id", "VALIDATION_ERROR")
    try:
        looked_up = lookup_farm_name(farm_id)
    except SflWorldError as exc:
        logger.warning("sfl.world identify failed for %s: %s", farm_id, exc.message)
        looked_up = _identify_from_community(farm_id)
        if looked_up is None:
            return create_error_response(exc.status_code, exc.message, exc.code)
    stored = _get_store().put_identity(
        farm_id,
        looked_up["name"],
        nft_id=looked_up.get("nft_id"),
    )
    return create_response(200, _public_identity(stored))


def handle_get_farm_profile(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = _path_params(event).get("farm_id", "").strip()
    if not farm_id:
        return create_error_response(400, "farm_id is required", "VALIDATION_ERROR")
    if not re.fullmatch(r"[0-9]{6,32}", farm_id):
        return create_error_response(400, "farm_id must be a numeric id", "VALIDATION_ERROR")
    identity = _get_store().get_identity(farm_id)
    if not identity:
        return create_error_response(404, "farm has not identified", "NOT_FOUND")
    return create_response(200, _public_identity(identity))


def handle_put_farm_avatar(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = _path_params(event).get("farm_id", "").strip()
    if not farm_id:
        return create_error_response(400, "farm_id is required", "VALIDATION_ERROR")
    if not re.fullmatch(r"[0-9]{6,32}", farm_id):
        return create_error_response(400, "farm_id must be a numeric id", "VALIDATION_ERROR")
    store = _get_store()
    try:
        payload = apply_avatar_update(
            store,
            farm_id=farm_id,
            body=_body(event),
            api_base=public_api_base_from_event(event),
            s3_client=store._s3,
        )
    except MediaError as exc:
        return create_error_response(exc.status, exc.message, exc.code)
    return create_response(200, payload)


def handle_get_avatar_media(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = unquote(_path_params(event).get("farm_id", "").strip())
    filename = unquote(_path_params(event).get("filename", "").strip())
    if not farm_id or not filename:
        return create_error_response(400, "farm_id and filename are required", "VALIDATION_ERROR")
    try:
        key = avatar_key_from_path(farm_id, filename)
        payload, stored_type = _get_store().read_object(key)
    except MediaError as exc:
        return create_error_response(exc.status, exc.message, exc.code)
    except FileNotFoundError:
        return create_error_response(404, "media object not found", "NOT_FOUND")
    ext = filename.rsplit(".", 1)[-1].lower()
    content_type = stored_type or CONTENT_TYPE_BY_EXT.get(ext, "application/octet-stream")
    return create_binary_response(200, payload, content_type)


def handle_submit_farm(event: dict[str, Any]) -> dict[str, Any]:
    body = _body(event)
    farm_id = _farm_id_from_body(body)
    name = str(body.get("name") or "").strip()
    if not farm_id:
        return create_error_response(400, "farm_id is required", "VALIDATION_ERROR")
    if not re.fullmatch(r"[0-9]{6,32}", farm_id):
        return create_error_response(400, "farm_id must be a numeric id", "VALIDATION_ERROR")
    try:
        tournament_ids = parse_tournament_ids(body)
    except MembershipError as exc:
        return _membership_error(exc)
    store = _get_store()
    seed_catalog(store)
    identity = store.get_identity(farm_id)
    if identity and identity.get("name"):
        name = str(identity.get("name") or "").strip() or name
    try:
        submissions = request_joins(
            store,
            farm_id=farm_id,
            name=name,
            tournament_ids=tournament_ids,
            registry=_get_registry(),
            sfl_client=_join_sfl_client(),
        )
    except MembershipError as exc:
        return _membership_error(exc)
    if any(item.get("status") == "enrolled" for item in submissions):
        _refresh_public_board(store)
    return create_response(201, {"submissions": submissions, "count": len(submissions)})


def handle_admin_list_identities(_event: dict[str, Any]) -> dict[str, Any]:
    identities = [_public_identity(item) for item in _get_store().list_identities()]
    return create_response(200, {"identities": identities, "count": len(identities)})


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


def _tournament_list_payload(store: Store) -> dict[str, Any]:
    tournaments = list_public_tournaments(store)
    return {
        "tournaments": tournaments,
        "count": len(tournaments),
        "featured_tournament_id": showcase_featured_id(store),
    }


def handle_list_tournaments(_event: dict[str, Any]) -> dict[str, Any]:
    return create_response(200, _tournament_list_payload(_get_store()))


def handle_get_tournament(event: dict[str, Any]) -> dict[str, Any]:
    tournament = _path_params(event).get("tournament_id", "").strip()
    if not tournament:
        return create_error_response(400, "tournament_id is required", "VALIDATION_ERROR")
    store = _get_store()
    _refresh_public_board(store)
    payload = get_public_tournament(store, tournament)
    if payload is None:
        return create_error_response(404, "tournament archive not found", "NOT_FOUND")
    return create_response(200, {"tournament": payload})


def handle_get_tournament_farm(event: dict[str, Any]) -> dict[str, Any]:
    params = _path_params(event)
    tournament = params.get("tournament_id", "").strip()
    farm_id = params.get("farm_id", "").strip()
    if not tournament or not farm_id:
        return create_error_response(
            400, "tournament_id and farm_id are required", "VALIDATION_ERROR"
        )
    entry = get_public_tournament_farm(_get_store(), tournament, farm_id)
    if entry is None:
        return create_error_response(404, "farm not found in that tournament", "NOT_FOUND")
    return create_response(200, {"farm": entry})


def _catalog_error(exc: CatalogError) -> dict[str, Any]:
    return create_error_response(exc.status, exc.message, exc.code)


def _membership_error(exc: MembershipError) -> dict[str, Any]:
    return create_error_response(exc.status, exc.message, exc.code, details=exc.details)


def handle_admin_list_tournaments(_event: dict[str, Any]) -> dict[str, Any]:
    return create_response(200, _tournament_list_payload(_get_store()))


def handle_admin_put_featured(event: dict[str, Any]) -> dict[str, Any]:
    body = _body(event)
    raw = body.get("tournament_id")
    if raw is None:
        raw = body.get("tournamentId")
    try:
        featured_id = set_featured_tournament(_get_store(), None if raw is None else str(raw))
    except CatalogError as exc:
        return _catalog_error(exc)
    return create_response(200, {"featured_tournament_id": featured_id})


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


def handle_get_tournament_media(event: dict[str, Any]) -> dict[str, Any]:
    tournament = unquote(_path_params(event).get("tournament_id", "").strip())
    filename = unquote(_path_params(event).get("filename", "").strip())
    if not tournament or not filename:
        return create_error_response(
            400, "tournament_id and filename are required", "VALIDATION_ERROR"
        )
    try:
        key = media_key_from_path(tournament, filename)
        payload, stored_type = _get_store().read_object(key)
    except MediaError as exc:
        return create_error_response(exc.status, exc.message, exc.code)
    except FileNotFoundError:
        return create_error_response(404, "media object not found", "NOT_FOUND")
    ext = filename.rsplit(".", 1)[-1].lower()
    content_type = stored_type or CONTENT_TYPE_BY_EXT.get(ext, "application/octet-stream")
    return create_binary_response(200, payload, content_type)


def handle_admin_put_tournament_image(event: dict[str, Any]) -> dict[str, Any]:
    tournament = _path_params(event).get("tournament_id", "").strip()
    if not tournament:
        return create_error_response(400, "tournament_id is required", "VALIDATION_ERROR")
    store = _get_store()
    if not store.get_tournament(tournament):
        return create_error_response(404, "tournament not found", "NOT_FOUND")
    try:
        payload = store_tournament_image(
            bucket=store.data_bucket,
            tournament_id=tournament,
            body=_body(event),
            api_base=public_api_base_from_event(event),
            s3_client=_get_store()._s3,
        )
    except MediaError as exc:
        return create_error_response(exc.status, exc.message, exc.code)
    return create_response(200, payload)


def handle_admin_put_config(event: dict[str, Any]) -> dict[str, Any]:
    body = _body(event)
    store = _get_store()
    seed_catalog(store)
    try:
        start, end, days = parse_window(body)
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
    store = _get_store()
    seed_catalog(store)
    farms = [player_list_row(store, farm) for farm in _get_registry().list_farms()]
    return create_response(200, {"farms": farms, "count": len(farms)})


def handle_admin_get_farm(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = _path_params(event).get("farm_id", "").strip()
    if not farm_id:
        return create_error_response(400, "farm_id is required", "VALIDATION_ERROR")
    store = _get_store()
    seed_catalog(store)
    tracked = _get_registry().get(farm_id)
    if not tracked:
        return create_error_response(404, "farm not found", "NOT_FOUND")
    farm = player_detail(store, tracked)
    return create_response(200, {"farm": farm})


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
    _refresh_public_board(store)
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
    _refresh_public_board()
    return create_response(200, {"farm": farm})


def handle_admin_delete_farm(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = _path_params(event).get("farm_id", "").strip()
    if not farm_id:
        return create_error_response(400, "farm_id is required", "VALIDATION_ERROR")
    try:
        saved = _get_registry().remove(farm_id)
    except KeyError:
        return create_error_response(404, "farm not found", "NOT_FOUND")
    store = _get_store()
    store.delete_score(farm_id)
    store.drop_farm_event_scores(farm_id)
    drop_farm_members(store, farm_id)
    _refresh_public_board(store)
    return create_response(200, {"farms": saved["farms"], "count": len(saved["farms"])})


def handle_admin_list_submissions(event: dict[str, Any]) -> dict[str, Any]:
    store = _get_store()
    submissions = []
    for item in store.list_members(status="pending"):
        row = public_member(item)
        event_row = store.get_tournament(row["tournament_id"]) or {}
        row["tournament_name"] = str(event_row.get("name") or "")
        row["tournament_status"] = event_row.get("status")
        submissions.append(row)
    submissions.sort(key=lambda item: item.get("submitted_at") or "", reverse=True)
    return create_response(200, {"submissions": submissions, "count": len(submissions)})


def handle_admin_approve_submission(event: dict[str, Any]) -> dict[str, Any]:
    params = _path_params(event)
    farm_id = params.get("farm_id", "").strip()
    tournament_id = (
        params.get("tournament_id", "").strip()
        or str(_body(event).get("tournament_id") or "").strip()
    )
    if not farm_id or not tournament_id:
        return create_error_response(
            400, "farm_id and tournament_id are required", "VALIDATION_ERROR"
        )
    store = _get_store()
    try:
        farm = approve_join(store, _get_registry(), farm_id=farm_id, tournament_id=tournament_id)
    except MembershipError as exc:
        return _membership_error(exc)
    _refresh_public_board(store)
    return create_response(200, {"farm": farm})


def handle_admin_reject_submission(event: dict[str, Any]) -> dict[str, Any]:
    params = _path_params(event)
    farm_id = params.get("farm_id", "").strip()
    tournament_id = (
        params.get("tournament_id", "").strip()
        or str(_body(event).get("tournament_id") or "").strip()
    )
    if not farm_id or not tournament_id:
        return create_error_response(
            400, "farm_id and tournament_id are required", "VALIDATION_ERROR"
        )
    try:
        reject_join(_get_store(), farm_id=farm_id, tournament_id=tournament_id)
    except MembershipError as exc:
        return _membership_error(exc)
    return create_response(200, {"ok": True})


def handle_admin_tournament_roster(event: dict[str, Any]) -> dict[str, Any]:
    tournament_id = _path_params(event).get("tournament_id", "").strip()
    if not tournament_id:
        return create_error_response(400, "tournament_id is required", "VALIDATION_ERROR")
    store = _get_store()
    if not store.get_tournament(tournament_id):
        return create_error_response(404, "tournament not found", "NOT_FOUND")
    members = roster_members(store, _get_registry(), tournament_id)
    return create_response(200, {"members": members, "count": len(members)})


def handle_admin_add_tournament_farms(event: dict[str, Any]) -> dict[str, Any]:
    tournament_id = _path_params(event).get("tournament_id", "").strip()
    if not tournament_id:
        return create_error_response(400, "tournament_id is required", "VALIDATION_ERROR")
    try:
        farm_ids = parse_farm_ids(_body(event))
        added = add_farms_to_tournament(
            _get_store(),
            _get_registry(),
            tournament_id=tournament_id,
            farm_ids=farm_ids,
        )
    except MembershipError as exc:
        return _membership_error(exc)
    _refresh_public_board()
    farms = [
        {"farm_id": item["farm_id"], "name": item.get("name") or "", "active": item.get("active")}
        for item in added
    ]
    return create_response(200, {"farms": farms, "count": len(farms)})


def handle_admin_remove_tournament_farm(event: dict[str, Any]) -> dict[str, Any]:
    params = _path_params(event)
    tournament_id = params.get("tournament_id", "").strip()
    farm_id = params.get("farm_id", "").strip()
    if not tournament_id or not farm_id:
        return create_error_response(
            400, "tournament_id and farm_id are required", "VALIDATION_ERROR"
        )
    store = _get_store()
    try:
        remove_farm_from_tournament(store, tournament_id=tournament_id, farm_id=farm_id)
    except MembershipError as exc:
        return _membership_error(exc)
    _refresh_public_board(store)
    return create_response(200, {"ok": True})


def handle_admin_refresh_farm(event: dict[str, Any]) -> dict[str, Any]:
    farm_id = _path_params(event).get("farm_id", "").strip()
    if not farm_id:
        return create_error_response(400, "farm_id is required", "VALIDATION_ERROR")
    if not _get_registry().get(farm_id):
        return create_error_response(404, "farm is not tracked", "NOT_FOUND")
    store = _get_store()
    live = [item for item in store.list_tournament_items() if item.get("status") == "active"]
    seeded_live = [item for item in live if item.get("roster_seeded")]
    if seeded_live and not farm_live_tournament_ids(store, farm_id):
        return create_error_response(404, "farm is not enrolled in a live event", "NOT_FOUND")
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
    _refresh_public_board(store)
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
    ("GET", re.compile(r"^/slogans$"), handle_get_slogans),
    ("GET", re.compile(r"^/leaderboard$"), handle_get_leaderboard),
    ("GET", re.compile(r"^/tournaments$"), handle_list_tournaments),
    (
        "GET",
        re.compile(r"^/media/avatars/(?P<farm_id>[^/]+)/(?P<filename>[^/]+)$"),
        handle_get_avatar_media,
    ),
    (
        "GET",
        re.compile(r"^/media/tournaments/(?P<tournament_id>[^/]+)/(?P<filename>[^/]+)$"),
        handle_get_tournament_media,
    ),
    (
        "GET",
        re.compile(r"^/tournaments/(?P<tournament_id>[^/]+)/farms/(?P<farm_id>[^/]+)$"),
        handle_get_tournament_farm,
    ),
    ("GET", re.compile(r"^/tournaments/(?P<tournament_id>[^/]+)$"), handle_get_tournament),
    (
        "GET",
        re.compile(r"^/farms/(?P<farm_id>[^/]+)/memberships$"),
        handle_get_farm_memberships,
    ),
    (
        "GET",
        re.compile(r"^/farms/(?P<farm_id>[^/]+)/profile$"),
        handle_get_farm_profile,
    ),
    (
        "PUT",
        re.compile(r"^/farms/(?P<farm_id>[^/]+)/avatar$"),
        handle_put_farm_avatar,
    ),
    ("GET", re.compile(r"^/farms/(?P<farm_id>[^/]+)$"), handle_get_farm),
    ("POST", re.compile(r"^/identify$"), handle_identify_farm),
    ("POST", re.compile(r"^/submissions$"), handle_submit_farm),
    ("GET", re.compile(r"^/admin/session$"), handle_admin_session),
    ("GET", re.compile(r"^/admin/identities$"), handle_admin_list_identities),
    ("GET", re.compile(r"^/admin/config$"), handle_admin_get_config),
    ("PUT", re.compile(r"^/admin/config$"), handle_admin_put_config),
    ("GET", re.compile(r"^/admin/slogans$"), handle_admin_get_slogans),
    ("POST", re.compile(r"^/admin/slogans$"), handle_admin_post_slogans),
    ("PUT", re.compile(r"^/admin/slogans$"), handle_admin_put_slogans),
    ("GET", re.compile(r"^/admin/tournaments$"), handle_admin_list_tournaments),
    ("POST", re.compile(r"^/admin/tournaments$"), handle_admin_create_tournament),
    ("PUT", re.compile(r"^/admin/featured$"), handle_admin_put_featured),
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
    (
        "POST",
        re.compile(r"^/admin/tournaments/(?P<tournament_id>[^/]+)/images$"),
        handle_admin_put_tournament_image,
    ),
    ("GET", re.compile(r"^/admin/farms$"), handle_admin_list_farms),
    ("POST", re.compile(r"^/admin/farms$"), handle_admin_add_farm),
    ("GET", re.compile(r"^/admin/farms/(?P<farm_id>[^/]+)$"), handle_admin_get_farm),
    ("PUT", re.compile(r"^/admin/farms/(?P<farm_id>[^/]+)$"), handle_admin_update_farm),
    ("DELETE", re.compile(r"^/admin/farms/(?P<farm_id>[^/]+)$"), handle_admin_delete_farm),
    (
        "GET",
        re.compile(r"^/admin/tournaments/(?P<tournament_id>[^/]+)/roster$"),
        handle_admin_tournament_roster,
    ),
    (
        "POST",
        re.compile(r"^/admin/tournaments/(?P<tournament_id>[^/]+)/farms$"),
        handle_admin_add_tournament_farms,
    ),
    (
        "DELETE",
        re.compile(r"^/admin/tournaments/(?P<tournament_id>[^/]+)/farms/(?P<farm_id>[^/]+)$"),
        handle_admin_remove_tournament_farm,
    ),
    ("GET", re.compile(r"^/admin/submissions$"), handle_admin_list_submissions),
    (
        "POST",
        re.compile(r"^/admin/submissions/(?P<farm_id>[^/]+)/(?P<tournament_id>[^/]+)/approve$"),
        handle_admin_approve_submission,
    ),
    (
        "DELETE",
        re.compile(r"^/admin/submissions/(?P<farm_id>[^/]+)/(?P<tournament_id>[^/]+)$"),
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
