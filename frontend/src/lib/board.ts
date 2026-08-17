import type { LeaderboardEntry, TournamentSummary } from "../api/public";

export type ScoreSortDir = "asc" | "desc";

export function visibleBoardEntries(
  entries: LeaderboardEntry[],
  sort: ScoreSortDir,
  limit = 10,
): LeaderboardEntry[] {
  const rows = [...entries];
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
  return rows.slice(0, limit);
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

/** Home join list only: live by oldest start_at, then upcoming by soonest start_at. */
export function joinListTournaments(items: TournamentSummary[]): TournamentSummary[] {
  return items
    .filter((row) => row.status === "active" || row.status === "scheduled")
    .slice()
    .sort((a, b) => {
      const aLive = a.status === "active" ? 0 : 1;
      const bLive = b.status === "active" ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      return Date.parse(a.start_at) - Date.parse(b.start_at);
    });
}

export const HOME_TOURNEY_LIMIT = 2;

export function homeTourneyPreview(items: TournamentSummary[]): TournamentSummary[] {
  return items.slice(0, HOME_TOURNEY_LIMIT);
}
