import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  fetchTournament,
  listTournaments,
  submitFarm,
  type PrizePlace,
  type TournamentSummary,
} from "../api/public";
import { DownloadBoardButton } from "../components/DownloadBoardButton";
import { Pebbles } from "../components/Pebbles";
import { Podium } from "../components/Podium";
import { tournamentBackTarget } from "../lib/backTarget";
import {
  liveTournamentsSoonestFirst,
  pastTournaments,
  upcomingTournaments,
} from "../lib/board";
import { useFarmSession } from "../lib/farmSession";
import {
  formatDateRangeUtc,
  formatDurationDays,
  formatScore,
  formatWindowRange,
  opensLabel,
  remainingLabel,
  statusLabel,
  windowStatusLabel,
} from "../lib/format";

function formatPrizePlaces(places: PrizePlace[]): string {
  return places
    .map((item) => {
      const suffix =
        item.place === 1 ? "st" : item.place === 2 ? "nd" : item.place === 3 ? "rd" : "th";
      return `${item.place}${suffix} ${item.amount} Flower`;
    })
    .join(" · ");
}

export function TournamentsPage() {
  const { tournamentId } = useParams();
  if (tournamentId) return <TournamentDetail tournamentId={tournamentId} />;
  return <TournamentList />;
}

function TournamentList() {
  const query = useQuery({ queryKey: ["tournaments"], queryFn: listTournaments });
  const items = query.data?.tournaments ?? [];
  const live = liveTournamentsSoonestFirst(items);
  const upcoming = upcomingTournaments(items);
  const ended = pastTournaments(items);
  return (
    <div className="page-inner windows-page">
      <header className="windows-head">
        <div className="kicker">Calendar</div>
        <h1 data-testid="tournaments-title">Tournaments</h1>
      </header>
      {query.isLoading && <p className="muted">Loading tournaments…</p>}
      {query.isError && <p className="flash err">{(query.error as Error).message}</p>}
      {!query.isLoading && (
        <div className="windows-board" data-testid="catalog-board">
          <CatalogGroup
            title="Live"
            tone="ongoing"
            testId="catalog-ongoing"
            items={live}
            empty="No live tournament."
          />
          <CatalogGroup
            title="Upcoming"
            tone="upcoming"
            testId="catalog-upcoming"
            items={upcoming}
            empty="No upcoming tournaments."
          />
          <CatalogGroup
            title="Past"
            tone="ended"
            testId="catalog-ended"
            items={ended}
            empty="No past tournaments yet."
          />
        </div>
      )}
    </div>
  );
}

function CatalogGroup({
  title,
  tone,
  testId,
  items,
  empty,
}: {
  title: string;
  tone: "ongoing" | "upcoming" | "ended";
  testId: string;
  items: TournamentSummary[];
  empty: string;
}) {
  return (
    <section className={`windows-group is-${tone}`} data-testid={testId}>
      <div className="windows-group-head">
        <h2>{title}</h2>
        <span className="catalog-count" data-testid={`${testId}-count`}>
          {items.length}
        </span>
      </div>
      <div className="windows-group-list" data-testid={`${testId}-list`}>
        {items.length === 0 && <p className="muted catalog-empty">{empty}</p>}
        {items.map((row) => (
          <CatalogWindow key={row.tournament_id} row={row} tone={tone} />
        ))}
      </div>
    </section>
  );
}

