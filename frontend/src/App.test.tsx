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
  identifyFarm: vi.fn(),
  fetchFarm: vi.fn().mockRejectedValue(new Error("farm not found")),
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
  it("opens public browse immediately and keeps /admin reachable without a farm gate", async () => {
    const home = renderApp("/");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(home.querySelector('[data-testid="farm-id-gate"]')).toBeNull();
    expect(home.textContent).not.toMatch(/Enter your Farm ID/);
    expect(home.querySelector("#rules")).not.toBeNull();
    expect(home.querySelector('[data-testid="home-hero"]')).not.toBeNull();
    expect(home.querySelector('[data-testid="public-brand"]')?.querySelector("h1")?.textContent).toBe(
      "Bumpkin Clash: Digging",
    );
    expect(home.querySelector('[data-testid="public-brand"]')?.querySelector("p")?.textContent).toBe(
      "Sunflower Land Digging Tournament",
    );
    expect(home.querySelector('[data-testid="site-version"]')?.textContent).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(home.querySelector('[data-testid="public-disclaimer"]')?.textContent).toMatch(
      /not[\s\S]*official Sunflower Land team/i,
    );
    expect(home.querySelector('[data-testid="public-nav"]')?.textContent).toMatch(/Tournaments/);
    expect(home.querySelector('[data-testid="public-nav"]')?.textContent).not.toMatch(/Windows/);
    expect(home.querySelector("#join")).toBeNull();
    expect(home.querySelector('[data-testid="farm-connect"]')).not.toBeNull();
    expect(home.querySelector('[data-testid="farm-id-input"]')).not.toBeNull();

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
    expect(admin.querySelector('[data-testid="farm-connect"]')).toBeNull();
    expect(admin.querySelector('[data-testid="farm-connected"]')).toBeNull();
    expect(admin.querySelector('[data-testid="farm-id-input"]')).toBeNull();
    expect(admin.textContent).toMatch(/Master admin|Checking session|Sign in|Loading admin/);
    expect(admin.querySelector('button[aria-label="Menu"]')).not.toBeNull();
  });

  it("identifies through our API from the header then shows the connected chip", async () => {
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
    expect(home.querySelector("#rules")).not.toBeNull();
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
    expect(home.querySelector('[data-testid="farm-connect"]')).toBeNull();
    const connected = home.querySelector('[data-testid="farm-connected"]');
    expect(connected?.querySelector(".farm-connected-name")?.textContent).toBe("rmr");
    expect(home.querySelector('[data-testid="public-nav"]')?.textContent).toMatch(/Tournaments/);
    const rules = home.querySelector("#rules");
    expect(rules).not.toBeNull();
    expect(rules?.textContent).toMatch(/Counts as 1 dig/);
    expect(rules?.textContent).toMatch(/Counts as 4 digs/);
    expect(rules?.textContent).toMatch(/last dig of those 4/);
    expect(rules?.textContent).toMatch(/After 5 shovel digs/);
    expect(rules?.textContent).toMatch(/6-7-8-9/);
    expect(rules?.textContent).toMatch(/pebble is found on dig 9/);
    expect(rules?.textContent).toMatch(/only on days that already have a recorded score/);
    expect(rules?.textContent).toMatch(/14:00, 16:00, 18:00, 20:00, 23:00 UTC/);
    expect(rules?.querySelector("strong")?.textContent).toBe("Digs after 23:00 UTC do not count");
    expect(rules?.textContent).toMatch(/worst finisher that day or 30/);
    expect(rules?.textContent).toMatch(/5 for every missing pebble/);
    expect(rules?.textContent).toMatch(/minus 1 and minus 2/);
    expect(rules?.textContent).toMatch(/SO DIG!/);
    expect(rules?.textContent).toMatch(/do not affect your score/);
    expect(rules?.textContent).toMatch(/Average of 3rd pebble, then 2nd, then 1st/);
    expect(rules?.textContent).toMatch(/earlier time on the 3rd pebble/);
    expect(home.querySelectorAll("#rules").length).toBe(1);
    expect(home.textContent).not.toMatch(/How a window is won/);
    expect(home.textContent).not.toMatch(/Windows in the sand/);
    expect(home.textContent).not.toMatch(/See windows/);
    expect(home.textContent).not.toMatch(/Hunt three pebbles/);
    expect(home.textContent).not.toMatch(/Spend fewer strokes/);

    act(() => {
      (connected as HTMLButtonElement).click();
    });
    const disconnect = home.querySelector('[data-testid="disconnect-farm"]') as HTMLButtonElement;
    expect(disconnect).not.toBeNull();
    expect(disconnect.textContent).toMatch(/Disconnect rmr/);
    act(() => {
      disconnect.click();
    });
    expect(home.querySelector('[data-testid="farm-id-gate"]')).toBeNull();
    expect(home.querySelector("#rules")).not.toBeNull();
    expect(home.querySelector("#join")).toBeNull();
    expect(home.querySelector('[data-testid="farm-connect"]')).not.toBeNull();
    expect(home.querySelector('[data-testid="farm-connected"]')).toBeNull();
  });

  it("has a Tournaments catalog route without a stored farm identity", async () => {
    const page = renderApp("/tournaments");
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(page.querySelector('[data-testid="farm-id-gate"]')).toBeNull();
    expect(page.querySelector('[data-testid="tournaments-title"]')?.textContent).toMatch(
      /Tournaments/,
    );
    expect(page.querySelector('[data-testid="tournaments-title"]')?.textContent).not.toMatch(
      /Windows/,
    );
    expect(page.textContent).not.toMatch(/Create tournament/);
    expect(page.querySelector('[data-testid="farm-connect"]')).not.toBeNull();
  });

  it("sends unknown paths to the live home without identify", async () => {
    const el = renderApp("/nope");
    await act(async () => {
      await Promise.resolve();
    });
    expect(el.querySelector('[data-testid="home-hero"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="farm-id-gate"]')).toBeNull();
  });

  it("keeps /admin free of connected-as chrome even with a stored identity", async () => {
    writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
    const admin = renderApp("/admin");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(admin.querySelector('[data-testid="farm-connected"]')).toBeNull();
    expect(admin.querySelector('[data-testid="farm-connect"]')).toBeNull();
  });
});
