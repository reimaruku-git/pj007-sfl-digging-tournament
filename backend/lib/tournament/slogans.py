"""Ordered public header slogans. Picking by UTC day happens in the browser."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from tournament.store import Store

TEXT_MAX = 80

SEED_SLOGANS: list[dict[str, str]] = [
    {"text": "Slap my pets"},
    {"text": "Grow my banana"},
    {"text": "Squeeze my orange"},
    {"text": "Clean my poop"},
    {"text": "Want some weed?"},
    {"text": "Erect my monument"},
]


class SloganError(Exception):
    def __init__(self, message: str, code: str = "VALIDATION_ERROR", status: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def utc_day_key(now: datetime | None = None) -> str:
    clock = now or datetime.now(timezone.utc)
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=timezone.utc)
    return clock.astimezone(timezone.utc).strftime("%Y-%m-%d")


def public_slogans(
    rows: list[dict[str, str]],
    *,
    today_text: str | None = None,
    today_day: str | None = None,
) -> dict[str, Any]:
    return {
        "slogans": rows,
        "count": len(rows),
        "today_text": today_text or None,
        "today_day": today_day or None,
    }


def normalize_slogan(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        raise SloganError("slogan must be an object")
    text = str(raw.get("text") or "").strip()
    if not text:
        raise SloganError("text is required")
    if len(text) > TEXT_MAX:
        raise SloganError(f"text must be {TEXT_MAX} characters or fewer")
    return {"text": text}


def _rows_from_item(item: dict[str, Any]) -> list[dict[str, str]] | None:
    raw = item.get("slogans")
    if not isinstance(raw, list):
        return None
    rows: list[dict[str, str]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        text = str(entry.get("text") or "").strip()
        if not text:
            continue
        rows.append({"text": text})
    return rows


def list_slogans(store: Store) -> list[dict[str, str]]:
    item = store.get_slogans()
    if not item.get("updated_at"):
        return [dict(row) for row in SEED_SLOGANS]
    rows = _rows_from_item(item)
    return rows if rows is not None else [dict(row) for row in SEED_SLOGANS]


def _today_fields(
    item: dict[str, Any], rows: list[dict[str, str]]
) -> tuple[str | None, str | None]:
    text = str(item.get("today_text") or "").strip() or None
    day = str(item.get("today_day") or "").strip() or None
    if text and not any(row["text"] == text for row in rows):
        return None, None
    if text and not day:
        return None, None
    return text, day


def slogans_document(store: Store) -> dict[str, Any]:
    item = store.get_slogans()
    rows = list_slogans(store)
    today_text, today_day = _today_fields(item, rows)
    return public_slogans(rows, today_text=today_text, today_day=today_day)


def replace_slogans(store: Store, body: dict[str, Any]) -> dict[str, Any]:
    raw = body.get("slogans")
    if not isinstance(raw, list):
        raise SloganError("slogans must be a list")
    rows = [normalize_slogan(item) for item in raw]
    existing = store.get_slogans()
    if "today_text" in body:
        text = str(body.get("today_text") or "").strip() or None
        if text and not any(row["text"] == text for row in rows):
            raise SloganError("today_text must match a slogan")
        day = utc_day_key() if text else None
    else:
        text, day = _today_fields(existing, rows)
    store.put_slogans(rows, today_text=text, today_day=day)
    return public_slogans(rows, today_text=text, today_day=day)


def add_slogan(store: Store, raw: Any) -> tuple[dict[str, str], dict[str, Any]]:
    slogan = normalize_slogan(raw)
    rows = list_slogans(store)
    rows.append(slogan)
    existing = store.get_slogans()
    today_text, today_day = _today_fields(existing, rows)
    store.put_slogans(rows, today_text=today_text, today_day=today_day)
    payload = public_slogans(rows, today_text=today_text, today_day=today_day)
    return slogan, payload
