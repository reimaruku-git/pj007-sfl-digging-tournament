import { useState } from "react";
import type { LeaderboardEntry } from "../api/public";
import { downloadTournamentBoardImage } from "../lib/boardImage";

export function DownloadBoardButton({
  name,
  startAt,
  endAt,
  durationDays,
  prizeAmount,
  entries,
  totalCount,
  testId = "download-board",
}: {
  name: string;
  startAt: string | null;
  endAt: string | null;
  durationDays?: number | null;
  prizeAmount?: string | null;
  entries: LeaderboardEntry[];
  totalCount?: number;
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
        entries,
        total_count: totalCount,
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
        disabled={busy || empty}
        onClick={() => {
          void onDownload();
        }}
      >
        {busy ? "Saving…" : "Download image"}
      </button>
      {error ? (
        <span className="board-download-error" data-testid={`${testId}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
