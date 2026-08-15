import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchLeaderboard, submitFarm } from "../api/public";
import { Pebbles } from "../components/Pebbles";
import { Podium } from "../components/Podium";
import { SyncCountdown } from "../components/SyncCountdown";
import { readFollowedFarm, writeFollowedFarm } from "../lib/followFarm";
import { formatRelative, formatWhenUtc, statusLabel } from "../lib/format";
import { msUntilNextSync } from "../lib/schedule";

export function LeaderboardPage() {
  const [query, setQuery] = useState("");
  const [farmId, setFarmId] = useState("");
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [mine, setMine] = useState(() => readFollowedFarm());

  const board = useQuery({
    queryKey: ["leaderboard"],
    queryFn: fetchLeaderboard,
    refetchOnWindowFocus: true,
    refetchInterval: false,
  });

  useEffect(() => {
    const wait = Math.min(msUntilNextSync() + 45_000, 6 * 60 * 60_000);
    const id = window.setTimeout(() => {
      void board.refetch();
    }, Math.max(wait, 15_000));
    return () => window.clearTimeout(id);
  }, [board.dataUpdatedAt, board.refetch]);

  const submit = useMutation({
    mutationFn: () => submitFarm(farmId.trim(), name.trim()),
    onSuccess: () => {
      writeFollowedFarm(farmId.trim());
      setMine(farmId.trim());
      setNotice("Farm submitted. An admin will approve it before it appears.");
      setFarmId("");
      setName("");
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const all = board.data?.entries ?? [];
  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (entry) =>
        entry.farm_id.toLowerCase().includes(needle) ||
        (entry.name || "").toLowerCase().includes(needle),
    );
  }, [all, query]);

  const config = board.data?.config;
  const completed = all.filter((row) => row.status === "completed").length;
  const followed = all.find((row) => row.farm_id === mine);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    submit.mutate();
  }

  return (
    <>
      <section className="hero">
        <div className="card prize-card" id="rules">
          <div className="kicker">Prize pool</div>
          <div className="prize">{config?.prize_amount ?? "30"} Flower</div>
          <p className="meta">
            Get the 3 Otter Pebbles as early as possible. Digs after that do not affect your score.
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
              <span>The dig number when you get the 3rd Otter Pebble</span>
            </li>
            <li>
              <span>Refresh</span>
              <span>14:00, 16:00, 18:00, 20:00, 23:00 UTC. Digs after 23:00 UTC do not count</span>
            </li>
            <li>
              <span>Unfinished</span>
              <span>
                Score of the worst finisher that day (or 30, whichever is higher) + 5 per missing
                Otter Pebble
              </span>
            </li>
            <li>
              <span>Ties</span>
              <span>
                Same 3rd-pebble digs: fewer digs to the 2nd pebble, then to the 1st. Still tied:
                earlier time on the 3rd pebble, then the 2nd, then the 1st.
              </span>
            </li>
          </ul>
        </div>
        <div className="card stats">
          <div className="stat">
            <span className="muted">Tournament</span>
            <b>
              <span className={`badge ${config?.status ?? "scheduled"}`}>
                {statusLabel(config?.status ?? "scheduled")}
              </span>
            </b>
          </div>
          <div className="stat">
            <span className="muted">Window</span>
            <b className="stat-window">
              {config ? `${formatWhenUtc(config.start_at)} → ${formatWhenUtc(config.end_at)}` : "—"}
            </b>
          </div>
          <div className="stat">
            <span className="muted">Finished / tracked</span>
            <b>
              {completed} / {board.data?.count ?? 0}
            </b>
          </div>
          <SyncCountdown />
        </div>
      </section>

      <Podium entries={all} />

      {followed && (
        <Link to={`/farm/${followed.farm_id}`} className="you-banner">
          <span className="kicker">Your farm</span>
          <strong>
            {followed.name || "Unnamed farm"} · rank {followed.rank ?? "—"} ·{" "}
            {followed.digs_to_third_op ?? "—"} digs
          </strong>
          <Pebbles count={followed.otter_count} />
        </Link>
      )}

      <div className="toolbar">
        <input
          className="search"
          placeholder="Search farm ID or name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {board.dataUpdatedAt ? (
          <span className="muted toolbar-meta">
            Updated {formatRelative(new Date(board.dataUpdatedAt).toISOString())}
          </span>
        ) : null}
      </div>

      <div className="card table-wrap">
        {board.isLoading && (
          <div className="skeleton-stack" aria-hidden>
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        )}
        {board.isError && <p className="flash err">{(board.error as Error).message}</p>}
        {!board.isLoading && entries.length === 0 && (
          <p className="muted">No farms match yet. Submit a Farm ID below.</p>
        )}
        {(entries.length > 0 || !board.isLoading) && (
          <>
            <table className="board-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Farm</th>
                  <th>Score</th>
                  <th>Total</th>
                  <th>Avg/day</th>
                  <th>Pebbles</th>
                  <th>Today</th>
                  <th>Updated</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => (
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
                    <td>{row.total_digs}</td>
                    <td>{row.avg_digs_per_day ?? "—"}</td>
                    <td>
                      <Pebbles count={row.otter_count} />
                    </td>
                    <td>{row.digs_today}</td>
                    <td>{formatRelative(row.last_updated_at)}</td>
                    <td>
                      <span className={`badge ${row.status}`}>{statusLabel(row.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="board-cards">
              {entries.map((row) => (
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
                    <span className="muted">
                      {row.total_digs} tot · {row.avg_digs_per_day ?? "—"}/d
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      <section className="card" id="join">
        <div className="kicker">Join the tournament</div>
        <p className="meta">Anyone can submit a Farm ID. An admin approves it before it appears.</p>
        {notice && <div className={`flash ${submit.isSuccess ? "ok" : "err"}`}>{notice}</div>}
        <form className="toolbar" onSubmit={onSubmit}>
          <input
            className="search"
            placeholder="Farm ID"
            value={farmId}
            onChange={(event) => setFarmId(event.target.value)}
            required
          />
          <input
            placeholder="Display name (optional)"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="btn primary" type="submit" disabled={submit.isPending}>
            Submit
          </button>
        </form>
      </section>
    </>
  );
}
