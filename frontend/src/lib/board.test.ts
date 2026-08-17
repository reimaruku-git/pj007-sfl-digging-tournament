import { describe, expect, it } from "vitest";
import type { LeaderboardEntry, TournamentSummary } from "../api/public";
import {
  homeTourneyPreview,
  joinableTournaments,
  liveTournamentsSoonestFirst,
  upcomingTournaments,
  visibleBoardEntries,
} from "./board";

function entry(partial: Partial<LeaderboardEntry> & Pick<LeaderboardEntry, "farm_id" | "rank" | "score">): LeaderboardEntry {
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
  const rows = Array.from({ length: 12 }, (_, index) =>
    entry({
      rank: index + 1,
      farm_id: String(index + 1),
      score: (index + 1) * 0.5,
    }),
  );

  it("keeps official order for asc and caps at 10", () => {
    const shown = visibleBoardEntries(rows, "asc");
    expect(shown).toHaveLength(10);
    expect(shown.map((row) => row.farm_id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(shown.map((row) => row.score)).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
  });

  it("reverses by official score for desc without leaking past the top 10", () => {
    const shown = visibleBoardEntries(rows, "desc");
    expect(shown).toHaveLength(10);
    expect(shown[0]?.farm_id).toBe("12");
    expect(shown[0]?.score).toBe(6);
    expect(shown[shown.length - 1]?.farm_id).toBe("3");
    expect(shown.map((row) => row.score)).toEqual([6, 5.5, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5]);
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
    expect(liveTournamentsSoonestFirst(items).map((row) => row.tournament_id)).toEqual(["soon", "late"]);
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
