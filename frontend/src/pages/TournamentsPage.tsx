import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  fetchTournament,
  listTournaments,
  submitFarm,
  type TournamentSummary,
} from "../api/public";
import { Pebbles } from "../components/Pebbles";
import { tournamentBackTarget } from "../lib/backTarget";
import { joinableTournaments } from "../lib/board";
import { useFarmSession } from "../lib/farmSession";
import { catalogStatusLabel, formatDateRangeUtc, formatScore, statusLabel } from "../lib/format";

export function TournamentsPage() {
  const { tournamentId } = useParams();
  if (tournamentId) return <TournamentDetail tournamentId={tournamentId} />;
  return <TournamentList />;
}

function TournamentList() {
  const query = useQuery({ queryKey: ["tournaments"], queryFn: listTournaments });
  const items = query.data?.tournaments ?? [];
  const windows = joinableTournaments(items);
  const past = items.filter((row) => row.status === "ended");
  return (
    <>
      <div className="tourney-catalog-head">
        <div className="kicker">Tournaments</div>
        <p className="meta">Ongoing first, then upcoming. Nearest event sits at the top.</p>
      </div>
      {query.isLoading && <p className="muted">Loading tournaments…</p>}
      {query.isError && <p className="flash err">{(query.error as Error).message}</p>}
      {!query.isLoading && windows.length === 0 && (
        <p className="muted">No ongoing or upcoming events.</p>
      )}
      {windows.length > 0 && (
        <div className="tourney-stack" data-testid="tourney-stack">
          {windows.map((row) => (
            <CatalogWindow key={row.tournament_id} row={row} />
          ))}
        </div>
      )}
      {past.length > 0 && (
        <section className="card">
          <div className="kicker">Past</div>
          <ul className="rules-list" style={{ listStyle: "none", marginLeft: 0 }}>
            {past.map((row) => (
              <li key={row.tournament_id}>
                <span className={`badge ${row.status}`}>{statusLabel(row.status)}</span>
                <span>
                  <Link
                    to={`/tournaments/${encodeURIComponent(row.tournament_id)}`}
                    state={{ from: "tournaments" }}
                  >
                    {row.name || `${row.duration_days}d event`}
                  </Link>
                  <div className="meta">
                    {formatDateRangeUtc(row.start_at, row.end_at, row.duration_days)} ·{" "}
                    {row.prize_amount} Flower · {row.count} farm{row.count === 1 ? "" : "s"}
                  </div>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function CatalogWindow({ row }: { row: TournamentSummary }) {
  const ongoing = row.status === "active";
  const tone = ongoing ? "ongoing" : "upcoming";
  return (
    <Link
      to={`/tournaments/${encodeURIComponent(row.tournament_id)}`}
      state={{ from: "tournaments" }}
      className={`tourney-window is-${tone}`}
      data-testid={`tourney-window-${row.tournament_id}`}
    >
      <span className={`tourney-status ${tone}`} data-testid={`tourney-status-${tone}`}>
        {catalogStatusLabel(row.status)}
      </span>
      <div className="tourney-window-name">{row.name || `${row.duration_days}d event`}</div>
      <div className="tourney-window-meta">
        {formatDateRangeUtc(row.start_at, row.end_at, row.duration_days)} · {row.prize_amount}{" "}
        Flower
      </div>
    </Link>
  );
}

function TournamentDetail({ tournamentId }: { tournamentId: string }) {
  const { identity } = useFarmSession();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const back = tournamentBackTarget(from);
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["tournament", tournamentId],
    queryFn: () => fetchTournament(tournamentId),
  });
  const join = useMutation({
    mutationFn: () => {
      if (!identity) throw new Error("Connect your farm first");
      return submitFarm(identity.farm_id, identity.name, [tournamentId]);
    },
    onSuccess: () => setNotice("Join request sent. An admin will approve it."),
    onError: (error: Error) => setNotice(error.message),
  });
  const data = query.data;
  const joinable = Boolean(data?.accepts_joins);
  return (
    <section className="card table-wrap" data-testid="tournament-detail">
      <p className="meta">
        <Link to={back.to} data-testid="back-link">
          ← {back.label}
        </Link>
      </p>
      {query.isLoading && <p className="muted">Loading tournament…</p>}
      {query.isError && <p className="flash err">{(query.error as Error).message}</p>}
      {data && (
        <>
          <div className="kicker">{data.config.name || "Tournament"}</div>
          <p className="meta" data-testid="tournament-window">
            {formatDateRangeUtc(
              data.config.start_at,
              data.config.end_at,
              data.config.duration_days,
            )}
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
          {joinable && identity && (
            <div className="join-detail" data-testid="join-detail">
              {notice && <div className={`flash ${join.isSuccess ? "ok" : "err"}`}>{notice}</div>}
              <p className="meta">
                Joining as <strong>{identity.name}</strong> · {identity.farm_id}
              </p>
              <button
                className="btn primary"
                type="button"
                data-testid="join-tournament"
                disabled={join.isPending}
                onClick={() => {
                  setNotice(null);
                  join.mutate();
                }}
              >
                {join.isPending ? "Sending…" : "Join this tournament"}
              </button>
            </div>
          )}
          {joinable && !identity && (
            <p className="meta" data-testid="join-need-connect">
              Connect your farm in the header to join this event.
            </p>
          )}
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
                  <th>Total</th>
                  <th>Avg / day</th>
                  <th>Today</th>
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
                    <td>{row.digs_to_third_op ?? "—"}</td>
                    <td>{formatScore(row.score)}</td>
                    <td>{row.score_today ?? "—"}</td>
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
