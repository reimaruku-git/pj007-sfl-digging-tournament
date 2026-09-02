"""Player profile pictures: frontend NPC presets and S3 uploads."""

from __future__ import annotations

import base64
import hashlib
import re
from typing import Any, Iterable

from tournament.farms import FARM_ID_RE
from tournament.images import (
    ALLOWED_CONTENT_TYPES,
    MAX_IMAGE_BYTES,
    MediaError,
    public_media_url,
)

PRESET_IDS = frozenset(
    {
        "jafar",
        "betty",
        "blacksmith",
        "corale",
        "tango",
        "old_salty",
        "victoria",
        "jester",
        "tywin",
        "timmy",
        "pumpkin_pete",
        "bert",
        "finley",
        "pharaoh",
        "cornwell",
        "miranda",
        "raven",
        "finn",
        "gambit",
        "gordo",
        "grimbly",
        "grimtooth",
        "grubnuk",
        "guria",
        "hammerin_harry",
        "mayor",
    }
)
AVATAR_KINDS = frozenset({"preset", "upload", "none"})
_AVATAR_KEY_RE = re.compile(r"^media/avatars/[0-9]{1,32}/avatar\.(jpg|png|webp|gif)$")


def avatar_object_key(farm_id: str, ext: str) -> str:
    fid = str(farm_id or "").strip()
    if not FARM_ID_RE.fullmatch(fid):
        raise MediaError("farm_id must be a numeric id")
    safe_ext = str(ext or "").strip().lower()
    if safe_ext not in set(ALLOWED_CONTENT_TYPES.values()):
        raise MediaError("unsupported image type")
    return f"media/avatars/{fid}/avatar.{safe_ext}"


def is_managed_avatar_key(key: str) -> bool:
    return bool(_AVATAR_KEY_RE.match(str(key or "").strip()))


def avatar_key_from_path(farm_id: str, filename: str) -> str:
    fid = str(farm_id or "").strip()
    name = str(filename or "").strip()
    key = f"media/avatars/{fid}/{name}"
    if not is_managed_avatar_key(key):
        raise MediaError("media object not found", code="NOT_FOUND", status=404)
    return key


def public_avatar(row: dict[str, Any] | None) -> dict[str, str]:
    if not row:
        return {}
    kind = str(row.get("avatar_kind") or "").strip()
    if kind == "preset":
        preset = str(row.get("avatar_preset") or "").strip()
        if preset in PRESET_IDS:
            return {"avatar_kind": "preset", "avatar_preset": preset}
        return {}
    if kind == "upload":
        url = str(row.get("avatar_url") or "").strip()
        if url:
            return {"avatar_kind": "upload", "avatar_url": url}
    return {}


def public_profile(row: dict[str, Any] | None) -> dict[str, Any]:
    payload = {
        "farm_id": str((row or {}).get("farm_id") or ""),
        "name": str((row or {}).get("name") or ""),
        "nft_id": (row or {}).get("nft_id"),
        "identified_at": (row or {}).get("identified_at"),
    }
    payload.update(public_avatar(row))
    return payload


def attach_avatars(store, entries: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = [dict(entry) for entry in (entries or [])]
    mapping = store.identities_for_farms(str(entry.get("farm_id") or "") for entry in rows)
    attached: list[dict[str, Any]] = []
    for entry in rows:
        for field in ("avatar_kind", "avatar_preset", "avatar_url"):
            entry.pop(field, None)
        entry.update(public_avatar(mapping.get(str(entry.get("farm_id") or ""))))
        attached.append(entry)
    return attached


def store_avatar_image(
    *,
    bucket: str,
    farm_id: str,
    body: dict[str, Any],
    api_base: str,
    s3_client,
) -> dict[str, Any]:
    content_type = str(body.get("content_type") or "").strip().lower()
    ext = ALLOWED_CONTENT_TYPES.get(content_type)
    if not ext:
        raise MediaError("content_type must be image/jpeg, image/png, image/webp, or image/gif")
    raw = str(body.get("data") or "").strip()
    if not raw:
        raise MediaError("data is required")
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        payload = base64.b64decode(raw)
    except Exception as exc:
        raise MediaError("data must be base64 image bytes") from exc
    if not payload:
        raise MediaError("data is required")
    if len(payload) > MAX_IMAGE_BYTES:
        raise MediaError("image must be 2 MB or smaller")
    key = avatar_object_key(farm_id, ext)
    s3_client.put_object(Bucket=bucket, Key=key, Body=payload, ContentType=content_type)
    version = hashlib.sha256(payload).hexdigest()[:12]
    return {
        "key": key,
        "public_url": public_media_url(api_base, key, version=version),
    }


def apply_avatar_update(
    store,
    *,
    farm_id: str,
    body: dict[str, Any],
    api_base: str,
    s3_client,
) -> dict[str, Any]:
    identity = store.get_identity(farm_id)
    if not identity:
        raise MediaError("identify this farm first", code="NOT_FOUND", status=404)
    kind = str(body.get("kind") or "").strip()
    if kind not in AVATAR_KINDS:
        raise MediaError("kind must be preset, upload, or none")
    if kind == "none":
        return public_profile(store.put_identity_avatar(farm_id, kind=None))
    if kind == "preset":
        preset = str(body.get("preset_id") or body.get("avatar_preset") or "").strip()
        if preset not in PRESET_IDS:
            raise MediaError("unknown avatar preset")
        return public_profile(store.put_identity_avatar(farm_id, kind="preset", preset=preset))
    stored = store_avatar_image(
        bucket=store.data_bucket,
        farm_id=farm_id,
        body=body,
        api_base=api_base,
        s3_client=s3_client,
    )
    return public_profile(
        store.put_identity_avatar(farm_id, kind="upload", url=stored["public_url"])
    )
