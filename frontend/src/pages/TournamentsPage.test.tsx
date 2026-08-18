import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardEntry, TournamentArchive, TournamentSummary } from "../api/public";

const listTournaments = vi.fn();
const fetchTournament = vi.fn();
const submitFarm = vi.fn();

vi.mock("../api/public", () => ({
  listTournaments: (...args: unknown[]) => listTournaments(...args),
  fetchTournament: (...args: unknown[]) => fetchTournament(...args),
  submitFarm: (...args: unknown[]) => submitFarm(...args),
}));

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FarmSessionProvider } from "../lib/farmSession";
import { clearFarmIdentity, writeFarmIdentity } from "../lib/followFarm";
import { TournamentsPage } from "./TournamentsPage";

let root: Root;
let container: HTMLDivElement;

function summary(
  partial: Partial<TournamentSummary> &
    Pick<TournamentSummary, "tournament_id" | "name" | "status">,
): TournamentSummary {
  return {
    start_at: "2026-08-16T00:00:00.000Z",
    end_at: "2026-08-17T00:00:00.000Z",
    duration_days: 1,
    prize_amount: "30",
    archived_at: null,
    count: 0,
    leader_farm_id: null,
    ...partial,
  };
}

function entry(
  partial: Partial<LeaderboardEntry> & Pick<LeaderboardEntry, "farm_id" | "rank" | "score">,
): LeaderboardEntry {
  return {
    name: partial.name ?? `farm-${partial.farm_id}`,
    digs_to_third_op: 10,
    otter_count: 3,
    digs_today: 0,
    total_digs: 10,
    last_updated_at: null,
    status: "completed",
    invalidated: false,
    ...partial,
  };
}

function archive(row: TournamentSummary, entries: LeaderboardEntry[]): TournamentArchive {
  return {
    tournament_id: row.tournament_id,
    archived_at: "",
    config: {
      tournament_id: row.tournament_id,
      name: row.name,
      start_at: row.start_at,
      end_at: row.end_at,
      duration_days: row.duration_days,
      prize_amount: row.prize_amount,
      status: row.status,
      last_full_sync_at: null,
    },
    entries,
    count: entries.length,
    leader_farm_id: entries[0]?.farm_id ?? null,
    overall_average_per_day: 4.5,
  };
}

async function renderAt(path: string) {
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
          <FarmSessionProvider>
            <Routes>
              <Route path="/tournaments" element={<TournamentsPage />} />
              <Route path="/tournaments/:tournamentId" element={<TournamentsPage />} />
            </Routes>
          </FarmSessionProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  return container;
}

beforeEach(() => {
  listTournaments.mockReset();
  fetchTournament.mockReset();
  submitFarm.mockReset();
  writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  localStorage.clear();
});

