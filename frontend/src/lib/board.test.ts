import { describe, expect, it } from "vitest";
import type { LeaderboardEntry, TournamentSummary } from "../api/public";
import {
  homeTourneyPreview,
  joinableTournaments,
  latestPastTournament,
  featuredHomeTournament,
  liveTournamentsSoonestFirst,
  nextColumnSort,
  nextScoreSort,
  pastTournaments,
  sortedStandings,
  upcomingTournaments,
  visibleBoardEntries,
  homeBoardRows,
  podiumPlaceTiedOnPrimary,
  adminBucketPreview,
  adminLiveNeedsOverflow,
  adminPastNeedsOverflow,
  filterTournamentsBySearch,
  ADMIN_LIVE_PREVIEW,
  ADMIN_PAST_PREVIEW,
} from "./board";

function entry(
  partial: Partial<LeaderboardEntry> & Pick<LeaderboardEntry, "farm_id" | "rank" | "score">,
): LeaderboardEntry {
  return {
    name: partial.name ?? partial.farm_id,
    digs_to_third_op: 10,
    otter_count: 3,
    digs_today: 0,
    total_digs: 10,
    last_updated_at: null,
    status: "completed",
    invalidated: false,
    ...partial,
  };
}

describe("visibleBoardEntries", () => {
  // API rank 1 already dug today with a worse average than rank 2.
  const rows = [
    entry({ rank: 1, farm_id: "dug", score: 18, name: "Dug today" }),
    entry({ rank: 2, farm_id: "idle", score: 10, name: "Better unused avg" }),
    ...[11, 12, 13, 14, 15, 16, 17, 19, 21, 22].map((score, index) =>
      entry({
        rank: index + 3,
        farm_id: `p${index + 3}`,
        score,
      }),
    ),
  ];

  it("keeps incoming API rank order when no sort is set and caps at 10", () => {
    const shown = visibleBoardEntries(rows, null);
    expect(shown).toHaveLength(10);
    expect(shown.map((row) => row.farm_id)).toEqual([
      "dug",
      "idle",
      "p3",
      "p4",
      "p5",
      "p6",
      "p7",
      "p8",
      "p9",
      "p10",
    ]);
    expect(shown[0]?.score).toBe(18);
    expect(shown[1]?.score).toBe(10);
  });

  it("orders by numeric avg/day ascending with nulls last", () => {
    const shown = visibleBoardEntries(rows, "asc");
    expect(shown).toHaveLength(10);
    expect(shown[0]?.farm_id).toBe("idle");
    expect(shown[0]?.score).toBe(10);
    expect(shown.map((row) => row.score)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it("orders by numeric avg/day descending and may surface rows past the original top 10", () => {
    const shown = visibleBoardEntries(rows, "desc");
    expect(shown).toHaveLength(10);
    expect(shown[0]?.farm_id).toBe("p12");
    expect(shown[0]?.score).toBe(22);
    expect(shown.map((row) => row.score)).toEqual([22, 21, 19, 18, 17, 16, 15, 14, 13, 12]);
  });

  it("cycles none → asc → desc → none", () => {
    expect(nextScoreSort(null)).toBe("asc");
    expect(nextScoreSort("asc")).toBe("desc");
    expect(nextScoreSort("desc")).toBeNull();
  });
});

describe("sortedStandings", () => {
  const rows = [
    entry({
      rank: 1,
      farm_id: "lead",
      score: 18,
      score_today: 27,
      digs_to_third_op: 80,
      name: "Lead",
    }),
    entry({
      rank: 2,
      farm_id: "mid",
      score: 10,
      score_today: 12,
      digs_to_third_op: 40,
      name: "Mid",
    }),
    entry({
      rank: 3,
      farm_id: "late",
      score: 22,
      score_today: 9,
      digs_to_third_op: 90,
      name: "Late",
    }),
    entry({
      rank: 4,
      farm_id: "blank",
      score: null,
      score_today: null,
      digs_to_third_op: null,
      name: "Blank",
    }),
  ];

  it("keeps API rank order when sort is null", () => {
    expect(sortedStandings(rows, null).map((row) => row.farm_id)).toEqual([
      "lead",
      "mid",
      "late",
      "blank",
    ]);
  });

  it("orders avg, today, and total asc then desc with nulls last", () => {
    expect(sortedStandings(rows, { column: "avg", dir: "asc" }).map((row) => row.farm_id)).toEqual([
      "mid",
      "lead",
      "late",
      "blank",
    ]);
    expect(sortedStandings(rows, { column: "avg", dir: "desc" }).map((row) => row.farm_id)).toEqual([
      "late",
      "lead",
      "mid",
      "blank",
    ]);
    expect(
      sortedStandings(rows, { column: "today", dir: "asc" }).map((row) => row.farm_id),
    ).toEqual(["late", "mid", "lead", "blank"]);
    expect(
      sortedStandings(rows, { column: "today", dir: "desc" }).map((row) => row.farm_id),
    ).toEqual(["lead", "mid", "late", "blank"]);
    expect(
      sortedStandings(rows, { column: "total", dir: "asc" }).map((row) => row.farm_id),
    ).toEqual(["mid", "lead", "late", "blank"]);
    expect(
      sortedStandings(rows, { column: "total", dir: "desc" }).map((row) => row.farm_id),
    ).toEqual(["late", "lead", "mid", "blank"]);
  });

  it("cycles a column none → asc → desc → none and switching columns starts asc", () => {
    expect(nextColumnSort(null, "avg")).toEqual({ column: "avg", dir: "asc" });
    expect(nextColumnSort({ column: "avg", dir: "asc" }, "avg")).toEqual({
      column: "avg",
      dir: "desc",
    });
    expect(nextColumnSort({ column: "avg", dir: "desc" }, "avg")).toBeNull();
    expect(nextColumnSort({ column: "avg", dir: "desc" }, "today")).toEqual({
      column: "today",
      dir: "asc",
    });
  });
});

describe("homeBoardRows", () => {
  it("caps at 10 and keeps all when there are fewer", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      entry({ farm_id: String(index + 1), rank: index + 1, score: index + 1 }),
    );
    expect(homeBoardRows(many, null)).toHaveLength(10);
    expect(homeBoardRows(many.slice(0, 8), null)).toHaveLength(8);
  });

  it("appends the connected farm after the top 10 when they rank outside it", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      entry({ farm_id: String(index + 1), rank: index + 1, score: index + 1 }),
    );
    const rows = homeBoardRows(many, null, "12");
    expect(rows).toHaveLength(11);
    expect(rows[10]?.farm_id).toBe("12");
    expect(rows[10]?.rank).toBe(12);
    expect(homeBoardRows(many, null, "1")).toHaveLength(10);
    expect(homeBoardRows(many, null, "1").filter((row) => row.farm_id === "1")).toHaveLength(1);
    expect(homeBoardRows(many, null, "99")).toHaveLength(10);
    expect(homeBoardRows(many, null, "")).toHaveLength(10);
  });
});

