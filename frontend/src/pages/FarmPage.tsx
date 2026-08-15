import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchFarm } from "../api/public";
import { Pebbles } from "../components/Pebbles";
import { writeFollowedFarm } from "../lib/followFarm";
import { formatRelative, formatWhenUtc, statusLabel } from "../lib/format";

export function FarmPage() {
  const { farmId = "" } = useParams();
  const [copied, setCopied] = useState(false);
  const query = useQuery({
    queryKey: ["farm", farmId],
    queryFn: () => fetchFarm(farmId),
    enabled: Boolean(farmId),
  });

  useEffect(() => {
    if (farmId) writeFollowedFarm(farmId);
  }, [farmId]);

  const farm = query.data;
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="card farm-sheet">
      <div className="kicker">Personal result</div>
      <p className="meta">
        <Link to="/">← Back to leaderboard</Link>
      </p>
      {query.isLoading && (
        <div className="skeleton-stack" aria-hidden>
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}
      {query.isError && <p className="flash err">{(query.error as Error).message}</p>}
      {farm && (
        <>
          <div className="farm-hero">
            <div>
              <h2>{farm.name || "Unnamed farm"}</h2>
              <p className="farm-id">{farm.farm_id}</p>
            </div>
            <div className="farm-hero-score">
              <span className="muted">Official score</span>
              <b>{farm.digs_to_third_op ?? "—"}</b>
              <span className="muted">digs to 3rd OP</span>
            </div>
          </div>
          <Pebbles count={farm.otter_count} size="md" />
          <div className="stats farm-stats">
            <div className="stat">
              <span className="muted">Rank</span>
              <b>{farm.rank ?? "—"}</b>
            </div>
            <div className="stat">
              <span className="muted">Status</span>
              <b>
                <span className={`badge ${farm.status}`}>{statusLabel(farm.status)}</span>
              </b>
            </div>
            <div className="stat">
              <span className="muted">Digs today</span>
              <b>{farm.digs_today}</b>
            </div>
            <div className="stat">
              <span className="muted">Updated</span>
              <b>
                {formatRelative(farm.last_updated_at)}
                <span className="stat-sub">{formatWhenUtc(farm.last_updated_at)}</span>
              </b>
            </div>
          </div>
          <div className="share-row">
            <p className="meta">Share this result</p>
            <button className="btn primary" type="button" onClick={() => void copyLink()}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