function CatalogWindow({
  row,
  tone,
}: {
  row: TournamentSummary;
  tone: "ongoing" | "upcoming" | "ended";
}) {
  const when =
    tone === "ongoing"
      ? remainingLabel(row.end_at)
      : tone === "upcoming"
        ? opensLabel(row.start_at)
        : "Ended";
  return (
    <Link
      to={`/tournaments/${encodeURIComponent(row.tournament_id)}`}
      state={{ from: "tournaments" }}
      className={`window-card is-${tone}`}
      data-testid={`tourney-window-${row.tournament_id}`}
    >
      <div className="window-card-top">
        <span className={`tourney-status ${tone}`} data-testid={`tourney-status-${tone}`}>
          {windowStatusLabel(row.status)}
        </span>
        <span className="window-duration">{formatDurationDays(row.duration_days)}</span>
      </div>
      <div className="window-card-name">{row.name || `${row.duration_days}d event`}</div>
      <p className="window-card-dates">
        {formatWindowRange(row.start_at, row.end_at)}
        {when ? ` · ${when}` : ""}
      </p>
      {row.description ? (
        <p className="window-card-desc" data-testid={`tourney-desc-${row.tournament_id}`}>
          {row.description}
        </p>
      ) : null}
      <dl className="window-card-facts">
        <div>
          <dt>Prize</dt>
          <dd>
            {row.prize_amount} Flower
          </dd>
        </div>
        <div>
          <dt>Farms</dt>
          <dd>
            {row.max_players != null ? `${row.count} / ${row.max_players}` : row.count}
          </dd>
        </div>
        {row.min_bumpkin_level != null ? (
          <div data-testid={`tourney-min-level-${row.tournament_id}`}>
            <dt>Min level</dt>
            <dd>{row.min_bumpkin_level}</dd>
          </div>
        ) : null}
        <div data-testid={`tourney-join-mode-${row.tournament_id}`}>
          <dt>Join</dt>
          <dd>{row.join_mode === "auto" ? "Auto join" : "Must confirm"}</dd>
        </div>
      </dl>
      {row.prize_places && row.prize_places.length > 0 ? (
        <p className="window-card-prizes" data-testid={`tourney-prizes-${row.tournament_id}`}>
          {formatPrizePlaces(row.prize_places)}
        </p>
      ) : null}
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
    onSuccess: (result) => {
      const enrolled = result.submissions.some((item) => item.status === "enrolled");
      setNotice(
        enrolled
          ? "You're in. Welcome to the tournament."
          : "Join request sent. An admin will approve it.",
      );
    },
    onError: (error: Error) => setNotice(error.message),
  });
  const data = query.data;
  const joinable = Boolean(data?.accepts_joins);
  const autoJoin = data?.config.join_mode === "auto";
  return (
    <section className="card table-wrap page-inner" data-testid="tournament-detail">
      <p className="meta">
        <Link to={back.to} data-testid="back-link">
          ← {back.label}
        </Link>
      </p>
      {query.isLoading && <p className="muted">Loading tournament…</p>}
      {query.isError && <p className="flash err">{(query.error as Error).message}</p>}
      {data && (
        <>
          <div className="tourney-detail-head">
            <div>
              <div className="kicker">{data.config.name || "Tournament"}</div>
              <p className="meta" data-testid="tournament-window">
                {formatDateRangeUtc(
                  data.config.start_at,
                  data.config.end_at,
                  data.config.duration_days,
                )}
              </p>
            </div>
            <DownloadBoardButton
              name={data.config.name || "Tournament"}
              startAt={data.config.start_at}
              endAt={data.config.end_at}
              durationDays={data.config.duration_days}
              prizeAmount={data.config.prize_amount}
              entries={data.entries}
              totalCount={data.count}
            />
          </div>
          {data.config.description ? (
            <p className="tourney-description" data-testid="tournament-description">
              {data.config.description}
            </p>
          ) : null}
          <div className="tourney-facts">
            <div data-testid="tournament-prize">
              <span className="muted">Prize</span>
              <b>{data.config.prize_amount} Flower</b>
            </div>
            <div data-testid="tournament-participants">
              <span className="muted">Participants</span>
              <b>
                {data.config.max_players != null
                  ? `${data.count} / ${data.config.max_players}`
                  : data.count}
              </b>
            </div>
            <div data-testid="tournament-overall-avg">
              <span className="muted">Overall average per day</span>
              <b>{formatScore(data.overall_average_per_day)}</b>
            </div>
            {data.config.min_bumpkin_level != null ? (
              <div data-testid="tournament-min-level">
                <span className="muted">Min bumpkin level</span>
                <b>{data.config.min_bumpkin_level}</b>
              </div>
            ) : null}
            <div data-testid="tournament-join-mode">
              <span className="muted">Join</span>
              <b>{autoJoin ? "Auto join" : "Must confirm"}</b>
            </div>
          </div>
          {data.config.prize_places && data.config.prize_places.length > 0 ? (
            <div className="tourney-prize-places" data-testid="tournament-prize-places">
              {formatPrizePlaces(data.config.prize_places)}
            </div>
          ) : null}
          {joinable && identity && (
            <div className="join-detail" data-testid="join-detail">
              {notice && <div className={`flash ${join.isSuccess ? "ok" : "err"}`}>{notice}</div>}
              <p className="meta" data-testid="join-copy">
                {autoJoin
                  ? "You'll be enrolled immediately."
                  : "An admin will approve your join request."}
              </p>
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
          {data.entries.length > 0 && <Podium entries={data.entries} tournamentId={tournamentId} />}
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
