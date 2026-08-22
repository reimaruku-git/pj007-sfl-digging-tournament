import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  fetchTournament,
  listTournaments,
  type LeaderboardEntry,
  type TournamentSummary,
} from "../api/public";
import { PastTournamentList } from "../components/PastTournamentList";
import { Pebbles } from "../components/Pebbles";
import { Podium } from "../components/Podium";
import { SyncCountdown } from "../components/SyncCountdown";
import {
  homeTourneyPreview,
  latestPastTournament,
  liveTournamentsSoonestFirst,
  nextScoreSort,
  upcomingTournaments,
  visibleBoardEntries,
  type ScoreSortDir,
} from "../lib/board";
import { useFarmSession } from "../lib/farmSession";
import { formatDateRangeUtc, formatScore, statusLabel } from "../lib/format";
import { msUntilNextSync } from "../lib/schedule";

export function LeaderboardPage() {
  const { identity } = useFarmSession();
  const mine = identity?.farm_id ?? "";
  const [sortById, setSortById] = useState<Record<string, ScoreSortDir>>({});

  const catalog = useQuery({
    queryKey: ["tournaments"],
    queryFn: listTournaments,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const wait = Math.min(msUntilNextSync() + 45_000, 6 * 60 * 60_000);
    const id = window.setTimeout(
      () => {
        void catalog.refetch();
      },
      Math.max(wait, 15_000),
    );
    return () => window.clearTimeout(id);
  }, [catalog.dataUpdatedAt, catalog.refetch]);

  const items = catalog.data?.tournaments ?? [];
  const live = useMemo(() => liveTournamentsSoonestFirst(items), [items]);
  const upcoming = useMemo(() => upcomingTournaments(items), [items]);
  const latestEnded = useMemo(() => latestPastTournament(items), [items]);

  const boards = useQueries({
    queries: live.map((row) => ({
      queryKey: ["tournament", row.tournament_id],
      queryFn: () => fetchTournament(row.tournament_id),
    })),
  });

  const latestBoard = useQuery({
    queryKey: ["tournament", latestEnded?.tournament_id],
    queryFn: () => fetchTournament(latestEnded!.tournament_id),
    enabled: Boolean(latestEnded),
  });

  const featured = live[0];
  const mineRows = live.flatMap((row, index) => {
    const entry = (boards[index]?.data?.entries ?? []).find((item) => item.farm_id === mine);
    return entry ? [{ tournament: row, entry }] : [];
  });

  function sortFor(id: string): ScoreSortDir {
    return sortById[id] ?? null;
  }

  return (
    <>
      <section className="hero" data-testid="home-hero">
        <div className="card prize-card" id="rules">
          <div className="kicker">{featured?.name || "Prize pool"}</div>
          <div className="prize">{featured?.prize_amount ?? "30"} Flower</div>
          <p className="meta">
            Get the 3 Otter Pebbles in as few digs as possible. Digs after the 3rd pebble do not
            affect your score.
          </p>
          <ul className="rules-list">
            <li>
              <span>Shovel</span>
              <span>Counts as 1 dig</span>
            </li>
            <li>
              <span>Drill</span>
              <span>
                Counts as 4 digs. If you find an Otter Pebble with a Drill, it counts as the last
                dig of those 4. Example: After 5 shovel digs, using a Drill makes digs 6-7-8-9. The
                pebble is found on dig 9.
              </span>
            </li>
            <li>
              <span>Score</span>
              <span>
                Your score is the average number of digs it took to find the 3rd Otter Pebble, only
                on days that already have a recorded score. Missed days keep whatever score was
                recorded (including the unfinished penalty). Lower average is better.
              </span>
            </li>
            <li>
              <span>Refresh</span>
              <span>
                14:00, 16:00, 18:00, 20:00, 23:00 UTC.{" "}
                <strong>Digs after 23:00 UTC do not count</strong>
              </span>
            </li>
            <li>
              <span>Unfinished</span>
              <span>
                Score = (worst finisher that day or 30, whichever is higher) + 5 for every missing
                pebble. Missing 2nd and 1st pebbles become that score minus 1 and minus 2 unless you
                already found them. This number is permanent and still goes into your average. SO
                DIG!
              </span>
            </li>
            <li>
              <span>Ties</span>
              <span>
                Average of 3rd pebble, then 2nd, then 1st. If still tied → earlier time on the 3rd
                pebble, then 2nd, then 1st.
              </span>
            </li>
          </ul>
        </div>
        <div className="card tourney-home" data-testid="tourney-home">
          <div className="tourney-home-head">
            <Link
              to="/tournaments"
              className="tourney-home-catalog"
              data-testid="home-tournaments-link"
            >
              Tournaments
            </Link>
          </div>
          {catalog.isError && <p className="flash err">{(catalog.error as Error).message}</p>}
          <TourneyGroup
            title="Ongoing"
            empty="No ongoing tournament."
            items={homeTourneyPreview(live)}
            testId="ongoing-group"
            live
          />
          <TourneyGroup
            title="Upcoming"
            empty="No upcoming tournaments."
            items={homeTourneyPreview(upcoming)}
            testId="upcoming-group"
          />
        </div>
      </section>

      {mineRows.length > 0 && (
        <div className="you-farm-list" data-testid="you-farm">
          {mineRows.map(({ tournament, entry }) => (
            <YouFarmCard key={tournament.tournament_id} tournament={tournament} entry={entry} />
          ))}
        </div>
      )}

      {latestEnded && (
        <LatestResult
          tournament={latestEnded}
          entries={latestBoard.data?.entries ?? []}
          loading={latestBoard.isLoading}
          error={latestBoard.error as Error | undefined}
        />
      )}

      {live.map((row, index) => (
        <LiveBoard
          key={row.tournament_id}
          tournament={row}
          entries={boards[index]?.data?.entries ?? []}
          loading={Boolean(boards[index]?.isLoading)}
          error={boards[index]?.error as Error | undefined}
          sort={sortFor(row.tournament_id)}
          mine={mine}
          onToggleSort={() =>
            setSortById((current) => ({
              ...current,
              [row.tournament_id]: nextScoreSort(sortFor(row.tournament_id)),
            }))
          }
        />
      ))}

      <PastTournamentList items={items} />
    </>
  );
}

