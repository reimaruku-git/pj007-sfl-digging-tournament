import { describe, expect, it } from "vitest";
import type { LeaderboardEntry, TournamentSummary } from "../api/public";
import {
  homeTourneyPreview,
  joinableTournaments,
  liveTournamentsSoonestFirst,
  nextScoreSort,
  pastTournaments,
  upcomingTournaments,
  visibleBoardEntries,
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
