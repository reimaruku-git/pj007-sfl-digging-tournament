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
