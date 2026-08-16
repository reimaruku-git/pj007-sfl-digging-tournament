import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchTournament, listTournaments, type TournamentSummary } from "../api/public";
import { Pebbles } from "../components/Pebbles";
import { formatDateRangeUtc, formatScore, statusLabel } from "../lib/format";

export function TournamentsPage() {
  const { tournamentId } = useParams();
  if (tournamentId) return <TournamentDetail tournamentId={tournamentId} />;
  return <TournamentList />;
}

function TournamentList() {
  const query = useQuery({ queryKey: ["tournaments"], queryFn: listTournaments });
  const items = query.data?.tournaments ?? [];
  const upcoming = items.filter((row) => row.status === "scheduled");
  const live = items.filter((row) => row.status === "active");
  const past = items.filter((row) => row.status === "ended");
  return (
    <section className="card">
      <div className="kicker">Tournaments</div>
      <p className="meta">Upcoming events, the live board, and frozen past standings.</p>
      {query.isLoading && <p className="muted">Loading tournaments…</p>}
      {query.isError && <p className="flash err">{(query.error as Error).message}</p>}
      <Group title="Upcoming" empty="Nothing scheduled yet." items={upcoming} />
      <Group title="Live" empty="No live tournament." items={live} />
      <Group title="Past" empty="No archived tournaments yet." items={past} />
    </section>
  );
}

function Group({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: TournamentSummary[];
}) {
  return (
    <div style={{ marginTop: 20 }}>
      <div className="kicker">{title}</div>
      {items.length === 0 && <p className="muted">{empty}</p>}
      {items.length > 0 && (
        <ul className="rules-list" style={{ listStyle: "none", marginLeft: 0 }}>
          {items.map((row) => (
            <li key={row.tournament_id}>
              <span className={`badge ${row.status}`}>{statusLabel(row.status)}</span>
              <span>
                <Link to={`/tournaments/${encodeURIComponent(row.tournament_id)}`}>
                  {row.name || `${row.duration_days}d event`}
                </Link>
                <div className="meta">
                  {formatDateRangeUtc(row.start_at, row.end_at, row.duration_days)} ·{" "}
                  {row.prize_amount} Flower
                  {row.status === "ended" ? ` · ${row.count} farm${row.count === 1 ? "" : "s"}` : ""}
                </div>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TournamentDetail({ tournamentId }: { tournamentId: string }) {
  const query = useQuery({
    queryKey: ["tournament", tournamentId],
    queryFn: () => fetchTournament(tournamentId),
  });
  const data = query.data;
  return (
    <section className="card table-wrap" data-testid="tournament-detail">
      <p className="meta">
        <Link to="/">← Home</Link>
        {" · "}
        <Link to="/tournaments">All tournaments</Link>
      </p>
      {query.isLoading && <p className="muted">Loading tournament…</p>}
      {query.isError && <p className="flash err">{(query.error as Error).message}</p>}
      {data && (
        <>
          <div className="kicker">{data.config.name || "Tournament"}</div>
          <p className="meta" data-testid="tournament-window">
            {formatDateRangeUtc(data.config.start_at, data.config.end_at, data.config.duration_days)}
          </p>
          <div className="tourney-facts">
            <div data-testid="tournament-prize">
              <span className="muted">Prize</span>
              <b>{data.config.prize_amount} Flower</b>
            </div>
            <div data-testid="tournament-participants">
              <span className="muted">Participants</span>
              <b>{data.count}</b>
            </div>
            <div data-testid="tournament-overall-avg">
              <span className="muted">Overall average per day</span>
              <b>{formatScore(data.overall_average_per_day)}</b>
            </div>
          </div>
          {data.entries.length === 0 && (
            <p className="muted">
              {data.config.status === "scheduled"
                ? "No farms enrolled yet."
                : "No farms in this archive."}
            </p>
          )}
          {data.entries.length > 0 && (
            <table className="board-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Farm</th>
                  <th>Score</th>
                  <th>3rd pebble</th>
                  <th>Pebbles</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((row) => (
                  <tr key={row.farm_id}>
                    <td className={`rank ${row.rank ? `r${row.rank}` : ""}`}>{row.rank ?? "—"}</td>
                    <td>
                      <Link
                        to={`/tournaments/${encodeURIComponent(tournamentId)}/farm/${row.farm_id}`}
                      >
                        {row.name || "Unnamed farm"}
                        <div className="farm-id">{row.farm_id}</div>
                      </Link>
                    </td>
                    <td>{formatScore(row.score)}</td>
                    <td>{row.digs_to_third_op ?? "—"}</td>
                    <td>
                      <Pebbles count={row.otter_count} />
                    </td>
                    <td>
                      <span className={`badge ${row.status}`}>{statusLabel(row.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
