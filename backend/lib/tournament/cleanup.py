"""Drop leftover live-cache Dynamo rows after an event is archived to S3.

Only ``SCORE#{tournament_id}#…`` and ``LEADERBOARD#{tournament_id}``
are eligible. Catalog, membership, featured CONFIG, shared S3 grids,
and any scheduled/active event stay.
"""

from __future__ import annotations

from typing import Any

from tournament.store import Store

STATUS_ENDED = "ended"


def archive_has_complete_standings(store: Store, tournament_id: str) -> bool:
    """True when S3 has a standings list (empty roster is still complete)."""
    tid = str(tournament_id or "").strip()
    if not tid:
        return False
    archive = store.read_archive(tid)
    return bool(archive) and archive.get("entries") is not None


def can_purge_event_live_cache(store: Store, tournament_id: str) -> bool:
    """Ended + complete S3 standings. Anything else is a hard no."""
    tid = str(tournament_id or "").strip()
    if not tid:
        return False
    row = store.get_tournament(tid)
    if not row or row.get("status") != STATUS_ENDED:
        return False
    return archive_has_complete_standings(store, tid)


def purge_archived_event_live_cache(store: Store, tournament_id: str) -> dict[str, Any]:
    """Delete that event's live score/board cache, or do nothing."""
    tid = str(tournament_id or "").strip()
    if not can_purge_event_live_cache(store, tid):
        return {"purged": False, "scores": 0}
    dropped = store.drop_event_scores(tid)
    store.delete_event_leaderboard(tid)
    return {"purged": True, "scores": dropped}
