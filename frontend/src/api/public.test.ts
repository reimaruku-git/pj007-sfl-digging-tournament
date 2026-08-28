import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchFarm,
  fetchLeaderboard,
  fetchSlogans,
  fetchTournament,
  identifyFarm,
  listTournaments,
  submitFarm,
} from "./public";

vi.mock("./client", () => ({
  requestJson: vi.fn(),
  errorMessage: (_data: unknown, fallback: string) => fallback,
}));

import { requestJson } from "./client";

const mockRequest = vi.mocked(requestJson);

function ok<T>(data: T) {
  return { response: { ok: true, status: 200 } as Response, data };
}

describe("public api", () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it("loads the ordered slogan list from our API", async () => {
    mockRequest.mockResolvedValueOnce(
      ok({
        slogans: [{ text: "Slap my pets" }, { text: "Grow my banana" }],
        count: 2,
        today_text: "Grow my banana",
        today_day: "2026-08-28",
      }),
    );
    const listed = await fetchSlogans();
    expect(mockRequest).toHaveBeenCalledWith("slogans");
    expect(listed.count).toBe(2);
    expect(listed.slogans[0]).toEqual({ text: "Slap my pets" });
    expect(listed.today_text).toBe("Grow my banana");
    expect(listed.today_day).toBe("2026-08-28");
  });

  it("loads the cached leaderboard from our API", async () => {
    mockRequest.mockResolvedValueOnce(
      ok({
        entries: [
          {
            rank: 1,
            farm_id: "111",
            name: "rmr",
            digs_to_third_op: 12,
            otter_count: 3,
            digs_today: 2,
            total_digs: 12,
            last_updated_at: "2026-08-14T13:00:00+00:00",
            status: "completed",
            invalidated: false,
          },
        ],
        count: 1,
        generated_at: "2026-08-14T13:00:00+00:00",
        config: {
          start_at: "2026-08-14T00:00:00+00:00",
          end_at: "2026-08-21T00:00:00+00:00",
          prize_amount: "30",
          status: "active",
          last_full_sync_at: null,
        },
      }),
    );
    const board = await fetchLeaderboard();
    expect(mockRequest).toHaveBeenCalledWith("leaderboard");
    expect(board.entries[0]?.digs_to_third_op).toBe(12);
    expect(board.config.prize_amount).toBe("30");
  });

  it("fetches a shareable farm result", async () => {
    mockRequest.mockResolvedValueOnce(
      ok({
        farm: {
          rank: 2,
          farm_id: "222",
          name: "",
          digs_to_third_op: null,
          otter_count: 1,
          digs_today: 4,
          total_digs: 4,
          last_updated_at: null,
          status: "in_progress",
          invalidated: false,
          recorded_average_per_day: 16.5,
          score_today: 9,
        },
      }),
    );
    const farm = await fetchFarm("222");
    expect(mockRequest).toHaveBeenCalledWith("farms/222");
    expect(farm.status).toBe("in_progress");
    expect(farm.recorded_average_per_day).toBe(16.5);
    expect(farm.score_today).toBe(9);
  });

  it("identifies a farm through our sfl.world lookup", async () => {
    mockRequest.mockResolvedValueOnce(
      ok({
        farm_id: "3666918801844311",
        name: "rmr",
        nft_id: 220411,
        identified_at: "2026-08-17T12:00:00+00:00",
      }),
    );
    const identity = await identifyFarm("3666918801844311");
    expect(mockRequest).toHaveBeenCalledWith("identify", {
      method: "POST",
      body: JSON.stringify({ farm_id: "3666918801844311" }),
    });
    expect(identity.name).toBe("rmr");
    expect(identity.farm_id).toBe("3666918801844311");
  });

  it("submits a farm id for named tournaments", async () => {
    mockRequest.mockResolvedValueOnce(
      ok({
        submissions: [
          {
            farm_id: "333",
            name: "bob",
            tournament_id: "cup-1",
            submitted_at: "2026-08-14T13:00:00+00:00",
            approved_at: null,
            status: "pending",
          },
        ],
        count: 1,
      }),
    );
    const result = await submitFarm("333", "bob", ["cup-1"]);
    expect(mockRequest).toHaveBeenCalledWith("submissions", {
      method: "POST",
      body: JSON.stringify({ farm_id: "333", name: "bob", tournament_ids: ["cup-1"] }),
    });
    expect(result.count).toBe(1);
    expect(result.submissions[0]?.status).toBe("pending");
    expect(result.submissions[0]?.tournament_id).toBe("cup-1");
  });

  it("loads a tournament info payload including overall average per day", async () => {
    mockRequest.mockResolvedValueOnce(
      ok({
        tournament: {
          tournament_id: "cup-1",
          archived_at: null,
          config: {
            tournament_id: "cup-1",
            name: "September cup",
            start_at: "2026-09-01T00:00:00+00:00",
            end_at: "2026-09-08T00:00:00+00:00",
            duration_days: 7,
            prize_amount: "45",
            status: "scheduled",
            last_full_sync_at: null,
            min_bumpkin_island: "desert",
            max_players: 32,
            join_mode: "auto",
            description: "Bring a shovel.",
            prize_places: [{ place: 1, amount: "45" }],
          },
          entries: [{ farm_id: "42", name: "Ada", score: null }],
          count: 1,
          leader_farm_id: null,
          overall_average_per_day: null,
        },
      }),
    );
    const tournament = await fetchTournament("cup-1");
    expect(mockRequest).toHaveBeenCalledWith("tournaments/cup-1");
    expect(tournament.config.prize_amount).toBe("45");
    expect(tournament.config.join_mode).toBe("auto");
    expect(tournament.config.min_bumpkin_island).toBe("desert");
    expect(tournament.config.description).toBe("Bring a shovel.");
    expect(tournament.config.prize_places?.[0]?.amount).toBe("45");
    expect(tournament.count).toBe(1);
    expect(tournament.overall_average_per_day).toBeNull();
  });

  it("loads the catalog including featured_tournament_id", async () => {
    mockRequest.mockResolvedValueOnce(
      ok({
        tournaments: [
          {
            tournament_id: "cup-1",
            name: "Week cup",
            start_at: "2026-08-14T00:00:00+00:00",
            end_at: "2026-08-21T00:00:00+00:00",
            duration_days: 7,
            prize_amount: "30",
            status: "active",
            archived_at: null,
            count: 2,
            leader_farm_id: "99",
          },
        ],
        count: 1,
        featured_tournament_id: "cup-1",
      }),
    );
    const listed = await listTournaments();
    expect(mockRequest).toHaveBeenCalledWith("tournaments");
    expect(listed.featured_tournament_id).toBe("cup-1");
    expect(listed.tournaments[0]?.tournament_id).toBe("cup-1");
  });
});
