import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  fetchTournament,
  listTournaments,
  submitFarm,
  type LeaderboardEntry,
  type PrizePlace,
  type TournamentSummary,
} from "../api/public";
import { DownloadBoardButton } from "../components/DownloadBoardButton";
import { Pebbles } from "../components/Pebbles";
import { Podium } from "../components/Podium";
import { tournamentBackTarget } from "../lib/backTarget";
import { liveTournamentsSoonestFirst, pastTournaments, upcomingTournaments } from "../lib/board";
import { useFarmSession } from "../lib/farmSession";
import { addRequestedTournamentId, hasRequestedTournament } from "../lib/followFarm";
import {
  formatDateUtc,
  formatDetailDateRangeUtc,
  formatDurationDays,
  formatScore,
  inclusiveFinalDayIso,
  isZeroFlowerAmount,
  joinedCountLabel,
  opensLabel,
  remainingLabel,
  statusLabel,
  windowStatusLabel,
} from "../lib/format";

/** Ranked standings used for the farm podium. */
export function rankedWinners(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return entries.filter((row) => row.rank != null);
}

/** Farm podium (1st/2nd/3rd) only when there are multiple ranked players. */
export function showWinnersStrip(entries: LeaderboardEntry[]): boolean {
  return rankedWinners(entries).length >= 2;
}

/** Prize rows for the details card (1st–3rd on the card; extras in view prices). */
export function displayPrizePlaces(
  places: PrizePlace[] | null | undefined,
  prizeAmount: string | null | undefined,
): PrizePlace[] {
  const sorted = [...(places ?? [])].sort((a, b) => a.place - b.place);
  if (sorted.length > 0) return sorted;
  const amount = (prizeAmount ?? "").trim();
  return amount ? [{ place: 1, amount }] : [];
}

/** Extra-places control only when the event has more than three prize places. */
export function showMorePrizes(places: PrizePlace[] | null | undefined): boolean {
  return (places?.length ?? 0) > 3;
}

const LONG_REWARD_CHARS = 28;

export function isLongRewardText(item: PrizePlace): boolean {
  const flower = flowerReward(item.amount);
  const nft = item.nft_name?.trim() || "";
  const full = [flower, nft].filter(Boolean).join(" ");
  return full.length > LONG_REWARD_CHARS;
}

function placeSuffix(place: number): string {
  if (place === 1) return "st";
  if (place === 2) return "nd";
  if (place === 3) return "rd";
  return "th";
}

function formatPrizePlace(item: PrizePlace): string {
  const flower = `${item.place}${placeSuffix(item.place)} ${item.amount} Flower`;
  return item.nft_name ? `${flower} · ${item.nft_name}` : flower;
}

function flowerReward(amount: string | null | undefined): string | null {
  const raw = (amount ?? "").trim();
  if (!raw || isZeroFlowerAmount(raw)) return null;
  return `${raw} $Flower`;
}

function medalTone(place: number): string {
  if (place === 1) return "gold";
  if (place === 2) return "silver";
  if (place === 3) return "bronze";
  return "";
}

function MedalRow({ item }: { item: PrizePlace }) {
  const long = isLongRewardText(item);
  const flower = flowerReward(item.amount);
  const nft = item.nft_name?.trim() || null;
  return (
    <div
      className={`medal prize-place-card ${medalTone(item.place)}`}
      data-testid={`prize-place-card-${item.place}`}
    >
      <div className="medal-dot">{item.place}</div>
      <div className="medal-rank">
        {item.place}
        {placeSuffix(item.place)}
      </div>
      <div
        className={`prize-place-reward${long ? " is-long" : ""}`}
        data-testid={`prize-place-reward-${item.place}`}
      >
        {flower ? <div className="prize-place-amount">{flower}</div> : null}
        {nft ? <div className="prize-place-nft">{nft}</div> : null}
        {!flower && !nft ? <span className="medal-tbd">—</span> : null}
      </div>
    </div>
  );
}

