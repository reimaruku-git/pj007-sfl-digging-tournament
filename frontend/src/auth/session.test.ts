import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchAuthSession = vi.fn();
const signOut = vi.fn();

vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: (...args: unknown[]) => fetchAuthSession(...args),
  signOut: (...args: unknown[]) => signOut(...args),
}));

describe("session", () => {
  beforeEach(() => {
    fetchAuthSession.mockReset();
    signOut.mockReset();
    vi.resetModules();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("skips Amplify on public pages until admin configures it", async () => {
    const session = await import("./session");
    expect(session.isAuthConfigured()).toBe(false);
    expect(await session.getAuthToken()).toBeNull();
    expect(fetchAuthSession).not.toHaveBeenCalled();
  });

  it("does not redirect a public 401 to /admin", async () => {
    const session = await import("./session");
    await session.handleUnauthorized();
    expect(signOut).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
  });

  it("signs out on /admin after Amplify is configured", async () => {
    window.history.replaceState({}, "", "/admin");
    const session = await import("./session");
    session.markAuthConfigured();
    signOut.mockResolvedValue(undefined);
    await session.handleUnauthorized();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
