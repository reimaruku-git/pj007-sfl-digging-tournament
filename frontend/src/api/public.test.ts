import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFarm, fetchLeaderboard, submitFarm } from "./public";

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
        },
      }),
    );
    const farm = await fetchFarm("222");
    expect(mockRequest).toHaveBeenCalledWith("farms/222");
    expect(farm.status).toBe("in_progress");
  });

  it("submits a farm id for admin approval", async () => {
    mockRequest.mockResolvedValueOnce(
      ok({
        submission: {
          farm_id: "333",
          name: "bob",
          submitted_at: "2026-08-14T13:00:00+00:00",
          status: "pending",
        },
      }),
    );
    const submission = await submitFarm("333", "bob");
    expect(mockRequest).toHaveBeenCalledWith("submissions", {
      method: "POST",
      body: JSON.stringify({ farm_id: "333", name: "bob" }),
    });
    expect(submission.status).toBe("pending");
  });
});
