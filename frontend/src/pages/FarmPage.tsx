import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchFarm } from "../api/public";
import { formatWhen, statusLabel } from "../components/Layout";

export function FarmPage() {
  const { farmId = "" } = useParams();
  const query = useQuery({
    queryKey: ["farm", farmId],
    queryFn: () => fetchFarm(farmId),
    enabled: Boolean(farmId),
  });

  const farm = query.data;
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";

  return (
    <div className="card">
      <div className="kicker">Personal result</div>
      <p className="meta">
        <Link to="/">← Back to leaderboard</Link>
      </p>
      {query.isLoading && <p className="muted">Loading…</p>}
      {query.isError && <p className="flash err">{(query.error as Error).message}</p>}
      {farm && (
        <>
          <h2 style={{ fontFamily: "Fraunces, Georgia, serif", margin: "8px 0 16px" }}>
            {farm.name || "Unnamed farm"}
          </h2>
          <div className="stats">
            <div className="stat">
              <span className="muted">Farm ID</span>
              <b className="farm-id">{farm.farm_id}</b>
            </div>
            <div className="stat">
              <span className="muted">Rank</span>
              <b>{farm.rank ?? "—"}</b>
            </div>
            <div className="stat">
              <span className="muted">Digs to 3rd Otter Pebble</span>
              <b>{farm.digs_to_third_op ?? "—"}</b>
            </div>
            <div className="stat">
              <span className="muted">Otter Pebbles</span>
              <b>{farm.otter_count}/3</b>
            </div>
            <div className="stat">
              <span className="muted">Digs today</span>
              <b>{farm.digs_today}</b>
            </div>
            <div className="stat">
              <span className="muted">Status</span>
              <b>
                <span className={`badge ${farm.status}`}>{statusLabel(farm.status)}</span>
              </b>
            </div>
            <div className="stat">
              <span className="muted">Last updated</span>
              <b>{formatWhen(farm.last_updated_at)}</b>
            </div>
          </div>
          <p className="meta">Share this result: {shareUrl}</p>
        </>
      )}
    </div>
  );
}
