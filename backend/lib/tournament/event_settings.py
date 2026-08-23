"""Optional per-event join and prize settings.

Omitted fields keep today's behavior: no island/streak/VIP gates, no
player cap, must-confirm (pending) joins, empty description, no
per-place prizes, no NFT giveaway.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

JOIN_MODE_AUTO = "auto"
JOIN_MODE_CONFIRM = "confirm"
JOIN_MODES = {JOIN_MODE_AUTO, JOIN_MODE_CONFIRM}
DEFAULT_JOIN_MODE = JOIN_MODE_CONFIRM
DESCRIPTION_MAX_LEN = 2000
NFT_NAME_MAX_LEN = 80
ISLAND_BASIC = "basic"
ISLAND_SPRING = "spring"
ISLAND_DESERT = "desert"
ISLAND_VOLCANO_PLUS = "volcano+"
MIN_ISLANDS = (ISLAND_BASIC, ISLAND_SPRING, ISLAND_DESERT, ISLAND_VOLCANO_PLUS)
ISLAND_RANK = {
    "basic": 0,
    "spring": 1,
    "desert": 2,
    "volcano": 3,
    "volcano+": 3,
}


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


def _optional_bool(raw: Any, field: str) -> bool:
    if raw is None or raw == "":
        return False
    if isinstance(raw, bool):
        return raw
    if raw in (0, 1):
        return bool(raw)
    text = str(raw).strip().lower()
    if text in {"true", "yes", "1"}:
        return True
    if text in {"false", "no", "0"}:
        return False
    raise EventSettingsError(f"{field} must be true or false")


def island_rank(value: Any) -> int | None:
    key = str(value or "").strip().lower()
    if not key:
        return None
    if key in ISLAND_RANK:
        return ISLAND_RANK[key]
    return ISLAND_RANK[ISLAND_VOLCANO_PLUS]


def island_meets_minimum(farm_island: Any, minimum: Any) -> bool:
    if minimum in (None, ""):
        return True
    farm_rank = island_rank(farm_island)
    min_rank = island_rank(minimum)
    if farm_rank is None or min_rank is None:
        return False
    return farm_rank >= min_rank


def parse_min_island(raw: Any) -> str | None:
    if raw is None or raw == "":
        return None
    token = str(raw).strip().lower()
    if token not in MIN_ISLANDS:
        raise EventSettingsError("min_bumpkin_island must be basic, spring, desert, or volcano+")
    return token


def _flower_amount(raw: Any, *, field: str) -> Decimal:
    text = str(raw if raw is not None else "").strip()
    if not text:
        raise EventSettingsError(f"{field} is required")
    try:
        value = Decimal(text)
    except InvalidOperation as exc:
        raise EventSettingsError(f"{field} must be a number") from exc
    if value < 0:
        raise EventSettingsError(f"{field} must not be negative")
    return value


def prize_places_sum(places: list[dict[str, Any]]) -> Decimal:
    total = Decimal("0")
    for item in places:
        total += _flower_amount(item.get("amount"), field="prize_places.amount")
    return total


def parse_prize_places(raw: Any, *, nft_giveaway: bool = False) -> list[dict[str, Any]]:
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
        nft_name = str(item.get("nft_name") or "").strip()
        if len(nft_name) > NFT_NAME_MAX_LEN:
            raise EventSettingsError(
                f"prize_places.nft_name must be at most {NFT_NAME_MAX_LEN} characters"
            )
        if nft_giveaway:
            if not amount and not nft_name:
                raise EventSettingsError("prize_places need a Flower amount or NFT name")
            if not amount:
                amount = "0"
        elif not amount:
            raise EventSettingsError("prize_places.amount is required")
        _flower_amount(amount, field="prize_places.amount")
        seen.add(place)
        row = {"place": place, "amount": amount}
        if nft_giveaway:
            row["nft_name"] = nft_name
        places.append(row)
    places.sort(key=lambda row: int(row["place"]))
    return places


def _keep_or_parse(body: dict[str, Any], src: dict[str, Any], key: str, parse):
    if key in body:
        return parse(body.get(key))
    stored = src.get(key)
    return parse(stored) if stored not in (None, "") else parse(None)


def parse_event_settings(
    body: dict[str, Any], *, existing: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Validate create/update extras. Missing keys keep ``existing`` (or defaults)."""
    src = existing or {}

    min_island = _keep_or_parse(body, src, "min_bumpkin_island", parse_min_island)
    min_streak = _keep_or_parse(
        body,
        src,
        "min_digging_streak",
        lambda raw: _optional_positive_int(raw, "min_digging_streak"),
    )
    max_players = _keep_or_parse(
        body, src, "max_players", lambda raw: _optional_positive_int(raw, "max_players")
    )

    if "vip_required" in body:
        vip_required = _optional_bool(body.get("vip_required"), "vip_required")
    else:
        vip_required = _optional_bool(src.get("vip_required"), "vip_required")

    if "nft_giveaway" in body:
        nft_giveaway = _optional_bool(body.get("nft_giveaway"), "nft_giveaway")
    else:
        nft_giveaway = _optional_bool(src.get("nft_giveaway"), "nft_giveaway")

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
        prize_places = parse_prize_places(body.get("prize_places"), nft_giveaway=nft_giveaway)
    else:
        prize_places = parse_prize_places(src.get("prize_places") or [], nft_giveaway=nft_giveaway)

    if "prize_amount" in body or "prizeAmount" in body:
        prize = str(body.get("prize_amount") or body.get("prizeAmount") or "").strip()
    else:
        prize = str(src.get("prize_amount") or "").strip()
    writing_prizes = any(
        key in body for key in ("prize_places", "prize_amount", "prizeAmount", "nft_giveaway")
    )
    if writing_prizes and prize_places and not nft_giveaway:
        pool = _flower_amount(prize or "0", field="prize_amount")
        if prize_places_sum(prize_places) != pool:
            raise EventSettingsError("prize_places amounts must sum to prize_amount")

    return {
        "min_bumpkin_island": min_island,
        "min_digging_streak": min_streak,
        "vip_required": vip_required,
        "max_players": max_players,
        "join_mode": mode,
        "description": description,
        "prize_places": prize_places,
        "nft_giveaway": nft_giveaway,
    }


def public_event_settings(row: dict[str, Any] | None) -> dict[str, Any]:
    """Wire-shape extras with defaults for old rows that lack the keys."""
    try:
        return parse_event_settings({}, existing=row or {})
    except EventSettingsError:
        return parse_event_settings({})
