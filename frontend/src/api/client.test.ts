import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { requestJson, setAdminToken } from "./client";

describe("requestJson", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    setAdminToken(null);
  });

  it("calls our API with the raw admin token and no leading slash", async () => {
    setAdminToken("session.token");
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
    expect((init.headers as Record<string, string>).Authorization).toBe("session.token");
    expect(result.data).toEqual({ status: "healthy" });
  });
});
