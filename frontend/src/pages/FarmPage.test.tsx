import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardEntry } from "../api/public";

const fetchFarm = vi.fn();
const fetchTournamentFarm = vi.fn();

vi.mock("../api/public", () => ({
  fetchFarm: (...args: unknown[]) => fetchFarm(...args),
  fetchTournamentFarm: (...args: unknown[]) => fetchTournamentFarm(...args),
}));

import { FarmPage } from "./FarmPage";

let root: Root;
let container: HTMLDivElement;

function farm(partial: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    rank: 1,
    farm_id: "3666918801844311",
    name: "rmr",
    score: 14.0,
    digs_to_third_op: 14,
    score_today: null,
    otter_count: 0,
    digs_today: 0,
    total_digs: 29,
    tournament_days: 7,
    last_updated_at: "2026-08-18T08:24:50+00:00",
    status: "not_started",
    invalidated: false,
    days: [
      {
        day: "2026-08-17",
        digs_to_third_op: 14,
        otter_count: 3,
        total_digs: 29,
        status: "completed",
        finalized: true,
      },
      {
        day: "2026-08-18",
        digs_to_third_op: null,
        otter_count: 0,
        total_digs: 0,
        status: "not_started",
        finalized: false,
      },
    ],
    ...partial,
  };
}

async function renderFarm() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/farm/3666918801844311"]}>
          <Routes>
            <Route path="/farm/:farmId" element={<FarmPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

describe("FarmPage days", () => {
  beforeEach(() => {
    fetchFarm.mockReset();
    fetchTournamentFarm.mockReset();
    fetchFarm.mockResolvedValue(farm());
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("shows total, scored-days average, score today, and pebbles today", async () => {
    await renderFarm();
    const facts = container.querySelector("[data-testid='farm-score-facts']");
    expect(container.querySelector("[data-testid='farm-total']")?.textContent).toBe("14");
    expect(facts?.textContent).toMatch(/Average per day/);
    expect(container.querySelector("[data-testid='farm-average']")?.textContent).toBe("14.00");
    expect(facts?.textContent).toMatch(/Score today/);
    expect(container.querySelector("[data-testid='farm-score-today']")?.textContent).toBe("—");
    expect(facts?.textContent).toMatch(/Pebbles today/);
    expect(container.querySelector("[data-testid='farm-pebbles-today']")?.textContent).toBe("0");
  });

  it("lists each stored tournament day instead of only today", async () => {
    await renderFarm();
    const days = container.querySelector("[data-testid='farm-days']");
    expect(days?.textContent).toMatch(/17 Aug/);
    expect(days?.textContent).toMatch(/18 Aug/);
    expect(container.querySelector("[data-testid='farm-day-2026-08-17']")?.textContent).toMatch(
      /14 digs/,
    );
    expect(container.querySelector("[data-testid='farm-day-2026-08-18']")?.textContent).toMatch(
      /— digs/,
    );
  });
});
