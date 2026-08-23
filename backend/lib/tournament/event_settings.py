"""Optional per-event join and prize settings.

Omitted fields keep today's behavior: no min level, no player cap,
must-confirm (pending) joins, empty description, no per-place prizes.
"""

from __future__ import annotations

from typing import Any

JOIN_MODE_AUTO = "auto"
JOIN_MODE_CONFIRM = "confirm"
JOIN_MODES = {JOIN_MODE_AUTO, JOIN_MODE_CONFIRM}
DEFAULT_JOIN_MODE = JOIN_MODE_CONFIRM
DESCRIPTION_MAX_LEN = 2000


class EventSettingsError(Exception):
    def __init__(self, message: str, code: str = "VALIDATION_ERROR", status: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def _optional_positive_int(raw: Any, field: str) -> int | None:
    if raw is None or raw == "":
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise EventSettingsError(f"{field} must be an integer") from exc
    if value < 1:
        raise EventSettingsError(f"{field} must be at least 1")
    return value


def parse_prize_places(raw: Any) -> list[dict[str, Any]]:
    if raw is None or raw == "":
        return []
    if not isinstance(raw, list):
        raise EventSettingsError("prize_places must be a list")
    places: list[dict[str, Any]] = []
    seen: set[int] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise EventSettingsError("prize_places items must be objects")
        try:
            place = int(item.get("place"))
        except (TypeError, ValueError) as exc:
            raise EventSettingsError("prize_places.place must be an integer") from exc
        if place < 1:
            raise EventSettingsError("prize_places.place must be at least 1")
        if place in seen:
            raise EventSettingsError("prize_places.place values must be unique")
        amount = str(item.get("amount") if item.get("amount") is not None else "").strip()
        if not amount:
            raise EventSettingsError("prize_places.amount is required")
        seen.add(place)
        places.append({"place": place, "amount": amount})
    places.sort(key=lambda row: int(row["place"]))
    return places


def parse_event_settings(
    body: dict[str, Any], *, existing: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Validate create/update extras. Missing keys keep ``existing`` (or defaults)."""
    src = existing or {}

    if "min_bumpkin_level" in body:
        min_level = _optional_positive_int(body.get("min_bumpkin_level"), "min_bumpkin_level")
    else:
        stored = src.get("min_bumpkin_level")
        min_level = (
            _optional_positive_int(stored, "min_bumpkin_level")
            if stored not in (None, "")
            else None
        )

    if "max_players" in body:
        max_players = _optional_positive_int(body.get("max_players"), "max_players")
    else:
        stored = src.get("max_players")
        max_players = (
            _optional_positive_int(stored, "max_players") if stored not in (None, "") else None
        )

    if "join_mode" in body:
        mode = str(body.get("join_mode") or "").strip().lower() or DEFAULT_JOIN_MODE
        if mode not in JOIN_MODES:
            raise EventSettingsError("join_mode must be auto or confirm")
    else:
        mode = str(src.get("join_mode") or DEFAULT_JOIN_MODE).strip().lower()
        if mode not in JOIN_MODES:
            mode = DEFAULT_JOIN_MODE

    if "description" in body:
        description = str(body.get("description") or "")
    else:
        description = str(src.get("description") or "")
    if len(description) > DESCRIPTION_MAX_LEN:
        raise EventSettingsError(f"description must be at most {DESCRIPTION_MAX_LEN} characters")

    if "prize_places" in body:
        prize_places = parse_prize_places(body.get("prize_places"))
    else:
        prize_places = parse_prize_places(src.get("prize_places") or [])

    return {
        "min_bumpkin_level": min_level,
        "max_players": max_players,
        "join_mode": mode,
        "description": description,
        "prize_places": prize_places,
    }


def public_event_settings(row: dict[str, Any] | None) -> dict[str, Any]:
    """Wire-shape extras with defaults for old rows that lack the keys."""
    try:
        return parse_event_settings({}, existing=row or {})
    except EventSettingsError:
        return parse_event_settings({})
