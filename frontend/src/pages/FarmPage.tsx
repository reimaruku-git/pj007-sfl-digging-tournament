import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchFarm, fetchTournamentFarm } from "../api/public";
import { Pebbles } from "../components/Pebbles";
import { farmBackTarget } from "../lib/backTarget";
import { formatDateUtc, formatRelative, formatScore, formatWhenUtc, statusLabel } from "../lib/format";

export function FarmPage() {
  const { farmId = "", tournamentId } = useParams();
  const [copied, setCopied] = useState(false);
  const query = useQuery({
    queryKey: tournamentId ? ["farm", tournamentId, farmId] : ["farm", farmId],
    queryFn: () =>
      tournamentId ? fetchTournamentFarm(tournamentId, farmId) : fetchFarm(farmId),
    enabled: Boolean(farmId),
  });

  const farm = query.data;
  const back = farmBackTarget(tournamentId);
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
        <Link to={back.to} data-testid="back-link">
          ← {back.label}
        </Link>
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
              <span className="muted">Total score</span>
              <b data-testid="farm-total">{farm.digs_to_third_op ?? "—"}</b>
            </div>
          </div>
          <Pebbles count={farm.otter_count} size="md" />
          <div className="stats farm-stats" data-testid="farm-score-facts">
            <div className="stat">
              <span className="muted">Average per day</span>
              <b data-testid="farm-average">{formatScore(farm.score)}</b>
            </div>
            <div className="stat">
              <span className="muted">Score today</span>
              <b data-testid="farm-score-today">{farm.score_today ?? "—"}</b>
            </div>
            <div className="stat">
              <span className="muted">Pebbles today</span>
              <b data-testid="farm-pebbles-today">{farm.otter_count}</b>
            </div>
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
              <span className="muted">Updated</span>
              <b>
                {formatRelative(farm.last_updated_at)}
                <span className="stat-sub">{formatWhenUtc(farm.last_updated_at)}</span>
              </b>
            </div>
          </div>
          {(farm.days ?? []).length > 0 && (
            <section className="farm-days" data-testid="farm-days">
              <h3>Tournament days</h3>
              <ul>
                {(farm.days ?? []).map((row) => (
                  <li key={row.day} data-testid={`farm-day-${row.day}`}>
                    <div>
                      <b>{formatDateUtc(`${row.day}T00:00:00+00:00`)}</b>
                      <span className={`badge ${row.status}`}>{statusLabel(row.status)}</span>
                    </div>
                    <div className="farm-day-score">
                      <span>{row.digs_to_third_op ?? "—"} digs</span>
                      <span className="muted">{row.otter_count}/3 pebbles</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
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
