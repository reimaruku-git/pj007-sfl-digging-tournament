import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchLeaderboard, submitFarm } from "../api/public";
import { formatWhen, statusLabel } from "../components/Layout";

export function LeaderboardPage() {
  const [query, setQuery] = useState("");
  const [farmId, setFarmId] = useState("");
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const board = useQuery({
    queryKey: ["leaderboard"],
    queryFn: fetchLeaderboard,
    refetchInterval: 3 * 60 * 1000,
  });

  const submit = useMutation({
    mutationFn: () => submitFarm(farmId.trim(), name.trim()),
    onSuccess: () => {
      setNotice("Farm submitted. An admin will approve it before it appears.");
      setFarmId("");
      setName("");
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const entries = useMemo(() => {
    const all = board.data?.entries ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (entry) =>
        entry.farm_id.toLowerCase().includes(needle) ||
        (entry.name || "").toLowerCase().includes(needle),
    );
  }, [board.data, query]);

  const config = board.data?.config;
  const completed = (board.data?.entries ?? []).filter((row) => row.status === "completed").length;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    submit.mutate();
  }

  return (
    <>
      <section className="hero">
        <div className="card">
          <div className="kicker">Prize pool</div>
          <div className="prize">{config?.prize_amount ?? "30"} Flower</div>
          <p className="meta">
            Collect all 3 Otter Pebbles in the fewest digs. Sand Shovel = 1, Sand Drill = 4.
            Score is the dig number of the 3rd pebble. Lower is better.
          </p>
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
            <b>
              {config ? `${formatWhen(config.start_at)} → ${formatWhen(config.end_at)}` : "—"}
            </b>
          </div>
          <div className="stat">
            <span className="muted">Finished / tracked</span>
            <b>
              {completed} / {board.data?.count ?? 0}
            </b>
          </div>
        </div>
      </section>

      <div className="toolbar">
        <input
          className="search"
          placeholder="Search farm ID or name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="card table-wrap">
        {board.isLoading && <p className="muted">Loading cached leaderboard…</p>}
        {board.isError && <p className="flash err">{(board.error as Error).message}</p>}
        {!board.isLoading && entries.length === 0 && (
          <p className="muted">No farms match yet. Submit a Farm ID below.</p>
        )}
        {entries.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Farm</th>
                <th>Digs to 3rd OP</th>
                <th>Otter Pebbles</th>
                <th>Digs today</th>
                <th>Updated</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => (
                <tr
                  key={row.farm_id}
                  className={row.rank === 1 || row.rank === 2 || row.rank === 3 ? `rank-${row.rank}` : ""}
                >
                  <td className={`rank ${row.rank ? `r${row.rank}` : ""}`}>
                    {row.rank ?? "—"}
                  </td>
                  <td>
                    <Link to={`/farm/${row.farm_id}`}>
                      {row.name || "Unnamed farm"}
                      <div className="farm-id">{row.farm_id}</div>
                    </Link>
                  </td>
                  <td>{row.digs_to_third_op ?? "—"}</td>
                  <td>{row.otter_count}/3</td>
                  <td>{row.digs_today}</td>
                  <td>{formatWhen(row.last_updated_at)}</td>
                  <td>
                    <span className={`badge ${row.status}`}>{statusLabel(row.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="card" id="rules" style={{ marginTop: 16 }}>
        <div className="kicker">Rules</div>
        <p className="meta">
          Sand Shovel costs 1 dig. Sand Drill costs 4, even if it uncovers 4 tiles. Official
          score is the dig number of the 3rd Otter Pebble. Lower is better.
        </p>
        <p className="meta">
          Scores refresh at 14:00, 16:00, 18:00, 20:00, and 23:00 UTC. 23:00 is the last sync
          of the day — digs after that do not count. If you have not found all 3 pebbles by
          then, your score is the worst completed score of the day or 30 (whichever is higher),
          plus 5 for every Otter Pebble still missing.
        </p>
      </section>

      <section className="card" id="join" style={{ marginTop: 16 }}>
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
