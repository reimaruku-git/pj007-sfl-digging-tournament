import { useState } from "react";
import type { LeaderboardEntry, PrizePlace } from "../api/public";
import { downloadTournamentBoardImage } from "../lib/boardImage";

export function DownloadBoardButton({
  name,
  startAt,
  endAt,
  durationDays,
  prizeAmount,
  prizePlaces,
  entries,
  totalCount,
  connectedFarmId,
  enrolledCount,
  maxPlayers,
  minBumpkinIsland,
  minDiggingStreak,
  vipRequired,
  joinMode,
  testId = "download-board",
}: {
  name: string;
  startAt: string | null;
  endAt: string | null;
  durationDays?: number | null;
  prizeAmount?: string | null;
  prizePlaces?: PrizePlace[] | null;
  entries: LeaderboardEntry[];
  totalCount?: number;
  connectedFarmId?: string | null;
  enrolledCount?: number | null;
  maxPlayers?: number | null;
  minBumpkinIsland?: string | null;
  minDiggingStreak?: number | null;
  vipRequired?: boolean | null;
  joinMode?: string | null;
  testId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = entries.length === 0;

  async function onDownload() {
    setError(null);
    setBusy(true);
    try {
      await downloadTournamentBoardImage({
        name,
        start_at: startAt,
        end_at: endAt,
        duration_days: durationDays,
        prize_amount: prizeAmount,
        prize_places: prizePlaces,
        entries,
        total_count: totalCount,
        connected_farm_id: connectedFarmId,
        enrolled_count: enrolledCount,
        max_players: maxPlayers,
        min_bumpkin_island: minBumpkinIsland,
        min_digging_streak: minDiggingStreak,
        vip_required: vipRequired,
        join_mode: joinMode,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download image");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="board-download-wrap">
      <button
        type="button"
        className="btn ghost board-download"
        data-testid={testId}
        aria-label={busy ? "Saving image" : "Download image"}
        title="Download image"
        disabled={busy || empty}
        onClick={() => {
          void onDownload();
        }}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
          <path
            d="M8 2.5v8.2M4.4 7.8 8 11.4l3.6-3.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {error ? (
        <span className="board-download-error" data-testid={`${testId}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