function TourneyGroup({
  title,
  empty,
  items,
  live,
  testId,
}: {
  title: string;
  empty: string;
  items: TournamentSummary[];
  live?: boolean;
  testId: string;
}) {
  return (
    <div className="tourney-group" data-testid={testId}>
      <div className="kicker">{title}</div>
      {items.length === 0 && <p className="muted tourney-empty">{empty}</p>}
      {items.map((row) => (
        <Link
          key={row.tournament_id}
          to={`/tournaments/${encodeURIComponent(row.tournament_id)}`}
          state={{ from: "home" }}
          className="tourney-card tourney-card-link"
          data-testid={`tourney-card-${row.tournament_id}`}
        >
          <div className="tourney-card-head">
            <div className="tourney-card-name">{row.name || "Untitled tournament"}</div>
            {live ? <SyncCountdown variant="card" /> : null}
          </div>
          <div className="tourney-card-meta" data-testid={`tourney-duration-${row.tournament_id}`}>
            {formatDateRangeUtc(row.start_at, row.end_at, row.duration_days)}
          </div>
        </Link>
      ))}
    </div>
  );
}

function YouFarmCard({
  tournament,
  entry,
}: {
  tournament: TournamentSummary;
  entry: LeaderboardEntry;
}) {
  const href = `/tournaments/${encodeURIComponent(tournament.tournament_id)}/farm/${entry.farm_id}`;
  return (
    <Link
      to={href}
      state={{ from: "home" }}
      className="you-farm"
      data-testid={`you-farm-${tournament.tournament_id}`}
    >
      <div className="you-farm-head">
        <div>
          <div className="kicker">Your farm</div>
          <div className="you-farm-name">{entry.name || "Unnamed farm"}</div>
          <p className="you-farm-event">
            {tournament.name || "Untitled tournament"}
            <span className={`badge ${entry.status}`}>{statusLabel(entry.status)}</span>
          </p>
        </div>
        <Pebbles count={entry.otter_count} size="md" />
      </div>
      <div className="you-farm-stats">
        <div className="stat" data-testid={`you-farm-rank-${tournament.tournament_id}`}>
          <span className="muted">Rank</span>
          <b>{entry.rank ?? "—"}</b>
        </div>
        <div className="stat" data-testid={`you-farm-avg-${tournament.tournament_id}`}>
          <span className="muted">Avg / day</span>
          <b>{formatScore(entry.score)}</b>
        </div>
        <div className="stat" data-testid={`you-farm-total-${tournament.tournament_id}`}>
          <span className="muted">Total</span>
          <b>{entry.digs_to_third_op ?? "—"}</b>
        </div>
        <div className="stat" data-testid={`you-farm-digs-today-${tournament.tournament_id}`}>
          <span className="muted">Digs today</span>
          <b>{entry.digs_today}</b>
        </div>
        <div className="stat" data-testid={`you-farm-score-today-${tournament.tournament_id}`}>
          <span className="muted">Score today</span>
          <b>{entry.score_today ?? "—"}</b>
        </div>
      </div>
    </Link>
  );
}