describe("TournamentsPage", () => {
  it("stacks ongoing then upcoming windows, nearest first, without a farm gate", async () => {
    clearFarmIdentity();
    const lateLive = summary({
      tournament_id: "late",
      name: "Late live",
      status: "active",
      start_at: "2026-08-10T00:00:00.000Z",
      end_at: "2026-08-25T00:00:00.000Z",
    });
    const soonLive = summary({
      tournament_id: "soon",
      name: "Ends first",
      status: "active",
      start_at: "2026-08-01T00:00:00.000Z",
      end_at: "2026-08-20T00:00:00.000Z",
    });
    const laterUp = summary({
      tournament_id: "later",
      name: "October cup",
      status: "scheduled",
      start_at: "2026-10-01T00:00:00.000Z",
      end_at: "2026-10-08T00:00:00.000Z",
      duration_days: 7,
    });
    const nextUp = summary({
      tournament_id: "next",
      name: "Creators Digging Tournament",
      status: "scheduled",
      start_at: "2026-08-17T00:00:00.000Z",
      end_at: "2026-08-24T00:00:00.000Z",
      duration_days: 7,
    });
    const past = summary({
      tournament_id: "past",
      name: "Old cup",
      status: "ended",
    });
    listTournaments.mockResolvedValue({
      tournaments: [laterUp, lateLive, past, nextUp, soonLive],
      count: 5,
    });
    const page = await renderAt("/tournaments");
    expect(page.querySelector('[data-testid="farm-id-gate"]')).toBeNull();
    const stack = page.querySelector('[data-testid="tourney-stack"]');
    expect(stack).not.toBeNull();
    const windows = [...stack!.querySelectorAll('[data-testid^="tourney-window-"]')];
    expect(windows.map((node) => node.getAttribute("data-testid"))).toEqual([
      "tourney-window-soon",
      "tourney-window-late",
      "tourney-window-next",
      "tourney-window-later",
    ]);
    expect(windows[0]?.textContent).toMatch(/Ongoing/);
    expect(windows[0]?.textContent).toMatch(/Ends first/);
    expect(windows[1]?.textContent).toMatch(/Ongoing/);
    expect(windows[2]?.textContent).toMatch(/Upcoming/);
    expect(windows[2]?.textContent).toMatch(/Creators Digging Tournament/);
    expect(windows[3]?.textContent).toMatch(/Upcoming/);
    expect(page.querySelector('[data-testid="tourney-window-past"]')).toBeNull();
    expect(page.textContent).toMatch(/Old cup/);
    expect(page.querySelector('[data-testid="tourney-window-soon"]')?.getAttribute("href")).toBe(
      "/tournaments/soon",
    );
    expect(stack!.querySelectorAll('[data-testid="tourney-status-ongoing"]')).toHaveLength(2);
    expect(stack!.querySelectorAll('[data-testid="tourney-status-upcoming"]')).toHaveLength(2);
  });

  it("links ongoing and upcoming events to the info view", async () => {
    const live = summary({ tournament_id: "live", name: "Test Tournament 2", status: "active" });
    const next = summary({
      tournament_id: "next",
      name: "Creators Digging Tournament",
      status: "scheduled",
      start_at: "2026-08-17T00:00:00.000Z",
      end_at: "2026-08-24T00:00:00.000Z",
      duration_days: 7,
    });
    listTournaments.mockResolvedValue({ tournaments: [live, next], count: 2 });
    const page = await renderAt("/tournaments");
    const links = [...page.querySelectorAll("a")].map((node) => node.getAttribute("href"));
    expect(links).toContain("/tournaments/live");
    expect(links).toContain("/tournaments/next");
    expect(page.textContent).toMatch(/Test Tournament 2/);
    expect(page.textContent).toMatch(/Creators Digging Tournament/);
    expect(page.querySelector('[data-testid="tourney-window-live"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="tourney-window-next"]')).not.toBeNull();
  });

  it("reads Ongoing green and Upcoming gray from the shipped stylesheet", () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.tourney-status\.ongoing\s*\{[^}]*color:\s*var\(--green\)/s);
    expect(css).toMatch(/\.tourney-status\.upcoming\s*\{[^}]*color:\s*var\(--mute\)/s);
  });

  it("shows start to end, prize, participants, and overall average per day", async () => {
    const live = summary({
      tournament_id: "live",
      name: "Test Tournament 2",
      status: "active",
      prize_amount: "30",
    });
    fetchTournament.mockResolvedValue(
      archive(live, [
        entry({ farm_id: "1", rank: 1, score: 4.5, name: "Ada" }),
        entry({ farm_id: "2", rank: 2, score: 4.5, name: "Bea" }),
      ]),
    );
    const page = await renderAt("/tournaments/live");
    expect(page.querySelector('[data-testid="tournament-detail"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="tournament-window"]')?.textContent).toMatch(
      /16 Aug → 17 Aug · 1d/,
    );
    expect(page.querySelector('[data-testid="tournament-prize"]')?.textContent).toMatch(
      /30 Flower/,
    );
    expect(page.querySelector('[data-testid="tournament-participants"]')?.textContent).toMatch(/2/);
    expect(page.querySelector('[data-testid="tournament-overall-avg"]')?.textContent).toMatch(
      /Overall average per day/,
    );
    expect(page.querySelector('[data-testid="tournament-overall-avg"]')?.textContent).toMatch(
      /4\.50/,
    );
    expect(page.textContent).toMatch(/Ada/);
    expect(page.textContent).toMatch(/Bea/);
    expect(page.textContent).toMatch(/Total/);
    expect(page.textContent).toMatch(/Avg \/ day/);
    expect(page.textContent).toMatch(/Today/);
    expect(page.textContent).toMatch(/Pebbles/);
    expect(page.querySelector('[data-testid="join-tournament"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="join-farm-id"]')).toBeNull();
    expect(page.textContent).not.toMatch(/Display name/);
  });

  it("joins from the detail using the stored farm id and sfl.world name", async () => {
    const next = summary({
      tournament_id: "next",
      name: "Creators Digging Tournament",
      status: "scheduled",
      start_at: "2026-08-17T00:00:00.000Z",
      end_at: "2026-08-24T00:00:00.000Z",
      duration_days: 7,
    });
    fetchTournament.mockResolvedValue(archive(next, []));
    submitFarm.mockResolvedValue({ submissions: [], count: 0 });
    const page = await renderAt("/tournaments/next");
    expect(page.querySelector('[data-testid="join-detail"]')?.textContent).toMatch(/rmr/);
    act(() => {
      (page.querySelector('[data-testid="join-tournament"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(submitFarm).toHaveBeenCalledWith("3666918801844311", "rmr", ["next"]);
  });

  it("does not offer join submit until a farm is connected", async () => {
    clearFarmIdentity();
    const live = summary({
      tournament_id: "live",
      name: "Test Tournament 2",
      status: "active",
    });
    fetchTournament.mockResolvedValue(archive(live, []));
    const page = await renderAt("/tournaments/live");
    expect(page.querySelector('[data-testid="join-tournament"]')).toBeNull();
    expect(page.querySelector('[data-testid="join-detail"]')).toBeNull();
    expect(page.querySelector('[data-testid="join-need-connect"]')?.textContent).toMatch(
      /Connect your farm/,
    );
  });

  it("does not offer join on an ended tournament", async () => {
    const past = summary({
      tournament_id: "past",
      name: "Old cup",
      status: "ended",
    });
    fetchTournament.mockResolvedValue(archive(past, []));
    const page = await renderAt("/tournaments/past");
    expect(page.querySelector('[data-testid="join-tournament"]')).toBeNull();
  });
});
