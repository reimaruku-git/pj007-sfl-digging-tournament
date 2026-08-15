import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAdminConfig, saveConfig } from "./admin";

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
      end_at: config.end_at,
      prize_amount: "30",
    });
    expect(mockRequest).toHaveBeenCalledWith("admin/config", {
      method: "PUT",
      body: JSON.stringify({
        start_at: config.start_at,
        end_at: config.end_at,
        prize_amount: "30",
      }),
    });
    expect(saved.config.prize_amount).toBe("30");
    expect(saved.rescore?.rescored).toBe(2);
  });
});
