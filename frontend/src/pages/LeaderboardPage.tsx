import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  fetchFarm,
  fetchTournament,
  listTournaments,
  type LeaderboardEntry,
  type TournamentSummary,
} from "../api/public";
import { ColorCanvas, farmCanvasTone } from "../components/ColorCanvas";
import { FarmAvatar } from "../components/FarmAvatar";
import { HeroLayerStack } from "../components/HeroLayerStack";
import { Pebbles } from "../components/Pebbles";
import { Podium } from "../components/Podium";
import {
  featuredHomeTournament,
  homeBoardRows,
  nextColumnSort,
  type StandingsColumn,
  type StandingsSort,
} from "../lib/board";
import { useFarmSession } from "../lib/farmSession";
import {
  AVG_SCORE_LABEL,
  formatScore,
  formatTopPrize,
  formatWindowRange,
  inclusiveFinalDayIso,
  opensLabel,
  remainingLabel,
  statusLabel,
} from "../lib/format";
import { msUntilNextSync } from "../lib/schedule";

const RULES = [
  {
    label: "Shovel",
    body: "Counts as 1 dig",
  },
  {
    label: "Drill",
    body: "Counts as 4 digs. If you find an Otter Pebble with a Drill, it counts as the last dig of those 4. Example: After 5 shovel digs, using a Drill makes digs 6-7-8-9. The pebble is found on dig 9.",
  },
  {
    label: "Score",
    body: "Your score is the average number of digs it took to find the 3rd Otter Pebble, only on days that already have a recorded score. Missed days keep whatever score was recorded (including the unfinished penalty). Lower average is better.",
  },
  {
    label: "Refresh",
    body: "14:00, 16:00, 18:00, 20:00, 23:00 UTC. Digs after 23:00 UTC do not count",
  },
  {
    label: "Unfinished",
    body: "Score = (worst finisher that day or 30, whichever is higher) + 5 for every missing pebble. Missing 2nd and 1st pebbles become that score minus 1 and minus 2 unless you already found them. This number is permanent and still goes into your average. SO DIG!",
  },
  {
    label: "Ties",
    body: "Average of 3rd pebble, then 2nd, then 1st. If still tied → earlier time on the 3rd pebble, then 2nd, then 1st.",
  },
] as const;

export function LeaderboardPage() {
  const { identity } = useFarmSession();
  const mine = identity?.farm_id ?? "";
  const [sort, setSort] = useState<StandingsSort>(null);

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

  const featured = useMemo(
    () =>
      featuredHomeTournament(
        catalog.data?.tournaments ?? [],
        catalog.data?.featured_tournament_id,
      ),
    [catalog.data],
  );

  const board = useQuery({
    queryKey: ["tournament", featured?.tournament_id],
    queryFn: () => fetchTournament(featured!.tournament_id),
    enabled: Boolean(featured?.tournament_id),
  });

  const mineFarm = useQuery({
    queryKey: ["farm", mine],
    queryFn: () => fetchFarm(mine),
    enabled: Boolean(mine),
  });

  const featuredEntries = board.data?.entries ?? [];
  const you =
    featuredEntries.find((row) => row.farm_id === mine) ??
    (mineFarm.data?.farm_id === mine ? mineFarm.data : undefined);

  return (
    <>
      <Hero featured={featured} loading={catalog.isLoading} error={catalog.error as Error | undefined} />

      <div className="page-inner">
        {featured && (
          <LiveEventBand
            tournament={featured}
            entries={featuredEntries}
            loading={board.isLoading}
            error={board.error as Error | undefined}
            sort={sort}
            onSort={setSort}
            mine={mine}
            you={identity ? you : undefined}
            youName={identity?.name}
            youLoading={board.isLoading || mineFarm.isLoading}
          />
        )}
        {!catalog.isLoading && !featured && (
          <p className="muted" data-testid="no-live">
            No live tournament yet.
          </p>
        )}
        {identity && !featured && (
          <YouFarmCard
            farmId={identity.farm_id}
            name={identity.name}
            farm={you}
            loading={mineFarm.isLoading}
          />
        )}
        <RulesBand />
      </div>
    </>
  );
}

