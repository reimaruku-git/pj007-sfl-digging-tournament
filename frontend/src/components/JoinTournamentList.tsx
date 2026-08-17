import { Link } from "react-router-dom";
import type { TournamentSummary } from "../api/public";
import { joinListTournaments } from "../lib/board";
import { catalogStatusLabel, formatDateRangeUtc } from "../lib/format";

export const JOIN_CARD_CLASS =
  "flex items-start justify-between gap-4 rounded-2xl border border-[rgba(196,184,164,0.14)] bg-dusk-panel p-5 text-inherit no-underline shadow-[0_10px_28px_rgba(0,0,0,0.28)] transition-colors hover:border-[rgba(184,154,86,0.35)]";

export const JOIN_BADGE_ONGOING =
  "shrink-0 rounded-md bg-green-700 px-2.5 py-1 text-xs font-semibold tracking-wide text-white";

export const JOIN_BADGE_UPCOMING =
  "shrink-0 rounded-md bg-zinc-500 px-2.5 py-1 text-xs font-semibold tracking-wide text-white";

export function JoinTournamentList({
  items,
  connectedName,
}: {
  items: TournamentSummary[];
  connectedName?: string | null;
}) {
  const rows = joinListTournaments(items);
  return (
    <section className="mt-4" id="join">
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-dusk-gold">
        Join a tournament
      </h2>
      <p className="mb-4 text-sm leading-relaxed text-dusk-mute">
        Open an upcoming or ongoing event to see the prize and join from there.
        {connectedName ? (
          <>
            {" "}
            You are <strong className="text-dusk-cream">{connectedName}</strong>.
          </>
        ) : null}
      </p>
      <div className="flex flex-col gap-3" data-testid="join-tournaments">
        {rows.length === 0 && <p className="muted">No scheduled or live events to join yet.</p>}
        {rows.map((row) => {
          const ongoing = row.status === "active";
          const tone = ongoing ? "ongoing" : "upcoming";
          return (
            <Link
              key={row.tournament_id}
              to={`/tournaments/${encodeURIComponent(row.tournament_id)}`}
              className={JOIN_CARD_CLASS}
              data-testid={`join-link-${row.tournament_id}`}
            >
              <div className="min-w-0">
                <div className="font-bold text-dusk-cream">{row.name || "Untitled"}</div>
                <div className="mt-1 text-sm text-dusk-mute">
                  {formatDateRangeUtc(row.start_at, row.end_at, row.duration_days)}
                </div>
              </div>
              <span
                className={ongoing ? JOIN_BADGE_ONGOING : JOIN_BADGE_UPCOMING}
                data-testid={`join-badge-${tone}`}
              >
                {catalogStatusLabel(row.status)}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
