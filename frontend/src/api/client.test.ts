import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("../auth/session", () => ({
  getAuthToken: vi.fn(async () => "cognito.id.token"),
  handleUnauthorized: vi.fn(),
}));

import { requestJson } from "./client";

describe("requestJson", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("calls our API with the raw Cognito ID token and no leading slash", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ status: "healthy" }),
    });
    const result = await requestJson<{ status: string }>("health");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith("health")).toBe(true);
    expect(url.includes("/health")).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe("cognito.id.token");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(result.data).toEqual({ status: "healthy" });
  });

  it("sets JSON content-type on POST so bodies stay application/json", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });
    await requestJson("submissions", { method: "POST", body: "{}" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});