function HeroArt({
  src,
  layers,
}: {
  src?: string | null;
  layers?: TournamentSummary["hero_layers"];
}) {
  return (
    <HeroLayerStack
      className="live-hero-art"
      src={src}
      layers={layers}
      imageClassName="tournament-hero-image"
      imageTestId="home-hero-image"
    />
  );
}

function ThumbArt({ src }: { src?: string | null }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    if (!src) {
      setReady(false);
      return;
    }
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) {
      setReady(true);
      return;
    }
    setReady(false);
  }, [src]);
  return (
    <div className="now-digging-art">
      <ColorCanvas tone="thumb" />
      {src ? (
        <img
          ref={imgRef}
          src={src}
          alt=""
          className={ready ? "tournament-thumb-image is-ready" : "tournament-thumb-image"}
          data-testid="now-digging-image"
          onLoad={() => setReady(true)}
        />
      ) : null}
    </div>
  );
}

function Hero({
  featured,
  loading,
  error,
}: {
  featured: TournamentSummary | null;
  loading: boolean;
  error?: Error;
}) {
  const href = featured ? `/tournaments/${encodeURIComponent(featured.tournament_id)}` : "";
  const windowCopy = featured
    ? formatWindowRange(
        featured.start_at,
        inclusiveFinalDayIso(featured.start_at, featured.duration_days),
      )
    : "";
  const eyebrow = featured
    ? `${
        featured.status === "ended"
          ? "Past tournament"
          : featured.status === "scheduled"
            ? "Upcoming tournament"
            : "Live tournament"
      } · ${windowCopy}`
    : "Live tournament";
  return (
    <section className="live-hero" data-testid="home-hero">
      <HeroArt src={featured?.image_2_url} layers={featured?.hero_layers} />
      <div className="live-hero-inner">
        <div className="hero-copy" data-testid="hero-copy">
          <p className="hero-eyebrow">{eyebrow}</p>
          {featured ? (
            <h2 className="hero-title" data-testid="featured-title">
              {featured.name}
            </h2>
          ) : (
            <h2 className="hero-title">Three Otter Pebbles. Fewest digs wins.</h2>
          )}
          <p className="hero-lead">
            Get the 3 Otter Pebbles in as few digs as possible. Digs after the 3rd pebble do not
            affect your score.
          </p>
        </div>
        <div className="hero-actions">
          <Link to="/tournaments" className="btn primary" data-testid="see-tournaments">
            See tournaments
          </Link>
          <a href="#standings" className="btn ghost">
            Standings
          </a>
        </div>
        {error && <p className="flash err">{error.message}</p>}
        {loading && !featured && <p className="muted">Loading live tournament…</p>}
        {!loading && !featured && !error && (
          <p className="muted">No live tournament right now. See upcoming tournaments.</p>
        )}
        {featured && (
          <Link to={href} className="now-digging-link" data-testid="featured-now-link">
            <NowDigging featured={featured} />
          </Link>
        )}
      </div>
    </section>
  );
}

function NowDigging({ featured }: { featured: TournamentSummary }) {
  const lastDay = inclusiveFinalDayIso(featured.start_at, featured.duration_days);
  const remaining =
    featured.status === "scheduled"
      ? opensLabel(featured.start_at)
      : remainingLabel(lastDay, new Date(), featured.status);
  const windowCopy = formatWindowRange(featured.start_at, lastDay);
  return (
    <div className="now-digging" data-testid="now-digging">
      <ThumbArt src={featured.image_1_url} />
      <div className="now-digging-copy">
        <div className="kicker">{featured.status === "scheduled" ? "Up next" : "Now digging"}</div>
        <div className="now-digging-name">{featured.name}</div>
        <p className="meta">
          {windowCopy}
          {remaining ? ` · ${remaining}` : ""}
        </p>
      </div>
      <dl className="now-digging-stats">
        <div>
          <dt>{featured.status === "scheduled" ? "Opens" : "Remaining"}</dt>
          <dd data-testid="hero-remaining">{remaining}</dd>
        </div>
        <div>
          <dt>Top Prize</dt>
          <dd data-testid="hero-prize">
            {formatTopPrize(featured.prize_amount, featured.prize_places)}
          </dd>
        </div>
        <div>
          <dt>Farms</dt>
          <dd data-testid="hero-farms">{featured.count}</dd>
        </div>
      </dl>
    </div>
  );
}