function LatestResult({
  tournament,
  entries,
  loading,
  error,
}: {
  tournament: TournamentSummary;
  entries: LeaderboardEntry[];
  loading: boolean;
  error?: Error;
}) {
  const href = `/tournaments/${encodeURIComponent(tournament.tournament_id)}`;
  return (
    <section className="card latest-result" data-testid="latest-result">
      <div className="latest-result-head">
        <div className="kicker">Latest result</div>
        <Link
          to={href}
          state={{ from: "home" }}
          className="latest-result-name"
          data-testid="latest-result-name"
        >
          {tournament.name || "Untitled tournament"}
        </Link>
        <p className="meta" data-testid="latest-result-window">
          {formatDateRangeUtc(tournament.start_at, tournament.end_at, tournament.duration_days)}
        </p>
      </div>
      {loading && (
        <div className="skeleton-stack" aria-hidden>
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}
      {error && <p className="flash err">{error.message}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="muted">No standings recorded.</p>
      )}
      {!loading && entries.length > 0 && (
        <Podium entries={entries} tournamentId={tournament.tournament_id} />
      )}
    </section>
  );
}

function LiveBoard({
  tournament,
  entries,
  loading,
  error,
  sort,
  mine,
  onToggleSort,
}: {
  tournament: TournamentSummary;
  entries: LeaderboardEntry[];
  loading: boolean;
  error?: Error;
  sort: ScoreSortDir;
  mine: string;
  onToggleSort: () => void;
}) {
  const rows = visibleBoardEntries(entries, sort, 10);
  const sortLabel = sort === "asc" ? " ↑" : sort === "desc" ? " ↓" : "";
  const href = `/tournaments/${encodeURIComponent(tournament.tournament_id)}`;
  return (
    <section
      className="card table-wrap live-board"
      data-testid={`live-board-${tournament.tournament_id}`}
    >
      <div className="live-board-head">
        <Link
          to={href}
          state={{ from: "home" }}
          className="live-board-open"
          data-testid={`open-board-${tournament.tournament_id}`}
          aria-label={`Open ${tournament.name || "tournament"}`}
        >
          <div className="kicker">{tournament.name || "Live board"}</div>
          <p className="meta">
            {formatDateRangeUtc(tournament.start_at, tournament.end_at, tournament.duration_days)}
          </p>
        </Link>
      </div>
      {loading && (
        <div className="skeleton-stack" aria-hidden>
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}
      {error && <p className="flash err">{error.message}</p>}
      {!loading && rows.length === 0 && <p className="muted">No farms on this board yet.</p>}
      {rows.length > 0 && (
        <div className="board-scroll">
          <table className="board-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Farm</th>
                <th>Total</th>
                <th>
                  <button
                    type="button"
                    className={["sort-btn", sort ? "is-sorted" : ""].filter(Boolean).join(" ")}
                    data-testid={`sort-score-${tournament.tournament_id}`}
                    data-sort={sort ?? "none"}
                    aria-pressed={sort != null}
                    onClick={onToggleSort}
                  >
                    Avg / day{sortLabel}
                  </button>
                </th>
                <th>Today</th>
                <th>Pebbles</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.farm_id}
                  className={[
                    row.rank === 1 || row.rank === 2 || row.rank === 3 ? `rank-${row.rank}` : "",
                    row.farm_id === mine ? "is-you" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <td className={`rank ${row.rank ? `r${row.rank}` : ""}`}>{row.rank ?? "—"}</td>
                  <td>
                    <Link to={`/farm/${row.farm_id}`}>
                      {row.name || "Unnamed farm"}
                      {row.farm_id === mine ? <span className="you-tag">You</span> : null}
                      <div className="farm-id">{row.farm_id}</div>
                    </Link>
                  </td>
                  <td>{row.digs_to_third_op ?? "—"}</td>
                  <td>{formatScore(row.score)}</td>
                  <td>{row.score_today ?? "—"}</td>
                  <td>
                    <Pebbles count={row.otter_count} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="board-cards">
            {rows.map((row) => (
              <Link
                key={row.farm_id}
                to={`/farm/${row.farm_id}`}
                className={[
                  "farm-card",
                  row.rank === 1 || row.rank === 2 || row.rank === 3 ? `rank-${row.rank}` : "",
                  row.farm_id === mine ? "is-you" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className={`rank ${row.rank ? `r${row.rank}` : ""}`}>{row.rank ?? "—"}</div>
                <div className="farm-card-main">
                  <div className="farm-card-name">
                    {row.name || "Unnamed farm"}
                    {row.farm_id === mine ? <span className="you-tag">You</span> : null}
                  </div>
                  <div className="farm-id">{row.farm_id}</div>
                  <div className="farm-card-meta">
                    <Pebbles count={row.otter_count} />
                    <span className={`badge ${row.status}`}>{statusLabel(row.status)}</span>
                  </div>
                </div>
                <div className="farm-card-score">
                  <b>{row.digs_to_third_op ?? "—"}</b>
                  <span>total</span>
                  <span className="muted">{formatScore(row.score)} avg/day</span>
                  <span className="muted">today {row.score_today ?? "—"}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
