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
import {
  liveTournamentsSoonestFirst,
  pastTournaments,
  upcomingTournaments,
} from "../lib/board";
import { useFarmSession } from "../lib/farmSession";
import {
  formatDateUtc,
  formatDurationDays,
  formatScore,
  inclusiveFinalDayIso,
  opensLabel,
  remainingLabel,
  statusLabel,
  windowStatusLabel,
} from "../lib/format";

/** Ranked standings entries used for the detail winners strip / modal. */
export function rankedWinners(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return entries.filter((row) => row.rank != null);
}

/** Top 1st/2nd/3rd strip only when there are multiple winners. */
export function showWinnersStrip(entries: LeaderboardEntry[]): boolean {
  return rankedWinners(entries).length >= 2;
}

/** “View all winners” only when there are more than three ranked entries. */
export function showViewAllWinners(entries: LeaderboardEntry[]): boolean {
  return rankedWinners(entries).length > 3;
}

const LONG_REWARD_CHARS = 28;

export function isLongRewardText(item: PrizePlace): boolean {
  const flower = `${item.amount} Flower`;
  const full = item.nft_name ? `${flower} ${item.nft_name}` : flower;
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

function PrizePlaceCard({ item }: { item: PrizePlace }) {
  const placeClass =
    item.place === 1 ? "place-1" : item.place === 2 ? "place-2" : item.place === 3 ? "place-3" : "";
  const long = isLongRewardText(item);
  return (
    <div
      className={`prize-place-card ${placeClass}`}
      data-testid={`prize-place-card-${item.place}`}
    >
      <div className="prize-place-ordinal">
        {item.place}
        {placeSuffix(item.place)}
      </div>
      <div
        className={`prize-place-reward${long ? " is-long" : ""}`}
        data-testid={`prize-place-reward-${item.place}`}
      >
        <div className="prize-place-amount">{item.amount} Flower</div>
        {item.nft_name ? <div className="prize-place-nft">{item.nft_name}</div> : null}
      </div>
    </div>
  );
}

function islandLabel(island: string | null | undefined): string {
  if (!island) return "None";
  if (island === "volcano+") return "Volcano+";
  return island.charAt(0).toUpperCase() + island.slice(1);
}

function joinedTotal(
  enrolled: number | null | undefined,
  max: number | null | undefined,
  fallback = 0,
): string {
  const joined = enrolled ?? fallback;
  return `${joined}/${max == null ? "None" : max}`;
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
          <dd>{joinedTotal(row.enrolled_count, row.max_players, row.count)}</dd>
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
  const [winnersOpen, setWinnersOpen] = useState(false);
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
  const winners = data ? rankedWinners(data.entries) : [];
  const winnersStrip = data ? showWinnersStrip(data.entries) : false;
  const viewAllWinners = data ? showViewAllWinners(data.entries) : false;
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
                {formatDateUtc(data.config.start_at)} –{" "}
                {formatDateUtc(
                  inclusiveFinalDayIso(data.config.start_at, data.config.duration_days),
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
          <div className="tourney-facts tourney-facts-compact">
            <div data-testid="tournament-start-day">
              <span className="muted">Start day</span>
              <b>{formatDateUtc(data.config.start_at)}</b>
            </div>
            <div data-testid="tournament-final-day">
              <span className="muted">Final day</span>
              <b>
                {formatDateUtc(
                  inclusiveFinalDayIso(data.config.start_at, data.config.duration_days),
                )}
              </b>
            </div>
            <div data-testid="tournament-participants">
              <span className="muted">Participants</span>
              <b>
                {joinedTotal(data.config.enrolled_count, data.config.max_players, data.count)}
              </b>
            </div>
            <div data-testid="tournament-island">
              <span className="muted">Min bumpkin island</span>
              <b>{islandLabel(data.config.min_bumpkin_island)}</b>
            </div>
            <div data-testid="tournament-streak">
              <span className="muted">Min digging streak</span>
              <b>
                {data.config.min_digging_streak == null ? "None" : data.config.min_digging_streak}
              </b>
            </div>
            <div data-testid="tournament-vip">
              <span className="muted">VIP status</span>
              <b>{data.config.vip_required ? "Yes" : "No"}</b>
            </div>
            <div data-testid="tournament-prize">
              <span className="muted">Prize pool</span>
              <b>{data.config.prize_amount} Flower</b>
            </div>
            <div data-testid="tournament-join-mode">
              <span className="muted">Approval</span>
              <b>{autoJoin ? "No" : "Yes"}</b>
            </div>
          </div>
          {data.config.prize_places && data.config.prize_places.length > 0 ? (
            <div className="prize-place-section" data-testid="tournament-prize-places">
              <div className="prize-place-cards">
                {data.config.prize_places.slice(0, 3).map((item) => (
                  <PrizePlaceCard key={item.place} item={item} />
                ))}
              </div>
              {data.config.prize_places.length > 3 ? (
                <button
                  className="prize-more"
                  type="button"
                  data-testid="tournament-more-prizes"
                  onClick={() => setPrizesOpen(true)}
                >
                  More prizes
                </button>
              ) : null}
            </div>
          ) : null}
          {prizesOpen && data.config.prize_places && data.config.prize_places.length > 3 ? (
            <div
              className="confirm-overlay"
              data-testid="tournament-prize-table"
              role="dialog"
              aria-modal="true"
            >
              <div className="confirm-card prize-table-card">
                <p className="confirm-title">Prizes</p>
                <table className="prize-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Prize</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.config.prize_places.map((item) => (
                      <tr key={item.place}>
                        <td>
                          {item.place}
                          {placeSuffix(item.place)}
                        </td>
                        <td>
                          {item.amount} Flower
                          {item.nft_name ? ` · ${item.nft_name}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="toolbar confirm-actions">
                  <button className="btn" type="button" onClick={() => setPrizesOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
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
          {winnersStrip ? (
            <section className="tournament-winners" data-testid="tournament-winners">
              <div className="tournament-winners-head">
                <h2 className="tournament-winners-title">Winners</h2>
                {viewAllWinners ? (
                  <button
                    className="prize-more"
                    type="button"
                    data-testid="view-all-winners"
                    onClick={() => setWinnersOpen(true)}
                  >
                    View all winners
                  </button>
                ) : null}
              </div>
              <Podium entries={data.entries} tournamentId={tournamentId} />
            </section>
          ) : null}
          {winnersOpen && viewAllWinners ? (
            <div
              className="confirm-overlay"
              data-testid="tournament-winners-modal"
              role="dialog"
              aria-modal="true"
            >
              <div className="confirm-card winners-modal-card">
                <p className="confirm-title">Winners</p>
                <table className="prize-table winners-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Farm</th>
                      <th>Total</th>
                      <th>Today</th>
                      <th>Pebbles</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {winners.map((row) => (
                      <tr key={row.farm_id}>
                        <td>{row.rank ?? "—"}</td>
                        <td>
                          <Link
                            to={`/tournaments/${encodeURIComponent(tournamentId)}/farm/${row.farm_id}`}
                          >
                            {row.name || "Unnamed farm"}
                          </Link>
                        </td>
                        <td>{row.digs_to_third_op ?? "—"}</td>
                        <td>{row.score_today ?? "—"}</td>
                        <td>{row.otter_count}</td>
                        <td>{statusLabel(row.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="toolbar confirm-actions">
                  <button className="btn" type="button" onClick={() => setWinnersOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          ) : null}
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
