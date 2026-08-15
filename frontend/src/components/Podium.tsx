import { Link } from "react-router-dom";
import type { LeaderboardEntry } from "../api/public";
import { formatScore } from "../lib/format";
import { Pebbles } from "./Pebbles";

function Slot({ entry, place }: { entry?: LeaderboardEntry; place: 1 | 2 | 3 }) {
  if (!entry) {
    return (
      <div className={`podium-slot place-${place} empty`}>
        <div className="podium-medal">{place}</div>
        <p className="muted">Open</p>
      </div>
    );
  }
  return (
    <Link to={`/farm/${entry.farm_id}`} className={`podium-slot place-${place}`}>
      <div className="podium-medal">{place}</div>
      <div className="podium-name">{entry.name || "Unnamed farm"}</div>
      <div className="podium-score">
        {formatScore(entry.score)}
        <span>score</span>
      </div>
      <Pebbles count={entry.otter_count} />
    </Link>
  );
}

export function Podium({ entries }: { entries: LeaderboardEntry[] }) {
  const first = entries.find((row) => row.rank === 1);
  const second = entries.find((row) => row.rank === 2);
  const third = entries.find((row) => row.rank === 3);
  if (!first && !second && !third) return null;
  return (
    <section className="podium" aria-label="Top three">
      <Slot entry={second} place={2} />
      <Slot entry={first} place={1} />
      <Slot entry={third} place={3} />
    </section>
  );
}
