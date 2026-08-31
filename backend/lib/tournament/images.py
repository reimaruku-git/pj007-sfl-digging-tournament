"""Tournament image uploads on S3 and public CDN URLs."""

from __future__ import annotations

import re
from typing import Any

SLOTS = frozenset({"image_1", "image_2"})
IMAGE_URL_FIELDS = ("image_1_url", "image_2_url")
ALLOWED_CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}
PRESIGN_EXPIRES_SECONDS = 900


class MediaError(Exception):
    def __init__(self, message: str, *, code: str = "VALIDATION_ERROR", status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def media_object_key(tournament_id: str, slot: str, ext: str) -> str:
    tid = str(tournament_id or "").strip()
    if not tid or "/" in tid or ".." in tid:
        raise MediaError("invalid tournament id")
    if slot not in SLOTS:
        raise MediaError("slot must be image_1 or image_2")
    safe_ext = str(ext or "").strip().lower()
    if safe_ext not in set(ALLOWED_CONTENT_TYPES.values()):
        raise MediaError("unsupported image type")
    return f"media/tournaments/{tid}/{slot}.{safe_ext}"


def public_media_url(api_base: str, key: str) -> str:
    base = str(api_base or "").strip().rstrip("/")
    if not base:
        raise MediaError("public API base is not configured", code="CONFIG_ERROR", status=500)
    return f"{base}/{str(key).lstrip('/')}"


def _normalize_url(raw: Any) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def parse_media_fields(body: dict[str, Any]) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    for field in IMAGE_URL_FIELDS:
        if field not in body:
            continue
        out[field] = _normalize_url(body.get(field))
    return out


def merge_media_fields(
    row: dict[str, Any],
    body: dict[str, Any],
    *,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    parsed = parse_media_fields(body)
    if parsed:
        row.update(parsed)
        return row
    if existing:
        for field in IMAGE_URL_FIELDS:
            if field in existing and field not in body:
                row[field] = existing.get(field)
    return row


def public_media_fields(row: dict[str, Any] | None) -> dict[str, str]:
    payload: dict[str, str] = {}
    if not row:
        return payload
    for field in IMAGE_URL_FIELDS:
        url = _normalize_url(row.get(field))
        if url:
            payload[field] = url
    return payload


def presign_tournament_image(
    *,
    bucket: str,
    tournament_id: str,
    body: dict[str, Any],
    api_base: str,
    s3_client,
) -> dict[str, Any]:
    slot = str(body.get("slot") or "").strip()
    content_type = str(body.get("content_type") or "").strip().lower()
    if slot not in SLOTS:
        raise MediaError("slot must be image_1 or image_2")
    ext = ALLOWED_CONTENT_TYPES.get(content_type)
    if not ext:
        raise MediaError("content_type must be image/jpeg, image/png, image/webp, or image/gif")
    key = media_object_key(tournament_id, slot, ext)
    upload_url = s3_client.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=PRESIGN_EXPIRES_SECONDS,
    )
    public_url = public_media_url(api_base, key)
    return {
        "slot": slot,
        "key": key,
        "upload_url": upload_url,
        "public_url": public_url,
        "expires_in": PRESIGN_EXPIRES_SECONDS,
    }


def media_prefix_for_tournament(tournament_id: str) -> str:
    tid = str(tournament_id or "").strip()
    return f"media/tournaments/{tid}/"


_MEDIA_KEY_RE = re.compile(r"^media/tournaments/[^/]+/(image_1|image_2)\.(jpg|png|webp|gif)$")


def is_managed_media_key(key: str) -> bool:
    return bool(_MEDIA_KEY_RE.match(str(key or "").strip()))


def media_key_from_path(tournament_id: str, filename: str) -> str:
    tid = str(tournament_id or "").strip()
    name = str(filename or "").strip()
    key = f"media/tournaments/{tid}/{name}"
    if not is_managed_media_key(key):
        raise MediaError("media object not found", code="NOT_FOUND", status=404)
    return key


CONTENT_TYPE_BY_EXT = {ext: f"image/{ext if ext != 'jpg' else 'jpeg'}" for ext in ALLOWED_CONTENT_TYPES.values()}
