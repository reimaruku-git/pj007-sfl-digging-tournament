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
  listTournaments: vi.fn().mockResolvedValue({ tournaments: [], count: 0 }),
  fetchTournament: vi.fn(),
  fetchLeaderboard: vi.fn().mockResolvedValue({
    entries: [
      {
        rank: 1,
        farm_id: "1",
        name: "rmr",
        digs_to_third_op: 12,
        otter_count: 3,
        digs_today: 2,
        score: 1.71,
        total_digs: 21,
        last_updated_at: null,
        status: "completed",
        invalidated: false,
      },
    ],
    count: 1,
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
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(home.textContent).toMatch(/Prize pool/);
    expect(home.textContent).toMatch(/Join the tournament/);
    expect(home.textContent).toMatch(/3rd pebble/);
    expect(home.textContent).not.toMatch(/Avg\/day/);
    const rules = home.querySelector("#rules");
    expect(rules).not.toBeNull();
    expect(rules?.className).toMatch(/prize-card/);
    expect(rules?.textContent).toMatch(/Counts as 1 dig/);
    expect(rules?.textContent).toMatch(/Counts as 4 digs/);
    expect(rules?.textContent).toMatch(/exact dig number within those 4/);
    expect(rules?.textContent).toMatch(/After 5 shovel digs/);
    expect(rules?.textContent).toMatch(/6, 7, 8 and 9/);
    expect(rules?.textContent).toMatch(/dig #9/);
    expect(rules?.textContent).toMatch(/divided by the tournament length/);
    expect(rules?.textContent).toMatch(/14:00, 16:00, 18:00, 20:00, 23:00 UTC/);
    expect(rules?.textContent).toMatch(/Digs after 23:00 UTC do not count/);
    expect(rules?.textContent).toMatch(/worst finisher that day/);
    expect(rules?.textContent).toMatch(/5 per missing Otter Pebble/);
    expect(rules?.textContent).toMatch(/do not affect your score/);
    expect(rules?.textContent).toMatch(/fewer digs to the 3rd pebble/);
    expect(rules?.textContent).toMatch(/earlier time on the 3rd pebble/);
    expect(rules?.textContent).not.toMatch(/last of those 4/);
    expect(rules?.textContent).not.toMatch(/after 4 shovel digs/i);
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

  it("has a tournaments route", async () => {
    const page = renderApp("/tournaments");
    await act(async () => {
      await Promise.resolve();
    });
    expect(page.textContent).toMatch(/Upcoming|Tournaments/);
  });

  it("sends unknown paths to the leaderboard", async () => {
    const el = renderApp("/nope");
    await act(async () => {
      await Promise.resolve();
    });
    expect(el.textContent).toMatch(/Prize pool/);
  });
});
