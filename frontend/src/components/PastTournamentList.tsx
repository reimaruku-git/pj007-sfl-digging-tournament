import { Link } from "react-router-dom";
import type { TournamentSummary } from "../api/public";
import { pastTournaments } from "../lib/board";
import { catalogStatusLabel, formatDateRangeUtc } from "../lib/format";

export const PAST_CARD_CLASS =
  "past-card flex items-start justify-between gap-4 rounded-2xl border border-[rgba(196,184,164,0.14)] bg-dusk-panel p-5 text-inherit no-underline shadow-[0_10px_28px_rgba(0,0,0,0.28)] transition-colors hover:border-[rgba(184,154,86,0.35)]";

export const PAST_BADGE_ENDED =
  "past-badge shrink-0 rounded-md bg-zinc-700 px-2.5 py-1 text-xs font-semibold tracking-wide text-white";

export function PastTournamentList({ items }: { items: TournamentSummary[] }) {
  const rows = pastTournaments(items);
  return (
    <section className="past-list mt-4" id="past">
      <h2 className="past-head mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-dusk-gold">
        Past tournaments
      </h2>
      <p className="past-sub mb-4 text-sm leading-relaxed text-dusk-mute">
        Finished events, newest first. Open one to see the frozen standings.
      </p>
      <div className="past-stack flex flex-col gap-3" data-testid="past-tournaments">
        {rows.length === 0 && <p className="muted">No past tournaments yet.</p>}
        {rows.map((row) => (
          <Link
            key={row.tournament_id}
            to={`/tournaments/${encodeURIComponent(row.tournament_id)}`}
            state={{ from: "home" }}
            className={PAST_CARD_CLASS}
            data-testid={`past-link-${row.tournament_id}`}
          >
            <div className="min-w-0">
              <div className="font-bold text-dusk-cream">{row.name || "Untitled"}</div>
              <div className="past-card-meta mt-1 text-sm text-dusk-mute">
                {formatDateRangeUtc(row.start_at, row.end_at, row.duration_days)}
                {" · "}
                {row.prize_amount} Flower · {row.count} farm{row.count === 1 ? "" : "s"}
              </div>
            </div>
            <span className={PAST_BADGE_ENDED} data-testid="past-badge-ended">
              {catalogStatusLabel(row.status)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