function LiveEventBand({
  tournament,
  entries,
  loading,
  error,
  sort,
  onSort,
  mine,
  you,
  youName,
  youLoading,
}: {
  tournament: TournamentSummary;
  entries: LeaderboardEntry[];
  loading: boolean;
  error?: Error;
  sort: StandingsSort;
  onSort: (next: StandingsSort) => void;
  mine: string;
  you?: LeaderboardEntry;
  youName?: string;
  youLoading?: boolean;
}) {
  const rows = homeBoardRows(entries, sort, mine);
  const standingsHref = `/tournaments/${encodeURIComponent(tournament.tournament_id)}`;
  return (
    <div
      id={`live-${tournament.tournament_id}`}
      className="live-event"
      data-testid={`live-board-${tournament.tournament_id}`}
    >
      <section className="home-band" data-testid="top-three">
        {loading && (
          <div className="skeleton-stack" aria-hidden>
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        )}
        {error && <p className="flash err">{error.message}</p>}
        {!loading && entries.length === 0 && <p className="muted">No farms on this board yet.</p>}
        {entries.length > 0 && (
          <Podium entries={entries} tournamentId={tournament.tournament_id} />
        )}
      </section>

      <section className="home-band" id="standings" data-testid="standings">
        {loading && (
          <div className="skeleton-stack" aria-hidden>
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        )}
        {!loading && rows.length === 0 && <p className="muted">No farms on this board yet.</p>}
        {rows.length > 0 && (
          <>
            <StandingsTable
              rows={rows}
              mine={mine}
              tournamentId={tournament.tournament_id}
              sort={sort}
              onSort={onSort}
            />
            <Link to={standingsHref} className="detail-crumb check-standings" data-testid="check-standings">
              Check Standings &gt;
            </Link>
          </>
        )}
        {youName && (
          <YouFarmCard
            farmId={mine}
            name={youName}
            farm={you}
            loading={Boolean(youLoading)}
            tournamentId={tournament.tournament_id}
          />
        )}
      </section>
    </div>
  );
}

function sortClass(sort: StandingsSort, column: StandingsColumn) {
  if (sort?.column !== column) return "th-sort";
  return `th-sort is-${sort.dir}`;
}

function sortAria(sort: StandingsSort, column: StandingsColumn): "ascending" | "descending" | "none" {
  if (sort?.column !== column) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}

function SortHeader({
  column,
  label,
  sort,
  onSort,
}: {
  column: StandingsColumn;
  label: string;
  sort: StandingsSort;
  onSort: (next: StandingsSort) => void;
}) {
  return (
    <button
      type="button"
      className={sortClass(sort, column)}
      data-testid={`sort-${column}`}
      aria-sort={sortAria(sort, column)}
      onClick={() => onSort(nextColumnSort(sort, column))}
    >
      {label}
    </button>
  );
}

