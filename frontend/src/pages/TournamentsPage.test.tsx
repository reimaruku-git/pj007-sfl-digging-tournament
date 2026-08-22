import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardEntry, TournamentArchive, TournamentSummary } from "../api/public";

const listTournaments = vi.fn();
const fetchTournament = vi.fn();
const submitFarm = vi.fn();
const downloadTournamentBoardImage = vi.fn();

vi.mock("../api/public", () => ({
  listTournaments: (...args: unknown[]) => listTournaments(...args),
  fetchTournament: (...args: unknown[]) => fetchTournament(...args),
  submitFarm: (...args: unknown[]) => submitFarm(...args),
}));

vi.mock("../lib/boardImage", () => ({
  downloadTournamentBoardImage: (...args: unknown[]) => downloadTournamentBoardImage(...args),
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
    accepts_joins: row.status === "scheduled" || row.status === "active",
  };
}

async function renderAt(path: string, state?: { from?: string }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[{ pathname: path, state }]}>
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
  downloadTournamentBoardImage.mockReset();
  downloadTournamentBoardImage.mockResolvedValue(undefined);
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
  it("groups ongoing, upcoming, and ended with links and a scrollable ended list", async () => {
    clearFarmIdentity();
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.catalog-group-list\.is-scroll\s*\{[^}]*max-height:\s*calc\(4 \* var\(--catalog-block\) \+ 3 \* var\(--catalog-gap\)\)/s,
    );
    expect(css).toMatch(/\.catalog-group-list\.is-scroll\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/--catalog-block:\s*3\.55rem/);
    expect(css).toMatch(/\.tourney-window\s*\{[^}]*min-height:\s*var\(--catalog-block\)/s);
    expect(css).toMatch(/\.tourney-window-meta\s*\{[^}]*white-space:\s*nowrap/s);
    const sheet = document.createElement("style");
    sheet.textContent = css;
    document.head.appendChild(sheet);
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
      start_at: "2026-07-01T00:00:00.000Z",
      end_at: "2026-07-08T00:00:00.000Z",
      duration_days: 7,
      count: 4,
    });
    const older = summary({
      tournament_id: "older",
      name: "June cup",
      status: "ended",
      start_at: "2026-06-01T00:00:00.000Z",
      end_at: "2026-06-08T00:00:00.000Z",
      duration_days: 7,
      count: 2,
    });
    const may = summary({
      tournament_id: "may",
      name: "May cup",
      status: "ended",
      start_at: "2026-05-01T00:00:00.000Z",
      end_at: "2026-05-08T00:00:00.000Z",
      duration_days: 7,
      count: 3,
    });
    const april = summary({
      tournament_id: "april",
      name: "April cup",
      status: "ended",
      start_at: "2026-04-01T00:00:00.000Z",
      end_at: "2026-04-08T00:00:00.000Z",
      duration_days: 7,
      count: 1,
    });
    listTournaments.mockResolvedValue({
      tournaments: [laterUp, lateLive, past, nextUp, soonLive, older, may, april],
      count: 8,
    });
    try {
      const page = await renderAt("/tournaments");
      expect(page.querySelector('[data-testid="farm-id-gate"]')).toBeNull();
      const ongoing = page.querySelector('[data-testid="catalog-ongoing"]');
      const upcoming = page.querySelector('[data-testid="catalog-upcoming"]');
      const ended = page.querySelector('[data-testid="catalog-ended"]');
      expect(ongoing?.textContent).toMatch(/Ongoing/);
      expect(upcoming?.textContent).toMatch(/Upcoming/);
      expect(ended?.textContent).toMatch(/Ended/);
      const ongoingIds = [...ongoing!.querySelectorAll('[data-testid^="tourney-window-"]')].map(
        (node) => node.getAttribute("data-testid"),
      );
      const upcomingIds = [...upcoming!.querySelectorAll('[data-testid^="tourney-window-"]')].map(
        (node) => node.getAttribute("data-testid"),
      );
      const endedIds = [...ended!.querySelectorAll('[data-testid^="tourney-window-"]')].map((node) =>
        node.getAttribute("data-testid"),
      );
      expect(ongoingIds).toEqual(["tourney-window-soon", "tourney-window-late"]);
      expect(upcomingIds).toEqual(["tourney-window-next", "tourney-window-later"]);
      expect(endedIds).toEqual([
        "tourney-window-past",
        "tourney-window-older",
        "tourney-window-may",
        "tourney-window-april",
      ]);
      expect(ended?.textContent).toMatch(/1–8 Jul/);
      expect(ended?.textContent).not.toMatch(/→/);
      expect(ongoing?.textContent).not.toMatch(/Old cup/);
      expect(upcoming?.textContent).not.toMatch(/Old cup/);
      expect(ended?.textContent).not.toMatch(/Ends first/);
      expect(ended?.textContent).not.toMatch(/October cup/);
      expect(page.querySelector('[data-testid="tourney-window-soon"]')?.getAttribute("href")).toBe(
        "/tournaments/soon",
      );
      expect(page.querySelector('[data-testid="tourney-window-next"]')?.getAttribute("href")).toBe(
        "/tournaments/next",
      );
      expect(page.querySelector('[data-testid="tourney-window-past"]')?.getAttribute("href")).toBe(
        "/tournaments/past",
      );
      expect(ongoing!.querySelectorAll('[data-testid="tourney-status-ongoing"]')).toHaveLength(2);
      expect(upcoming!.querySelectorAll('[data-testid="tourney-status-upcoming"]')).toHaveLength(2);
      expect(ended!.querySelectorAll('[data-testid="tourney-status-ended"]')).toHaveLength(4);
      const endedList = page.querySelector('[data-testid="catalog-ended-list"]') as HTMLElement;
      expect(endedList.classList.contains("is-scroll")).toBe(true);
      const endedStyle = getComputedStyle(endedList);
      expect(endedStyle.overflowY).toMatch(/auto|scroll/);
      expect(endedStyle.maxHeight).toMatch(/calc\(4 \* var\(--catalog-block\)/);
      expect(page.querySelector('[data-testid="catalog-ongoing-list"]')?.classList.contains("is-scroll")).toBe(
        false,
      );
    } finally {
      sheet.remove();
    }
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
    expect(page.querySelector('[data-testid="catalog-ongoing"]')?.contains(
      page.querySelector('[data-testid="tourney-window-live"]'),
    )).toBe(true);
    expect(page.querySelector('[data-testid="catalog-upcoming"]')?.contains(
      page.querySelector('[data-testid="tourney-window-next"]'),
    )).toBe(true);
    expect(page.querySelector('[data-testid="catalog-ended"]')?.textContent).toMatch(
      /No ended tournaments yet/,
    );
    expect(page.querySelector('[data-testid="download-board"]')).toBeNull();
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
      /16–17 Aug/,
    );
    expect(page.querySelector('[data-testid="tournament-window"]')?.textContent).not.toMatch(
      /→|· 1d/,
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
    expect(page.querySelector('[data-testid="back-link"]')?.textContent).toMatch(/Back to home/);
    expect(page.querySelector('[data-testid="back-link"]')?.getAttribute("href")).toBe("/");
    expect(page.textContent).not.toMatch(/All tournaments/);
    const podium = page.querySelector('[data-testid="tournament-podium"]');
    expect(podium).not.toBeNull();
    expect(podium?.textContent).toMatch(/Ada/);
    expect(podium?.textContent).toMatch(/Bea/);
    expect(podium?.querySelector(".place-1")?.textContent).toMatch(/Ada/);
    expect(podium?.querySelector(".place-2")?.textContent).toMatch(/Bea/);
    expect(page.querySelector(".place-1")?.getAttribute("href")).toBe("/tournaments/live/farm/1");
    const download = page.querySelector('[data-testid="download-board"]') as HTMLButtonElement;
    expect(download).not.toBeNull();
    expect(download.disabled).toBe(false);
    expect(download.getAttribute("aria-label")).toBe("Download image");
    expect(download.querySelector("svg")).not.toBeNull();
    expect(download.textContent).not.toMatch(/Download image/);
    await act(async () => {
      download.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(downloadTournamentBoardImage).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Test Tournament 2",
        prize_amount: "30",
        total_count: 2,
      }),
    );
    const payload = downloadTournamentBoardImage.mock.calls[0]?.[0] as {
      entries: LeaderboardEntry[];
    };
    expect(payload.entries.map((row) => row.name)).toEqual(["Ada", "Bea"]);
  });

  it("shows each event's own podium from that event's standings", async () => {
    const cupA = summary({ tournament_id: "cup-a", name: "Cup A", status: "active" });
    const cupB = summary({ tournament_id: "cup-b", name: "Cup B", status: "active" });
    fetchTournament.mockImplementation(async (id: string) => {
      if (id === "cup-a") {
        return archive(cupA, [
          entry({ farm_id: "a1", rank: 1, score: 10, name: "AlphaLead", digs_to_third_op: 10 }),
          entry({ farm_id: "a2", rank: 2, score: 12, name: "AlphaTwo", digs_to_third_op: 12 }),
          entry({ farm_id: "a3", rank: 3, score: 14, name: "AlphaThree", digs_to_third_op: 14 }),
        ]);
      }
      return archive(cupB, [
        entry({ farm_id: "b1", rank: 1, score: 20, name: "BravoLead", digs_to_third_op: 20 }),
        entry({ farm_id: "b2", rank: 2, score: 22, name: "BravoTwo", digs_to_third_op: 22 }),
        entry({ farm_id: "b3", rank: 3, score: 24, name: "BravoThree", digs_to_third_op: 24 }),
      ]);
    });
    const first = await renderAt("/tournaments/cup-a");
    const podiumA = first.querySelector('[data-testid="tournament-podium"]');
    expect(podiumA?.querySelector(".place-1")?.textContent).toMatch(/AlphaLead/);
    expect(podiumA?.querySelector(".place-2")?.textContent).toMatch(/AlphaTwo/);
    expect(podiumA?.querySelector(".place-3")?.textContent).toMatch(/AlphaThree/);
    expect(podiumA?.textContent).not.toMatch(/BravoLead/);
    act(() => {
      root.unmount();
    });
    container.remove();
    const second = await renderAt("/tournaments/cup-b");
    const podiumB = second.querySelector('[data-testid="tournament-podium"]');
    expect(podiumB?.querySelector(".place-1")?.textContent).toMatch(/BravoLead/);
    expect(podiumB?.querySelector(".place-2")?.textContent).toMatch(/BravoTwo/);
    expect(podiumB?.querySelector(".place-3")?.textContent).toMatch(/BravoThree/);
    expect(podiumB?.textContent).not.toMatch(/AlphaLead/);
  });

  it("hides the join button when accepts_joins is false", async () => {
    const live = summary({
      tournament_id: "live",
      name: "Creators Digging Tournament",
      status: "active",
    });
    fetchTournament.mockResolvedValue({
      ...archive(live, [entry({ farm_id: "1", rank: 1, score: 14, name: "rmr" })]),
      accepts_joins: false,
    });
    const page = await renderAt("/tournaments/live", { from: "home" });
    expect(page.querySelector('[data-testid="join-tournament"]')).toBeNull();
    expect(page.querySelector('[data-testid="join-detail"]')).toBeNull();
    expect(page.querySelector('[data-testid="join-need-connect"]')).toBeNull();
  });

  it("returns to the catalog when the tournament was opened from there", async () => {
    const live = summary({
      tournament_id: "live",
      name: "Creators Digging Tournament",
      status: "active",
    });
    fetchTournament.mockResolvedValue(archive(live, []));
    const page = await renderAt("/tournaments/live", { from: "tournaments" });
    const back = page.querySelector('[data-testid="back-link"]');
    expect(back?.textContent).toMatch(/Back to tournaments/);
    expect(back?.getAttribute("href")).toBe("/tournaments");
    expect(page.textContent).not.toMatch(/← Home/);
    const download = page.querySelector('[data-testid="download-board"]') as HTMLButtonElement;
    expect(download.disabled).toBe(true);
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