describe("adminBucketPreview", () => {
  it("caps live buckets at 3 and past at 6", () => {
    expect(adminBucketPreview([1, 2, 3, 4], ADMIN_LIVE_PREVIEW)).toEqual([1, 2, 3]);
    expect(adminBucketPreview([1, 2, 3], ADMIN_LIVE_PREVIEW)).toEqual([1, 2, 3]);
    expect(adminBucketPreview([1, 2, 3, 4, 5, 6, 7], ADMIN_PAST_PREVIEW)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(adminLiveNeedsOverflow(4, 1)).toBe(true);
    expect(adminLiveNeedsOverflow(3, 3)).toBe(false);
    expect(adminLiveNeedsOverflow(3, 4)).toBe(true);
    expect(adminPastNeedsOverflow(6)).toBe(false);
    expect(adminPastNeedsOverflow(7)).toBe(true);
  });

  it("filters overlay search by tournament name or id", () => {
    const items: TournamentSummary[] = [
      {
        tournament_id: "live-1",
        name: "Otter Cup",
        status: "active",
        start_at: "2026-08-01T00:00:00.000Z",
        end_at: "2026-08-08T00:00:00.000Z",
        duration_days: 7,
        prize_amount: "30",
        archived_at: null,
        count: 0,
        leader_farm_id: null,
      },
      {
        tournament_id: "up-hidden",
        name: "September shovel",
        status: "scheduled",
        start_at: "2026-09-01T00:00:00.000Z",
        end_at: "2026-09-08T00:00:00.000Z",
        duration_days: 7,
        prize_amount: "30",
        archived_at: null,
        count: 0,
        leader_farm_id: null,
      },
    ];
    expect(filterTournamentsBySearch(items, "otter").map((row) => row.tournament_id)).toEqual([
      "live-1",
    ]);
    expect(filterTournamentsBySearch(items, "UP-HIDDEN").map((row) => row.tournament_id)).toEqual([
      "up-hidden",
    ]);
    expect(filterTournamentsBySearch(items, "  ").map((row) => row.tournament_id)).toEqual([
      "live-1",
      "up-hidden",
    ]);
  });
});

describe("podiumPlaceTiedOnPrimary", () => {
  it("is true only for top-3 places that share the official average", () => {
    const rows = [
      entry({ farm_id: "a", rank: 1, score: 10, score_second_op: 6 }),
      entry({ farm_id: "b", rank: 2, score: 10, score_second_op: 8 }),
      entry({ farm_id: "c", rank: 3, score: 14, score_second_op: 9 }),
    ];
    expect(podiumPlaceTiedOnPrimary(rows[0], rows)).toBe(true);
    expect(podiumPlaceTiedOnPrimary(rows[1], rows)).toBe(true);
    expect(podiumPlaceTiedOnPrimary(rows[2], rows)).toBe(false);
    expect(podiumPlaceTiedOnPrimary(undefined, rows)).toBe(false);
  });
});

describe("featuredHomeTournament", () => {
  const items: TournamentSummary[] = [
    {
      tournament_id: "later",
      name: "Ends later",
      start_at: "2026-08-10T00:00:00Z",
      end_at: "2026-08-30T00:00:00Z",
      duration_days: 20,
      prize_amount: "30",
      status: "active",
      archived_at: null,
      count: 2,
      leader_farm_id: null,
    },
    {
      tournament_id: "soon",
      name: "Ends first",
      start_at: "2026-08-10T00:00:00Z",
      end_at: "2026-08-25T00:00:00Z",
      duration_days: 15,
      prize_amount: "30",
      status: "active",
      archived_at: null,
      count: 4,
      leader_farm_id: null,
    },
    {
      tournament_id: "past-cup",
      name: "Old cup",
      start_at: "2026-07-01T00:00:00Z",
      end_at: "2026-07-08T00:00:00Z",
      duration_days: 7,
      prize_amount: "30",
      status: "ended",
      archived_at: "2026-07-08T00:00:00Z",
      count: 3,
      leader_farm_id: null,
    },
    {
      tournament_id: "next",
      name: "September",
      start_at: "2026-09-01T00:00:00Z",
      end_at: "2026-09-08T00:00:00Z",
      duration_days: 7,
      prize_amount: "45",
      status: "scheduled",
      archived_at: null,
      count: 0,
      leader_farm_id: null,
    },
  ];

  it("falls back to soonest-ending live when no featured id is set", () => {
    expect(featuredHomeTournament(items, null)?.tournament_id).toBe("soon");
  });

  it("returns an admin-featured live or ended event and ignores scheduled", () => {
    expect(featuredHomeTournament(items, "later")?.tournament_id).toBe("later");
    expect(featuredHomeTournament(items, "past-cup")?.tournament_id).toBe("past-cup");
    expect(featuredHomeTournament(items, "next")?.tournament_id).toBe("soon");
  });
});

describe("tournament section order", () => {
  const items: TournamentSummary[] = [
    {
      tournament_id: "late",
      name: "Late live",
      start_at: "2026-08-10T00:00:00Z",
      end_at: "2026-08-25T00:00:00Z",
      duration_days: 15,
      prize_amount: "30",
      status: "active",
      archived_at: null,
      count: 2,
      leader_farm_id: null,
    },
    {
      tournament_id: "soon",
      name: "Ends first",
      start_at: "2026-08-01T00:00:00Z",
      end_at: "2026-08-20T00:00:00Z",
      duration_days: 19,
      prize_amount: "30",
      status: "active",
      archived_at: null,
      count: 4,
      leader_farm_id: null,
    },
    {
      tournament_id: "next",
      name: "September",
      start_at: "2026-09-01T00:00:00Z",
      end_at: "2026-09-08T00:00:00Z",
      duration_days: 7,
      prize_amount: "45",
      status: "scheduled",
      archived_at: null,
      count: 0,
      leader_farm_id: null,
    },
  ];

  it("orders live boards by soonest end_at", () => {
    expect(liveTournamentsSoonestFirst(items).map((row) => row.tournament_id)).toEqual([
      "soon",
      "late",
    ]);
  });

  it("keeps scheduled events in upcoming", () => {
    expect(upcomingTournaments(items).map((row) => row.name)).toEqual(["September"]);
  });

  it("lists live then upcoming for the join surface", () => {
    expect(joinableTournaments(items).map((row) => row.tournament_id)).toEqual([
      "soon",
      "late",
      "next",
    ]);
  });

  it("lists ended events newest-end first and omits live and scheduled", () => {
    const mismatch: TournamentSummary[] = [
      {
        tournament_id: "live-soon-end",
        name: "Ends first",
        start_at: "2026-08-10T00:00:00Z",
        end_at: "2026-08-18T00:00:00Z",
        duration_days: 8,
        prize_amount: "30",
        status: "active",
        archived_at: null,
        count: 1,
        leader_farm_id: null,
      },
      {
        tournament_id: "up-soon",
        name: "September cup",
        start_at: "2026-09-01T00:00:00Z",
        end_at: "2026-09-08T00:00:00Z",
        duration_days: 7,
        prize_amount: "30",
        status: "scheduled",
        archived_at: null,
        count: 0,
        leader_farm_id: null,
      },
      {
        tournament_id: "past-older",
        name: "July cup",
        start_at: "2026-07-01T00:00:00Z",
        end_at: "2026-07-08T00:00:00Z",
        duration_days: 7,
        prize_amount: "30",
        status: "ended",
        archived_at: "2026-07-08T00:00:00Z",
        count: 3,
        leader_farm_id: null,
      },
      {
        tournament_id: "past-newer",
        name: "August cup",
        start_at: "2026-08-01T00:00:00Z",
        end_at: "2026-08-08T00:00:00Z",
        duration_days: 7,
        prize_amount: "30",
        status: "ended",
        archived_at: "2026-08-08T00:00:00Z",
        count: 5,
        leader_farm_id: null,
      },
    ];
    expect(pastTournaments(mismatch).map((row) => row.tournament_id)).toEqual([
      "past-newer",
      "past-older",
    ]);
    expect(latestPastTournament(mismatch)?.tournament_id).toBe("past-newer");
    expect(latestPastTournament([])).toBeNull();
    expect(joinableTournaments(mismatch).map((row) => row.tournament_id)).toEqual([
      "live-soon-end",
      "up-soon",
    ]);
  });

  it("caps the home widget at two tournaments", () => {
    const many = [
      ...items,
      {
        ...items[2],
        tournament_id: "later",
        name: "October",
        start_at: "2026-10-01T00:00:00Z",
      },
    ];
    expect(homeTourneyPreview(upcomingTournaments(many)).map((row) => row.tournament_id)).toEqual([
      "next",
      "later",
    ]);
    expect(homeTourneyPreview(liveTournamentsSoonestFirst(many))).toHaveLength(2);
  });
});
