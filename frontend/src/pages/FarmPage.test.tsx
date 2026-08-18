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

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FarmPage } from "./FarmPage";

let root: Root;
let container: HTMLDivElement;

function farm(partial: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    rank: 1,
    farm_id: "3666918801844311",
    name: "rmr",
    score: 14.0,
    score_first_op: 4.0,
    score_second_op: 8.0,
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

async function renderFarm(path = "/farm/3666918801844311") {
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
          <Routes>
            <Route path="/farm/:farmId" element={<FarmPage />} />
            <Route
              path="/tournaments/:tournamentId/farm/:farmId"
              element={<FarmPage />}
            />
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
    const avgRow = container.querySelector("[data-testid='farm-pebble-averages']");
    expect(avgRow).not.toBeNull();
    const avgKids = [...(avgRow?.children ?? [])] as HTMLElement[];
    expect(avgKids[0]?.textContent).toMatch(/Average per day/);
    expect(avgKids[1]?.textContent).toMatch(/1st pebble avg/);
    expect(avgKids[2]?.textContent).toMatch(/2nd pebble avg/);
    expect(container.querySelector("[data-testid='farm-first-average']")?.textContent).toBe("4.00");
    expect(container.querySelector("[data-testid='farm-second-average']")?.textContent).toBe(
      "8.00",
    );
    expect(
      container.querySelector("[data-testid='farm-first-average']")?.closest(".stat-pebble"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='farm-second-average']")?.closest(".stat-pebble"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='farm-average']")?.closest(".stat-pebble"),
    ).toBeNull();
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.stat b\s*\{[^}]*font-size:\s*18px/s);
    expect(css).toMatch(/\.farm-avg-row \.stat-pebble b\s*\{[^}]*font-size:\s*14px/s);
    expect(facts?.textContent).toMatch(/Score today/);
    expect(container.querySelector("[data-testid='farm-score-today']")?.textContent).toBe("—");
    expect(facts?.textContent).toMatch(/Pebbles today/);
    expect(container.querySelector("[data-testid='farm-pebbles-today']")?.textContent).toBe("0");
  });

  it("dashes 1st and 2nd pebble averages when no day has that pebble", async () => {
    fetchFarm.mockResolvedValue(farm({ score_first_op: null, score_second_op: null }));
    await renderFarm();
    expect(container.querySelector("[data-testid='farm-first-average']")?.textContent).toBe("—");
    expect(container.querySelector("[data-testid='farm-second-average']")?.textContent).toBe("—");
  });

  it("returns home from a home-board farm and the tournament from a tournament farm", async () => {
    await renderFarm("/farm/3666918801844311");
    const homeBack = container.querySelector("[data-testid='back-link']");
    expect(homeBack?.textContent).toMatch(/Back to home/);
    expect(homeBack?.getAttribute("href")).toBe("/");
    expect(container.textContent).not.toMatch(/leaderboard/);
    act(() => {
      root.unmount();
    });
    container.remove();
    fetchTournamentFarm.mockResolvedValue(farm());
    await renderFarm("/tournaments/20260817T000000Z_7d/farm/3666918801844311");
    const eventBack = container.querySelector("[data-testid='back-link']");
    expect(eventBack?.textContent).toMatch(/Back to tournament/);
    expect(eventBack?.getAttribute("href")).toBe("/tournaments/20260817T000000Z_7d");
    expect(container.textContent).not.toMatch(/All tournaments/);
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
