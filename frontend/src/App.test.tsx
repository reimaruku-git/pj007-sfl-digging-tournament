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
  fetchTournament: vi.fn().mockResolvedValue({
    tournament_id: "",
    archived_at: "",
    config: {
      start_at: null,
      end_at: null,
      prize_amount: "30",
      status: "scheduled",
      last_full_sync_at: null,
    },
    entries: [],
    count: 0,
    leader_farm_id: null,
  }),
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
  identifyFarm: vi.fn(),
}));

import { identifyFarm } from "./api/public";
import { writeFarmIdentity } from "./lib/followFarm";
import App from "./App";

const mockIdentify = vi.mocked(identifyFarm);

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
  localStorage.clear();
  mockIdentify.mockReset();
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
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("routes", () => {
  it("asks for a farm id before public browse and keeps /admin reachable", async () => {
    const gated = renderApp("/");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(gated.querySelector('[data-testid="farm-id-gate"]')).not.toBeNull();
    expect(gated.textContent).toMatch(/Enter your Farm ID/);
    expect(gated.querySelector("#rules")).toBeNull();
    expect(gated.querySelector('[data-testid="ongoing-group"]')).toBeNull();
    expect(gated.querySelector("#join")).toBeNull();

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
    expect(admin.querySelector('[data-testid="farm-id-gate"]')).toBeNull();
    expect(admin.textContent).toMatch(/Master admin|Checking session|Sign in|Loading admin/);
    expect(admin.querySelector('button[aria-label="Menu"]')).not.toBeNull();
  });

  it("identifies through our API then shows browse, and disconnect returns the prompt", async () => {
    mockIdentify.mockResolvedValue({
      farm_id: "3666918801844311",
      name: "rmr",
      nft_id: 220411,
      identified_at: "2026-08-17T12:00:00+00:00",
    });
    const home = renderApp("/");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const input = home.querySelector('[data-testid="farm-id-input"]') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "3666918801844311");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (home.querySelector('[data-testid="farm-id-submit"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mockIdentify).toHaveBeenCalledWith("3666918801844311");
    expect(home.querySelector('[data-testid="farm-id-gate"]')).toBeNull();
    expect(home.textContent).toMatch(/Prize pool/);
    expect(home.textContent).toMatch(/Join a tournament/);
    expect(home.textContent).toMatch(/Ongoing/);
    expect(home.textContent).toMatch(/Upcoming/);
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
    expect(home.querySelectorAll("#rules").length).toBe(1);

    const burger = home.querySelector('button[aria-label="Menu"]') as HTMLButtonElement;
    act(() => {
      burger.click();
    });
    const disconnect = home.querySelector('[data-testid="disconnect-farm"]') as HTMLButtonElement;
    expect(disconnect).not.toBeNull();
    expect(disconnect.textContent).toMatch(/Disconnect rmr/);
    act(() => {
      disconnect.click();
    });
    expect(home.querySelector('[data-testid="farm-id-gate"]')).not.toBeNull();
    expect(home.querySelector("#rules")).toBeNull();
    expect(home.querySelector("#join")).toBeNull();
  });

  it("has a tournaments route after identify", async () => {
    writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
    const page = renderApp("/tournaments");
    await act(async () => {
      await Promise.resolve();
    });
    expect(page.querySelector('[data-testid="farm-id-gate"]')).toBeNull();
    expect(page.textContent).toMatch(/Upcoming|Tournaments/);
    expect(page.textContent).not.toMatch(/Create tournament/);
  });

  it("sends unknown paths to the leaderboard after identify", async () => {
    writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
    const el = renderApp("/nope");
    await act(async () => {
      await Promise.resolve();
    });
    expect(el.textContent).toMatch(/Prize pool/);
  });
});