function StatGlyph({ kind }: { kind: "people" | "island" | "streak" | "vip" | "approval" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {kind === "people" ? (
        <>
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87" />
          <path d="M16 3.13a4 4 0 010 7.75" />
        </>
      ) : null}
      {kind === "island" ? <path d="M12 2l9 4.5v9L12 20l-9-4.5v-9L12 2z" /> : null}
      {kind === "streak" ? <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" /> : null}
      {kind === "vip" ? (
        <path d="M12 17.75l-6.16 3.24 1.18-6.88L2 9.24l6.92-1.01L12 2l3.08 6.23L22 9.24l-5.02 4.87 1.18 6.88z" />
      ) : null}
      {kind === "approval" ? (
        <>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </>
      ) : null}
    </svg>
  );
}

function islandLabel(island: string | null | undefined): string {
  if (!island) return "None";
  if (island === "volcano+") return "Volcano+";
  return island.charAt(0).toUpperCase() + island.slice(1);
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
        {formatDateUtc(row.start_at)} –{" "}
        {formatDateUtc(inclusiveFinalDayIso(row.start_at, row.duration_days))}
        {when ? ` · ${when}` : ""}
      </p>
      {row.description ? (
        <p className="window-card-desc" data-testid={`tourney-desc-${row.tournament_id}`}>
          {row.description}
        </p>
      ) : null}
      <dl className="window-card-facts">
        <div data-testid={`tourney-participants-${row.tournament_id}`}>
          <dt>Joined</dt>
          <dd>{joinedCountLabel(row.enrolled_count, row.max_players, row.count, true)}</dd>
        </div>
        <div data-testid={`tourney-island-${row.tournament_id}`}>
          <dt>Island</dt>
          <dd>{islandLabel(row.min_bumpkin_island)}</dd>
        </div>
        <div data-testid={`tourney-streak-${row.tournament_id}`}>
          <dt>Streak</dt>
          <dd>{row.min_digging_streak == null ? "None" : row.min_digging_streak}</dd>
        </div>
        <div data-testid={`tourney-vip-${row.tournament_id}`}>
          <dt>VIP</dt>
          <dd>{row.vip_required ? "Yes" : "No"}</dd>
        </div>
      </dl>
      {row.prize_places && row.prize_places.length > 0 ? (
        <p className="window-card-prizes" data-testid={`tourney-prizes-${row.tournament_id}`}>
          {row.prize_places.slice(0, 3).map(formatPrizePlace).join(" · ")}
          {row.prize_places.length > 3 ? " · more" : ""}
        </p>
      ) : (
        <p className="window-card-prizes" data-testid={`tourney-prizes-${row.tournament_id}`}>
          {row.prize_amount} Flower
        </p>
      )}
    </Link>
  );
}

