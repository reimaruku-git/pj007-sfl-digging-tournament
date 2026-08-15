import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchTournament, listTournaments } from "../api/public";
import { Pebbles } from "../components/Pebbles";
import { formatWhenUtc, statusLabel } from "../lib/format";

export function RecordsPage() {
  const { tournamentId } = useParams();
  if (tournamentId) return <RecordDetail tournamentId={tournamentId} />;
  return <RecordList />;
}

function RecordList() {
  const query = useQuery({ queryKey: ["tournaments"], queryFn: listTournaments });
  const items = query.data?.tournaments ?? [];
  return (
    <section className="card">
      <div className="kicker">Past tournaments</div>
      <p className="meta">Finished events stay here after a new window starts.</p>
      {query.isLoading && <p className="muted">Loading archives…</p>}
      {query.isError && <p className="flash err">{(query.error as Error).message}</p>}
      {!query.isLoading && items.length === 0 && (
        <p className="muted">No archived tournaments yet. They appear after a window ends.</p>
      )}
      {items.length > 0 && (
        <ul className="rules-list" style={{ listStyle: "none", marginLeft: 0 }}>
          {items.map((row) => (
            <li key={row.tournament_id}>
              <span>{row.duration_days}d</span>
              <span>
                <Link to={`/records/${encodeURIComponent(row.tournament_id)}`}>
                  {formatWhenUtc(row.start_at)} → {formatWhenUtc(row.end_at)}
                </Link>
                <div className="meta">
                  {row.count} farm{row.count === 1 ? "" : "s"} · {row.prize_amount} Flower
                </div>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecordDetail({ tournamentId }: { tournamentId: string }) {
  const query = useQuery({
    queryKey: ["tournament", tournamentId],
    queryFn: () => fetchTournament(tournamentId),
  });
  const data = query.data;
  return (
    <section className="card table-wrap">
      <p className="meta">
        <Link to="/records">← All records</Link>
      </p>
      {query.isLoading && <p className="muted">Loading archive…</p>}
      {query.isError && <p className="flash err">{(query.error as Error).message}</p>}
      {data && (
        <>
          <div className="kicker">Archived tournament</div>
          <p className="meta">
            {formatWhenUtc(data.config.start_at)} → {formatWhenUtc(data.config.end_at)} ·{" "}
            {data.config.duration_days ?? "—"} days · {data.config.prize_amount} Flower
          </p>
          {data.entries.length === 0 && <p className="muted">No farms in this archive.</p>}
          {data.entries.length > 0 && (
            <table className="board-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Farm</th>
                  <th>Score</th>
                  <th>Total</th>
                  <th>Avg/day</th>
                  <th>Pebbles</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((row) => (
                  <tr key={row.farm_id}>
                    <td className={`rank ${row.rank ? `r${row.rank}` : ""}`}>{row.rank ?? "—"}</td>
                    <td>
                      <Link to={`/farm/${row.farm_id}`}>
                        {row.name || "Unnamed farm"}
                        <div className="farm-id">{row.farm_id}</div>
                      </Link>
                    </td>
                    <td>{row.digs_to_third_op ?? "—"}</td>
                    <td>{row.total_digs}</td>
                    <td>{row.avg_digs_per_day ?? "—"}</td>
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