function StandingsTable({
  rows,
  mine,
  tournamentId,
  sort,
  onSort,
}: {
  rows: LeaderboardEntry[];
  mine: string;
  tournamentId: string;
  sort: StandingsSort;
  onSort: (next: StandingsSort) => void;
}) {
  return (
    <div className="board-scroll standings-panel">
      <div className="standings-sort-bar" data-testid="standings-sort">
        <SortHeader column="avg" label={AVG_SCORE_LABEL} sort={sort} onSort={onSort} />
        <SortHeader column="today" label="Today" sort={sort} onSort={onSort} />
        <SortHeader column="total" label="Total" sort={sort} onSort={onSort} />
      </div>
      <table className="board-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Farm</th>
            <th>
              <SortHeader column="total" label="Total" sort={sort} onSort={onSort} />
            </th>
            <th>
              <SortHeader column="today" label="Today" sort={sort} onSort={onSort} />
            </th>
            <th>Pebbles</th>
            <th>
              <SortHeader column="avg" label={AVG_SCORE_LABEL} sort={sort} onSort={onSort} />
            </th>
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
                <Link to={`/tournaments/${encodeURIComponent(tournamentId)}/farm/${row.farm_id}`}>
                  {row.name || "Unnamed farm"}
                  {row.farm_id === mine ? <span className="you-tag">You</span> : null}
                  <div className="farm-id">{row.farm_id}</div>
                </Link>
              </td>
              <td>{row.digs_to_third_op ?? "—"}</td>
              <td>{row.score_today ?? "—"}</td>
              <td>
                <Pebbles count={row.otter_count} />
              </td>
              <td>{formatScore(row.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="board-cards">
        {rows.map((row) => (
          <Link
            key={row.farm_id}
            to={`/tournaments/${encodeURIComponent(tournamentId)}/farm/${row.farm_id}`}
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
              <span className="muted">
                {formatScore(row.score)} {AVG_SCORE_LABEL}
              </span>
              <span className="muted">today {row.score_today ?? "—"}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function YouFarmCard({
  farmId,
  name,
  farm,
  loading,
  tournamentId,
}: {
  farmId: string;
  name: string;
  farm?: LeaderboardEntry;
  loading: boolean;
  tournamentId?: string;
}) {
  const href = tournamentId
    ? `/tournaments/${encodeURIComponent(tournamentId)}/farm/${farmId}`
    : `/farm/${farmId}`;
  return (
    <Link to={href} className="you-farm-panel" data-testid="you-farm">
      <div className="you-farm-art">
        <FarmAvatar fields={farm} fallbackTone={farmCanvasTone(farmId)} />
      </div>
      <div className="you-farm-copy">
        <span className="kicker">Your farm</span>
        <span className="you-farm-name" data-testid="you-farm-name">
          {farm?.name || name || "Unnamed farm"}
        </span>
        <span className="farm-id" data-testid="you-farm-id">
          {farmId}
        </span>
        <p className="you-farm-blurb">
          {farm
            ? `${farm.otter_count} of 3 Otter Pebbles. Average of days with a recorded 3rd-pebble score.`
            : "Connect this farm to a live tournament to see rank and score."}
        </p>
      </div>
      <dl className="you-farm-grid">
        <div data-testid="you-farm-rank">
          <dt>Rank</dt>
          <dd>{loading ? "—" : (farm?.rank ?? "—")}</dd>
        </div>
        <div data-testid="you-farm-total">
          <dt>Total</dt>
          <dd>{loading ? "—" : (farm?.digs_to_third_op ?? "—")}</dd>
        </div>
        <div data-testid="you-farm-score-today">
          <dt>Today</dt>
          <dd>{loading ? "—" : (farm?.score_today ?? "—")}</dd>
        </div>
        <div data-testid="you-farm-avg">
          <dt>{AVG_SCORE_LABEL}</dt>
          <dd>
            {loading ? "—" : formatScore(farm?.recorded_average_per_day ?? farm?.score)}
          </dd>
        </div>
      </dl>
    </Link>
  );
}

function RulesBand() {
  return (
    <section className="home-band rules-band" id="rules" data-testid="rules">
      <div className="rules-head">
        <h2>RULES</h2>
        <p className="rules-lead" data-testid="rules-lead">
          Get the 3 Otter Pebbles in as few digs as possible. Digs after the 3rd pebble do not
          affect your score.
        </p>
      </div>
      <ol className="rules-grid">
        {RULES.map((rule) => (
          <li key={rule.label}>
            <span className="rules-label">{rule.label}</span>
            {rule.label === "Refresh" ? (
              <span>
                14:00, 16:00, 18:00, 20:00, 23:00 UTC.{" "}
                <strong>Digs after 23:00 UTC do not count</strong>
              </span>
            ) : (
              <span>{rule.body}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
