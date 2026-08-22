import { Link } from "react-router-dom";
import type { LeaderboardEntry } from "../api/public";
import { ColorCanvas, type CanvasTone } from "./ColorCanvas";
import { Pebbles } from "./Pebbles";

function farmPath(farmId: string, tournamentId?: string) {
  if (tournamentId) {
    return `/tournaments/${encodeURIComponent(tournamentId)}/farm/${farmId}`;
  }
  return `/farm/${farmId}`;
}

const PLACE_TONE: Record<1 | 2 | 3, CanvasTone> = {
  1: "podium-1",
  2: "podium-2",
  3: "podium-3",
};

function Slot({
  entry,
  place,
  tournamentId,
}: {
  entry?: LeaderboardEntry;
  place: 1 | 2 | 3;
  tournamentId?: string;
}) {
  if (!entry) {
    return (
      <div className={`podium-card place-${place} empty`}>
        <div className="podium-art">
          <ColorCanvas tone={PLACE_TONE[place]} />
          <span className="podium-place">{place}</span>
        </div>
        <p className="muted">Open</p>
      </div>
    );
  }
  return (
    <Link to={farmPath(entry.farm_id, tournamentId)} className={`podium-card place-${place}`}>
      <div className="podium-art">
        <ColorCanvas tone={PLACE_TONE[place]} />
        <span className="podium-place">{place}</span>
      </div>
      <div className="podium-meta">
        <div className="podium-name">{entry.name || "Unnamed farm"}</div>
        <div className="podium-score">
          {entry.digs_to_third_op ?? "—"}
          <span>Digs</span>
        </div>
        <Pebbles count={entry.otter_count} />
      </div>
    </Link>
  );
}

export function Podium({
  entries,
  tournamentId,
}: {
  entries: LeaderboardEntry[];
  tournamentId?: string;
}) {
  const first = entries.find((row) => row.rank === 1);
  const second = entries.find((row) => row.rank === 2);
  const third = entries.find((row) => row.rank === 3);
  if (!first && !second && !third) return null;
  return (
    <section className="podium" aria-label="Top three" data-testid="tournament-podium">
      <Slot entry={second} place={2} tournamentId={tournamentId} />
      <Slot entry={first} place={1} tournamentId={tournamentId} />
      <Slot entry={third} place={3} tournamentId={tournamentId} />
    </section>
  );
}