function TournamentDetail({ tournamentId }: { tournamentId: string }) {
  const { identity } = useFarmSession();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const back = tournamentBackTarget(from);
  const [notice, setNotice] = useState<string | null>(null);
  const [prizesOpen, setPrizesOpen] = useState(false);
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
      if (identity) addRequestedTournamentId(identity.farm_id, tournamentId);
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
  const places = displayPrizePlaces(data?.config.prize_places, data?.config.prize_amount);
  const morePrizes = showMorePrizes(places);
  const winnersStrip = data ? showWinnersStrip(data.entries) : false;
  const vipOn = Boolean(data?.config.vip_required);
  const needsApproval = !autoJoin;
  const alreadyEnrolled = Boolean(
    identity && data?.entries.some((row) => row.farm_id === identity.farm_id),
  );
  const alreadyRequested = Boolean(
    identity && hasRequestedTournament(identity.farm_id, tournamentId),
  );
  const showJoinCta =
    joinable && Boolean(identity) && !alreadyEnrolled && !alreadyRequested && !join.isSuccess;
  return (
    <section className="page-inner tournament-detail" data-testid="tournament-detail">
      <div className="detail-chrome">
        <Link to={back.to} className="detail-crumb" data-testid="back-link">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {back.label}
        </Link>
        {data ? (
          <DownloadBoardButton
            name={data.config.name || "Tournament"}
            startAt={data.config.start_at}
            endAt={data.config.end_at}
            durationDays={data.config.duration_days}
            prizeAmount={data.config.prize_amount}
            entries={data.entries}
            totalCount={data.count}
          />
        ) : null}
      </div>
      {query.isLoading && <p className="muted">Loading tournament…</p>}
      {query.isError && <p className="flash err">{(query.error as Error).message}</p>}
      {data && (
        <>
          <div className="detail-panel">
            <div className="detail-content">
              <div className="detail-title-row">
                <div className="detail-title-block">
                  <h1>{data.config.name || "Tournament"}</h1>
                  <div className="detail-range" data-testid="tournament-window">
                    {formatDetailDateRangeUtc(
                      data.config.start_at,
                      inclusiveFinalDayIso(data.config.start_at, data.config.duration_days),
                    )}
                  </div>
                </div>
              </div>
              {data.config.description ? (
                <p className="tourney-description" data-testid="tournament-description">
                  {data.config.description}
                </p>
              ) : null}
              <div className="detail-body-grid" data-testid="tournament-detail-body">
                <div className="winners-card" data-testid="tournament-prizes">
                  <div className="winners-head">
                    <span className="lbl" data-testid="prize-place-count">
                      Prizes
                    </span>
                    <span className="pool" data-testid="tournament-prize">
                      {data.config.prize_amount} $Flower
                    </span>
                  </div>
                  {places.length > 0 ? (
                    <div className="medals" data-testid="tournament-prize-places">
                      {places.slice(0, 3).map((item) => (
                        <MedalRow key={item.place} item={item} />
                      ))}
                    </div>
                  ) : null}
                  {morePrizes ? (
                    <button
                      className="view-all-winners"
                      type="button"
                      data-testid="tournament-more-prizes"
                      onClick={() => setPrizesOpen(true)}
                    >
                      view prices
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  ) : null}
                </div>
                <div className="detail-stat-list">
                  <div className="detail-stat" data-testid="tournament-participants">
                    <div className="lbl">
                      <StatGlyph kind="people" />
                      Participants
                    </div>
                    <div className="val">
                      {joinedCountLabel(
                        data.config.enrolled_count,
                        data.config.max_players,
                        data.count,
                      )}
                    </div>
                  </div>
                  <div className="detail-stat" data-testid="tournament-island">
                    <div className="lbl">
                      <StatGlyph kind="island" />
                      Min island
                    </div>
                    <div className="val">{islandLabel(data.config.min_bumpkin_island)}</div>
                  </div>
                  <div className="detail-stat" data-testid="tournament-streak">
                    <div className="lbl">
                      <StatGlyph kind="streak" />
                      Min dig streak
                    </div>
                    <div className="val">
                      {data.config.min_digging_streak == null
                        ? "None"
                        : data.config.min_digging_streak}
                    </div>
                  </div>
                  <div className="detail-stat" data-testid="tournament-vip">
                    <div className="lbl">
                      <StatGlyph kind="vip" />
                      VIP status
                    </div>
                    <div className={`val ${vipOn ? "yes" : "no"}`}>{vipOn ? "Yes" : "No"}</div>
                  </div>
                  <div className="detail-stat span2" data-testid="tournament-join-mode">
                    <div className="lbl">
                      <StatGlyph kind="approval" />
                      Needs approval
                    </div>
                    <div className={`val ${needsApproval ? "yes" : "no"}`}>
                      {needsApproval ? "Yes" : "No"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {prizesOpen && morePrizes ? (
            <div
              className="confirm-overlay"
              data-testid="tournament-prizes-modal"
              role="dialog"
              aria-modal="true"
            >
              <div className="confirm-card winners-modal-card">
                <p className="confirm-title">Prizes</p>
                <div className="medals winners-modal-medals">
                  {places.map((item) => (
                    <MedalRow key={item.place} item={item} />
                  ))}
                </div>
                <div className="toolbar confirm-actions">
                  <button className="btn" type="button" onClick={() => setPrizesOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {joinable && identity && notice ? (
            <div className={`flash ${join.isSuccess ? "ok" : "err"}`}>{notice}</div>
          ) : null}
          {showJoinCta && identity ? (
            <div className="join-detail" data-testid="join-detail">
              <p className="meta join-hint" data-testid="join-copy">
                {autoJoin
                  ? "You'll be enrolled immediately."
                  : "An admin will approve your join request."}
              </p>
              <p className="meta join-hint">
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
          ) : null}
          {joinable && !identity && (
            <p className="meta join-hint" data-testid="join-need-connect">
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
          {winnersStrip ? (
            <section className="tournament-winners" data-testid="tournament-winners">
              <Podium entries={data.entries} tournamentId={tournamentId} />
            </section>
          ) : null}
          {data.entries.length > 0 && (
            <div className="table-wrap detail-standings" data-testid="detail-standings">
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
                  {data.entries.map((row) => {
                    const isYou = identity?.farm_id === row.farm_id;
                    return (
                      <tr
                        key={row.farm_id}
                        className={[
                          row.rank === 1 || row.rank === 2 || row.rank === 3
                            ? `rank-${row.rank}`
                            : "",
                          isYou ? "is-you" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <td className={`rank ${row.rank ? `r${row.rank}` : ""}`}>
                          {row.rank ?? "—"}
                        </td>
                        <td>
                          <Link
                            to={`/tournaments/${encodeURIComponent(tournamentId)}/farm/${row.farm_id}`}
                          >
                            {row.name || "Unnamed farm"}
                            {isYou ? <span className="you-tag">You</span> : null}
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
