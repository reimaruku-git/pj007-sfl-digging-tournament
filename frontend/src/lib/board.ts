import type { LeaderboardEntry, TournamentSummary } from "../api/public";

export type ScoreSortDir = "asc" | "desc" | null;

export function nextScoreSort(current: ScoreSortDir): ScoreSortDir {
  if (current == null) return "asc";
  if (current === "asc") return "desc";
  return null;
}

export function visibleBoardEntries(
  entries: LeaderboardEntry[],
  sort: ScoreSortDir,
  limit = 10,
): LeaderboardEntry[] {
  const rows = [...entries];
  if (sort != null) {
    rows.sort((a, b) => {
      const aNum = a.score == null || Number.isNaN(Number(a.score)) ? null : Number(a.score);
      const bNum = b.score == null || Number.isNaN(Number(b.score)) ? null : Number(b.score);
      if (aNum == null && bNum == null) {
        return (a.rank ?? 9999) - (b.rank ?? 9999);
      }
      if (aNum == null) return 1;
      if (bNum == null) return -1;
      const cmp = aNum - bNum;
      if (cmp !== 0) return sort === "asc" ? cmp : -cmp;
      return (a.rank ?? 9999) - (b.rank ?? 9999);
    });
  }
  return rows.slice(0, limit);
}

export type StandingsColumn = "avg" | "today" | "total";
export type StandingsSort = { column: StandingsColumn; dir: "asc" | "desc" } | null;

const STANDINGS_FIELD: Record<StandingsColumn, "score" | "score_today" | "digs_to_third_op"> = {
  avg: "score",
  today: "score_today",
  total: "digs_to_third_op",
};

export function nextColumnSort(current: StandingsSort, column: StandingsColumn): StandingsSort {
  if (current == null || current.column !== column) return { column, dir: "asc" };
  if (current.dir === "asc") return { column, dir: "desc" };
  return null;
}

function numericOrNull(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Number(value);
}

export const HOME_BOARD_LIMIT = 10;

export function homeBoardRows(
  entries: LeaderboardEntry[],
  sort: StandingsSort,
  connectedFarmId?: string | null,
  limit = HOME_BOARD_LIMIT,
): LeaderboardEntry[] {
  const top = sortedStandings(entries, sort).slice(0, limit);
  const mine = (connectedFarmId || "").trim();
  if (!mine) return top;
  if (top.some((row) => row.farm_id === mine)) return top;
  const self = entries.find((row) => row.farm_id === mine);
  if (!self) return top;
  return [...top, self];
}

export const ADMIN_LIVE_PREVIEW = 3;
export const ADMIN_PAST_PREVIEW = 6;
export const ADMIN_OVERFLOW_SCROLL_AFTER = 10;

/** First `limit` rows of an admin bucket (home preview, not the overflow overlay). */
export function adminBucketPreview<T>(items: T[], limit: number): T[] {
  return items.slice(0, limit);
}

export function adminLiveNeedsOverflow(ongoingCount: number, upcomingCount: number): boolean {
  return ongoingCount > ADMIN_LIVE_PREVIEW || upcomingCount > ADMIN_LIVE_PREVIEW;
}

export function adminPastNeedsOverflow(count: number): boolean {
  return count > ADMIN_PAST_PREVIEW;
}

/** Overlay search: keep events whose name or id contains the query. */
export function filterTournamentsBySearch(
  items: TournamentSummary[],
  query: string,
): TournamentSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((row) => {
    const name = (row.name || "").toLowerCase();
    const id = row.tournament_id.toLowerCase();
    return name.includes(needle) || id.includes(needle);
  });
}

function numericScore(value: number | null | undefined): number | null {
  return numericOrNull(value);
}

/** True when this top-3 row shares its official average with another top-3 row. */
export function podiumPlaceTiedOnPrimary(
  entry: LeaderboardEntry | undefined,
  entries: LeaderboardEntry[],
): boolean {
  const mine = numericScore(entry?.score);
  if (entry == null || mine == null) return false;
  const top = [1, 2, 3]
    .map((rank) => entries.find((row) => row.rank === rank))
    .filter((row): row is LeaderboardEntry => Boolean(row));
  const same = top.filter((row) => numericScore(row.score) === mine);
  return same.length >= 2;
}

export function sortedStandings(
  entries: LeaderboardEntry[],
  sort: StandingsSort,
): LeaderboardEntry[] {
  const rows = [...entries];
  if (sort == null) {
    rows.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
    return rows;
  }
  const field = STANDINGS_FIELD[sort.column];
  rows.sort((a, b) => {
    const aNum = numericOrNull(a[field]);
    const bNum = numericOrNull(b[field]);
    if (aNum == null && bNum == null) return (a.rank ?? 9999) - (b.rank ?? 9999);
    if (aNum == null) return 1;
    if (bNum == null) return -1;
    if (aNum !== bNum) return sort.dir === "asc" ? aNum - bNum : bNum - aNum;
    return (a.rank ?? 9999) - (b.rank ?? 9999);
  });
  return rows;
}

export function featuredHomeTournament(
  items: TournamentSummary[],
  featuredId?: string | null,
): TournamentSummary | null {
  const wanted = (featuredId || "").trim();
  if (wanted) {
    const match = items.find((row) => row.tournament_id === wanted);
    if (
      match &&
      (match.status === "scheduled" || match.status === "active" || match.status === "ended")
    ) {
      return match;
    }
  }
  return liveTournamentsSoonestFirst(items)[0] ?? null;
}

export function liveTournamentsSoonestFirst(items: TournamentSummary[]): TournamentSummary[] {
  return items
    .filter((row) => row.status === "active")
    .sort((a, b) => Date.parse(a.end_at) - Date.parse(b.end_at));
}

export function upcomingTournaments(items: TournamentSummary[]): TournamentSummary[] {
  return items
    .filter((row) => row.status === "scheduled")
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
}

export function joinableTournaments(items: TournamentSummary[]): TournamentSummary[] {
  return [...liveTournamentsSoonestFirst(items), ...upcomingTournaments(items)];
}

/** Home past list: ended events, newest window last. */
export function pastTournaments(items: TournamentSummary[]): TournamentSummary[] {
  return items
    .filter((row) => row.status === "ended")
    .slice()
    .sort((a, b) => {
      const end = Date.parse(b.end_at) - Date.parse(a.end_at);
      if (end !== 0) return end;
      return Date.parse(b.start_at) - Date.parse(a.start_at);
    });
}

/** Newest-ended event, or null when none have finished. */
export function latestPastTournament(items: TournamentSummary[]): TournamentSummary | null {
  return pastTournaments(items)[0] ?? null;
}

export const HOME_TOURNEY_LIMIT = 2;

export function homeTourneyPreview(items: TournamentSummary[]): TournamentSummary[] {
  return items.slice(0, HOME_TOURNEY_LIMIT);
}
