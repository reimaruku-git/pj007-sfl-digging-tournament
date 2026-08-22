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
