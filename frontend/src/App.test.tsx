import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({ tokens: {} }),
  signIn: vi.fn(),
  signOut: vi.fn(),
  confirmSignIn: vi.fn(),
}));

vi.mock("./auth/amplify", () => ({}));

vi.mock("./api/public", () => ({
  fetchLeaderboard: vi.fn().mockResolvedValue({
    entries: [],
    count: 0,
    generated_at: null,
    config: {
      start_at: "2026-08-14T00:00:00+00:00",
      end_at: "2026-08-21T00:00:00+00:00",
      prize_amount: "30",
      status: "active",
      last_full_sync_at: null,
    },
  }),
  submitFarm: vi.fn(),
}));

import App from "./App";

let root: Root;
let container: HTMLDivElement;

function renderApp(path: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return container;
}

beforeEach(() => {
  vi.stubGlobal(
    "requestAnimationFrame",
    (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0) as unknown as number,
  );
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe("routes", () => {
  it("renders the leaderboard at / and keeps /admin reachable", async () => {
    const home = renderApp("/");
    await act(async () => {
      await Promise.resolve();
    });
    expect(home.textContent).toMatch(/Prize pool/);
    expect(home.textContent).toMatch(/Join the tournament/);
    const rules = home.querySelector("#rules");
    expect(rules).not.toBeNull();
    expect(rules?.className).toMatch(/prize-card/);
    expect(rules?.textContent).toMatch(/5th dig/);
    expect(rules?.textContent).toMatch(/8th/);
    expect(rules?.textContent).toMatch(/last hole/);
    expect(home.textContent).not.toMatch(/even if it uncovers 4 tiles/);
    expect(home.querySelectorAll("#rules").length).toBe(1);
    expect(home.querySelector("section#rules")).toBeNull();
    expect([...home.querySelectorAll("a")].map((n) => n.getAttribute("href"))).not.toContain(
      "/admin",
    );

    act(() => {
      root.unmount();
    });
    container.remove();

    const admin = renderApp("/admin");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(admin.textContent).toMatch(/Master admin|Checking session|Sign in|Loading admin/);
    expect(admin.querySelector('button[aria-label="Menu"]')).not.toBeNull();
  });

  it("sends unknown paths to the leaderboard", async () => {
    const el = renderApp("/nope");
    await act(async () => {
      await Promise.resolve();
    });
    expect(el.textContent).toMatch(/Prize pool/);
  });
});
