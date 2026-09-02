import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LeaderboardEntry } from "../api/public";
import type { AvatarFields } from "../lib/avatars";
import { FarmAvatar } from "./FarmAvatar";
import { Pebbles } from "./Pebbles";
import { formatDateUtc, formatRelative, formatScore, formatWhenUtc, statusLabel, AVG_SCORE_LABEL } from "../lib/format";

export function FarmResult({
  farm,
  avatarTo,
  avatarState,
  shareUrl,
}: {
  farm: LeaderboardEntry;
  avatarTo?: string;
  avatarState?: unknown;
  shareUrl?: string;
}) {
  const [copied, setCopied] = useState(false);
  const href =
    shareUrl ?? (typeof window !== "undefined" ? window.location.href : "");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const avatar = (
    <FarmAvatar fields={farm} fallbackTone="farm" className="farm-page-avatar" alt="" />
  );

  return (
    <>
      <div className="farm-hero">
        {avatarTo ? (
          <Link
            to={avatarTo}
            state={avatarState}
            className="avatar-edit-link"
            data-testid="edit-avatar"
            aria-label="Edit profile picture"
          >
            {avatar}
          </Link>
        ) : (
          avatar
        )}
        <div>
          <h2 data-testid="profile-name">{farm.name || "Unnamed farm"}</h2>
          <p className="farm-id" data-testid="profile-farm-id">
            {farm.farm_id}
          </p>
        </div>
        <div className="farm-hero-score">
          <span className="muted">Total score</span>
          <b data-testid="farm-total">{farm.digs_to_third_op ?? "—"}</b>
        </div>
      </div>
      <Pebbles count={farm.otter_count} size="md" />
      <div className="stats farm-stats" data-testid="farm-score-facts">
        <div className="farm-avg-row" data-testid="farm-pebble-averages">
          <div className="stat">
            <span className="muted">{AVG_SCORE_LABEL}</span>
            <b data-testid="farm-average">{formatScore(farm.score)}</b>
          </div>
          <div className="stat stat-pebble">
            <span className="muted">1st pebble avg</span>
            <b data-testid="farm-first-average">{formatScore(farm.score_first_op)}</b>
          </div>
          <div className="stat stat-pebble">
            <span className="muted">2nd pebble avg</span>
            <b data-testid="farm-second-average">{formatScore(farm.score_second_op)}</b>
          </div>
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
  );
}

export function FarmResultFallback({
  name,
  farmId,
  avatarFields,
  avatarTo,
  avatarState,
}: {
  name: string;
  farmId: string;
  avatarFields?: AvatarFields | null;
  avatarTo?: string;
  avatarState?: unknown;
}) {
  const avatar = (
    <FarmAvatar fields={avatarFields} fallbackTone="farm" className="farm-page-avatar" alt="" />
  );
  let picture: ReactNode = avatar;
  if (avatarTo) {
    picture = (
      <Link
        to={avatarTo}
        state={avatarState}
        className="avatar-edit-link"
        data-testid="edit-avatar"
        aria-label="Edit profile picture"
      >
        {avatar}
      </Link>
    );
  }
  return (
    <div className="farm-hero">
      {picture}
      <div>
        <h2 data-testid="profile-name">{name || "Unnamed farm"}</h2>
        <p className="farm-id" data-testid="profile-farm-id">
          {farmId}
        </p>
      </div>
    </div>
  );
}
