import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addTournamentFarms,
  approveSubmission,
  fetchAdminConfig,
  fetchAdminFarm,
  fetchTournamentRoster,
  refreshFarm,
  rejectSubmission,
  saveConfig,
} from "./admin";

vi.mock("./client", () => ({
  requestJson: vi.fn(),
  errorMessage: (_data: unknown, fallback: string) => fallback,
}));

import { requestJson } from "./client";

const mockRequest = vi.mocked(requestJson);

function ok<T>(data: T) {
  return { response: { ok: true, status: 200 } as Response, data };
}

const config = {
  start_at: "2026-08-14T00:00:00+00:00",
  end_at: "2026-08-21T00:00:00+00:00",
  prize_amount: "30",
  status: "active" as const,
  last_full_sync_at: null,
};

describe("admin api", () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it("loads admin config from the authenticated route", async () => {
    mockRequest.mockResolvedValueOnce(ok({ config }));
    const loaded = await fetchAdminConfig();
    expect(mockRequest).toHaveBeenCalledWith("admin/config");
    expect(loaded.prize_amount).toBe("30");
  });

  it("saves config and returns the rescore summary", async () => {
    mockRequest.mockResolvedValueOnce(
      ok({
        config,
        rescore: { rescored: 2, missing_snapshots: 0, sync_accepted: true },
      }),
    );
    const saved = await saveConfig({
      start_at: config.start_at,
      duration_days: 7,
      prize_amount: "30",
    });
    expect(mockRequest).toHaveBeenCalledWith("admin/config", {
      method: "PUT",
      body: JSON.stringify({
        start_at: config.start_at,
        duration_days: 7,
        prize_amount: "30",
      }),
    });
    expect(saved.config.prize_amount).toBe("30");
    expect(saved.rescore?.rescored).toBe(2);
  });

  it("loads a player detail from the authenticated farm route", async () => {
    mockRequest.mockResolvedValueOnce(
      ok({
        farm: {
          farm_id: "99",
          name: "rmr",
          active: true,
          digging_streak: 2,
          average_per_day: 6,
          history: [],
          enrollments: [],
          pending_joins: [],
        },
      }),
    );
    const farm = await fetchAdminFarm("99");
    expect(mockRequest).toHaveBeenCalledWith("admin/farms/99");
    expect(farm.digging_streak).toBe(2);
  });

  it("approves and rejects a join that names a tournament", async () => {
    mockRequest.mockResolvedValueOnce(ok({ farm: { farm_id: "99", name: "rmr", active: true } }));
    await approveSubmission("99", "cup-1");
    expect(mockRequest).toHaveBeenCalledWith("admin/submissions/99/cup-1/approve", {
      method: "POST",
    });
    mockRequest.mockResolvedValueOnce(ok({ ok: true }));
    await rejectSubmission("99", "cup-1");
    expect(mockRequest).toHaveBeenCalledWith("admin/submissions/99/cup-1", { method: "DELETE" });
  });

  it("loads a roster and multi-adds existing farms", async () => {
    mockRequest.mockResolvedValueOnce(ok({ members: [], count: 0 }));
    await fetchTournamentRoster("cup-1");
    expect(mockRequest).toHaveBeenCalledWith("admin/tournaments/cup-1/roster");
    mockRequest.mockResolvedValueOnce(
      ok({ farms: [{ farm_id: "99", name: "rmr", active: true }], count: 1 }),
    );
    await addTournamentFarms("cup-1", ["99"]);
    expect(mockRequest).toHaveBeenCalledWith("admin/tournaments/cup-1/farms", {
      method: "POST",
      body: JSON.stringify({ farm_ids: ["99"] }),
    });
  });

  it("starts a one-farm refresh as accepted, not a live score", async () => {
    mockRequest.mockResolvedValueOnce(
      ok({ accepted: true, farm_id: "3666918801844311" }),
    );
    await refreshFarm("3666918801844311");
    expect(mockRequest).toHaveBeenCalledWith("admin/farms/3666918801844311/refresh", {
      method: "POST",
    });
  });
});
