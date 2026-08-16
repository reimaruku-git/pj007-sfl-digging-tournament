import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import {
  fetchTournament,
  listTournaments,
  submitFarm,
  type LeaderboardEntry,
  type TournamentSummary,
} from "../api/public";
import { Pebbles } from "../components/Pebbles";
import { Podium } from "../components/Podium";
import { SyncCountdown } from "../components/SyncCountdown";
import { liveTournamentsSoonestFirst, upcomingTournaments, visibleBoardEntries, type ScoreSortDir } from "../lib/board";
import { readFollowedFarm, writeFollowedFarm } from "../lib/followFarm";
import { formatDateRangeUtc, formatScore, statusLabel } from "../lib/format";
import { msUntilNextSync } from "../lib/schedule";

export function LeaderboardPage() {
  const [farmId, setFarmId] = useState(() => readFollowedFarm());
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [mine, setMine] = useState(() => readFollowedFarm());
  const [sortById, setSortById] = useState<Record<string, ScoreSortDir>>({});

  const catalog = useQuery({
    queryKey: ["tournaments"],
    queryFn: listTournaments,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const wait = Math.min(msUntilNextSync() + 45_000, 6 * 60 * 60_000);
    const id = window.setTimeout(() => {
      void catalog.refetch();
    }, Math.max(wait, 15_000));
    return () => window.clearTimeout(id);
  }, [catalog.dataUpdatedAt, catalog.refetch]);

  const items = catalog.data?.tournaments ?? [];
  const live = useMemo(() => liveTournamentsSoonestFirst(items), [items]);
  const upcoming = useMemo(() => upcomingTournaments(items), [items]);

  const boards = useQueries({
    queries: live.map((row) => ({
      queryKey: ["tournament", row.tournament_id],
      queryFn: () => fetchTournament(row.tournament_id),
    })),
  });

  const joinable = useMemo(() => [...live, ...upcoming], [live, upcoming]);

  const submit = useMutation({
    mutationFn: () => submitFarm(farmId.trim(), name.trim(), picked),
    onSuccess: () => {
      writeFollowedFarm(farmId.trim());
      setMine(farmId.trim());
      setNotice("Join request sent. An admin will approve each tournament you picked.");
      setName("");
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const featured = live[0];
  const featuredEntries = boards[0]?.data?.entries ?? [];
  const followed = boards
    .flatMap((query) => query.data?.entries ?? [])
    .find((row) => row.farm_id === mine);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    submit.mutate();
  }

  function sortFor(id: string): ScoreSortDir {
    return sortById[id] ?? "asc";
  }

  return (
    <>
      <section className="hero">
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
                Counts as 4 digs. An Otter Pebble found with a Drill is counted as the exact dig
                number within those 4. Example: After 5 shovel digs, the next Drill becomes digs
                6, 7, 8 and 9. A pebble in the last tile is dig #9.
              </span>
            </li>
            <li>
              <span>Score</span>
              <span>
                Your 3rd-pebble digs divided by the tournament length in days. Lower is better.
              </span>
            </li>
            <li>
              <span>Refresh</span>
              <span>14:00, 16:00, 18:00, 20:00, 23:00 UTC. Digs after 23:00 UTC do not count</span>
            </li>
            <li>
              <span>Unfinished</span>
              <span>
                Score of the worst finisher that day (or 30, whichever is higher) + 5 per missing
                Otter Pebble, then divided by the tournament length
              </span>
            </li>
            <li>
              <span>Ties</span>
              <span>
                Same score: fewer digs to the 3rd pebble, then the 2nd, then the 1st. Still tied:
                earlier time on the 3rd pebble, then the 2nd, then the 1st.
              </span>
            </li>
          </ul>
        </div>
        <div className="card tourney-home">
          {catalog.isError && (
            <p className="flash err">{(catalog.error as Error).message}</p>
          )}
          <TourneyGroup
            title="Ongoing"
            empty="No ongoing tournament."
            items={live}
            testId="ongoing-group"
            live
          />
          <TourneyGroup
            title="Upcoming"
            empty="No upcoming tournaments."
            items={upcoming}
            testId="upcoming-group"
          />
        </div>
      </section>

      {featuredEntries.length > 0 && <Podium entries={featuredEntries} />}

      {followed && (
        <Link to={`/farm/${followed.farm_id}`} className="you-banner">
          <span className="kicker">Your farm</span>
          <strong>
            {followed.name || "Unnamed farm"} · rank {followed.rank ?? "—"} ·{" "}
            {formatScore(followed.score)} · {followed.digs_to_third_op ?? "—"} digs
          </strong>
          <Pebbles count={followed.otter_count} />
        </Link>
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
              [row.tournament_id]: sortFor(row.tournament_id) === "asc" ? "desc" : "asc",
            }))
          }
        />
      ))}

      <section className="card" id="join">
        <div className="kicker">Join a tournament</div>
        <p className="meta">
          Enter your Farm ID — the browser remembers it. Pick one or more scheduled or live events.
          An admin approves each join.
        </p>
        {notice && <div className={`flash ${submit.isSuccess ? "ok" : "err"}`}>{notice}</div>}
        <form className="form-grid" onSubmit={onSubmit} data-testid="join-form">
          <label>
            Farm ID
            <input
              className="search"
              placeholder="Farm ID"
              value={farmId}
              onChange={(event) => setFarmId(event.target.value)}
              required
              data-testid="join-farm-id"
            />
          </label>
          <label>
            Display name (optional)
            <input
              placeholder="Display name (optional)"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div data-testid="join-tournaments">
            <div className="kicker">Tournaments</div>
            {joinable.length === 0 && <p className="muted">No scheduled or live events to join yet.</p>}
            {joinable.map((row) => (
              <label key={row.tournament_id} className="join-option">
                <input
                  type="checkbox"
                  checked={picked.includes(row.tournament_id)}
                  onChange={() =>
                    setPicked((current) =>
                      current.includes(row.tournament_id)
                        ? current.filter((id) => id !== row.tournament_id)
                        : [...current, row.tournament_id],
                    )
                  }
                />
                <span>
                  {row.name || "Untitled"} · {formatDateRangeUtc(row.start_at, row.end_at, row.duration_days)}
                </span>
              </label>
            ))}
          </div>
          <button className="btn primary" type="submit" disabled={submit.isPending || picked.length === 0}>
            Request join
          </button>
        </form>
      </section>
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
  const sortLabel = sort === "asc" ? "↑" : "↓";
  return (
    <section className="card table-wrap live-board" data-testid={`live-board-${tournament.tournament_id}`}>
      <div className="kicker">{tournament.name || "Live board"}</div>
      <p className="meta">{formatDateRangeUtc(tournament.start_at, tournament.end_at, tournament.duration_days)}</p>
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
                <th>Score</th>
                <th>
                  <button
                    type="button"
                    className="sort-btn"
                    data-testid={`sort-score-${tournament.tournament_id}`}
                    onClick={onToggleSort}
                  >
                    Avg / day {sortLabel}
                  </button>
                </th>
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
                  <span>score</span>
                  <span className="muted">{formatScore(row.score)} avg/day</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
