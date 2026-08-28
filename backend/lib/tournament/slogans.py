"""Ordered public header slogans. Picking by UTC day happens in the browser."""

from __future__ import annotations

from typing import Any

from tournament.store import Store

TEXT_MAX = 80
ICON_MAX = 32

SEED_SLOGANS: list[dict[str, str]] = [
    {"text": "Slap my pets", "icon": "hand"},
    {"text": "Grow my banana", "icon": "banana"},
    {"text": "Squeeze my orange", "icon": "orange"},
    {"text": "Clean my poop", "icon": "poop"},
    {"text": "Want some weed?", "icon": "smiley"},
    {"text": "Erect my monument", "icon": "statue"},
]


class SloganError(Exception):
    def __init__(self, message: str, code: str = "VALIDATION_ERROR", status: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def public_slogans(rows: list[dict[str, str]]) -> dict[str, Any]:
    return {"slogans": rows, "count": len(rows)}


def normalize_slogan(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        raise SloganError("slogan must be an object")
    text = str(raw.get("text") or "").strip()
    icon = str(raw.get("icon") or "").strip()
    if not text:
        raise SloganError("text is required")
    if len(text) > TEXT_MAX:
        raise SloganError(f"text must be {TEXT_MAX} characters or fewer")
    if len(icon) > ICON_MAX:
        raise SloganError(f"icon must be {ICON_MAX} characters or fewer")
    return {"text": text, "icon": icon}


def list_slogans(store: Store) -> list[dict[str, str]]:
    item = store.get_slogans()
    raw = item.get("slogans") if isinstance(item, dict) else None
    if not isinstance(raw, list) or not raw:
        return [dict(row) for row in SEED_SLOGANS]
    rows: list[dict[str, str]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        text = str(entry.get("text") or "").strip()
        if not text:
            continue
        rows.append({"text": text, "icon": str(entry.get("icon") or "").strip()})
    return rows or [dict(row) for row in SEED_SLOGANS]


def replace_slogans(store: Store, raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        raise SloganError("slogans must be a list")
    rows = [normalize_slogan(item) for item in raw]
    if not rows:
        raise SloganError("slogans must not be empty")
    store.put_slogans(rows)
    return rows


def add_slogan(store: Store, raw: Any) -> tuple[dict[str, str], list[dict[str, str]]]:
    slogan = normalize_slogan(raw)
    rows = list_slogans(store)
    rows.append(slogan)
    store.put_slogans(rows)
    return slogan, rows
