import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LeaderboardEntry,
  PrizePlace,
  TournamentArchive,
  TournamentSummary,
} from "../api/public";

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
import {
  displayPrizePlaces,
  isLongRewardText,
  prizePlaceCountLabel,
  showMorePrizes,
  showViewAllWinners,
  showWinnersStrip,
  TournamentsPage,
} from "./TournamentsPage";

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
      description: row.description,
      min_bumpkin_island: row.min_bumpkin_island,
      min_digging_streak: row.min_digging_streak,
      vip_required: row.vip_required,
      max_players: row.max_players,
      enrolled_count: row.enrolled_count,
      join_mode: row.join_mode,
      prize_places: row.prize_places,
    },
    entries,
    count: entries.length,
    leader_farm_id: entries[0]?.farm_id ?? null,
    overall_average_per_day: 4.5,
    accepts_joins: row.status === "scheduled" || row.status === "active",
  };
}

function places(...items: PrizePlace[]): PrizePlace[] {
  return items;
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
  it("lists live and upcoming windows with prize and farm count from the catalog payload", async () => {
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
      prize_amount: "100",
      count: 6,
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
    const page = await renderAt("/tournaments");
    expect(page.querySelector('[data-testid="farm-id-gate"]')).toBeNull();
    expect(page.querySelector('[data-testid="tournaments-title"]')?.textContent).toMatch(
      /Tournaments/,
    );
    expect(page.querySelector('[data-testid="tournaments-title"]')?.textContent).not.toMatch(
      /Windows/,
    );
    expect(page.textContent).not.toMatch(
      /Each tournament is its own board. Join one, dig for three Otter Pebbles/,
    );
    expect(page.textContent).not.toMatch(/Create tournament/);
    const ongoing = page.querySelector('[data-testid="catalog-ongoing"]');
    const upcoming = page.querySelector('[data-testid="catalog-upcoming"]');
    const ended = page.querySelector('[data-testid="catalog-ended"]');
    expect(ongoing?.textContent).toMatch(/Live/);
    expect(upcoming?.textContent).toMatch(/Upcoming/);
    expect(ended?.textContent).toMatch(/Past/);
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
    expect(page.querySelector('[data-testid="tourney-window-soon"]')?.textContent).toMatch(
      /100 Flower/,
    );
    expect(page.querySelector('[data-testid="tourney-window-soon"]')?.textContent).toMatch(/6/);
    expect(ended?.textContent).toMatch(/30 Flower/);
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
    expect(
      page
        .querySelector('[data-testid="catalog-ongoing"]')
        ?.contains(page.querySelector('[data-testid="tourney-window-live"]')),
    ).toBe(true);
    expect(
      page
        .querySelector('[data-testid="catalog-upcoming"]')
        ?.contains(page.querySelector('[data-testid="tourney-window-next"]')),
    ).toBe(true);
    expect(page.querySelector('[data-testid="catalog-ended"]')?.textContent).toMatch(
      /No past tournaments yet/,
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

  it("shows start to end, prize, participants, and omits overall average per day from facts", async () => {
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
      /16 Aug – 16 Aug/,
    );
    expect(page.querySelector('[data-testid="tournament-window"]')?.textContent).not.toMatch(
      /→|· 1d/,
    );
    expect(page.querySelector("h1")?.textContent).toMatch(/Test Tournament 2/);
    expect(page.querySelector('[data-testid="tournament-prize"]')?.textContent).toMatch(
      /30 \$Flower/,
    );
    expect(page.querySelector('[data-testid="tournament-participants"]')?.textContent).toMatch(/2/);
    expect(page.querySelector('[data-testid="tournament-overall-avg"]')).toBeNull();
    const body = page.querySelector('[data-testid="tournament-detail-body"]');
    expect(body).not.toBeNull();
    expect(body?.textContent).not.toMatch(/Avg\s*\/\s*day/i);
    expect(body?.textContent).not.toMatch(/average per day/i);
    expect(page.querySelector('[data-testid="prize-place-count"]')?.textContent).toMatch(
      /1 player wins/,
    );
    expect(page.querySelector('[data-testid="prize-place-card-1"]')?.textContent).toMatch(
      /30 \$Flower/,
    );
    expect(page.querySelector('[data-testid="prize-place-card-2"]')).toBeNull();
    expect(page.querySelector('[data-testid="view-all-winners"]')).toBeNull();
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
    expect(page.textContent).not.toMatch(/All windows/);
    expect(page.querySelector('[data-testid="tournament-prizes"]')).not.toBeNull();
    const podium = page.querySelector('[data-testid="tournament-podium"]');
    expect(page.querySelector('[data-testid="tournament-winners"]')).not.toBeNull();
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

  it("shows two-column winners and stats, NFT medals, and view-all for more than three places", async () => {
    const live = summary({
      tournament_id: "live",
      name: "Settings cup",
      status: "active",
      description: "Bring a shovel.",
      start_at: "2026-08-23T00:00:00.000Z",
      end_at: "2026-08-31T00:00:00.000Z",
      duration_days: 8,
      min_bumpkin_island: "desert",
      min_digging_streak: null,
      vip_required: true,
      max_players: 32,
      enrolled_count: 4,
      join_mode: "auto",
      prize_places: [
        { place: 1, amount: "50", nft_name: "Rare Key" },
        { place: 2, amount: "20" },
        { place: 3, amount: "10" },
        { place: 4, amount: "5" },
      ],
      prize_amount: "85",
      count: 4,
    });
    fetchTournament.mockResolvedValue(archive(live, []));
    const page = await renderAt("/tournaments/live");
    expect(page.querySelector('[data-testid="tournament-description"]')?.textContent).toMatch(
      /Bring a shovel/,
    );
    expect(page.querySelector('[data-testid="tournament-window"]')?.textContent).toMatch(
      /23 Aug – 30 Aug/,
    );
    expect(page.querySelector('[data-testid="tournament-start-day"]')).toBeNull();
    expect(page.querySelector('[data-testid="tournament-final-day"]')).toBeNull();
    const body = page.querySelector('[data-testid="tournament-detail-body"]');
    expect(body).not.toBeNull();
    expect(body?.querySelector('[data-testid="tournament-prizes"]')).not.toBeNull();
    expect(body?.querySelector(".detail-stat-list")).not.toBeNull();
    expect(page.querySelector('[data-testid="prize-place-count"]')?.textContent).toMatch(
      /4 players win/,
    );
    expect(page.querySelector('[data-testid="tournament-participants"]')?.textContent).toMatch(
      /4 \/ 32/,
    );
    expect(page.querySelector('[data-testid="tournament-island"]')?.textContent).toMatch(
      /Min island\s*Desert/,
    );
    expect(page.querySelector('[data-testid="tournament-streak"]')?.textContent).toMatch(
      /Min dig streak\s*None/,
    );
    expect(page.querySelector('[data-testid="tournament-vip"]')?.textContent).toMatch(
      /VIP status\s*Yes/,
    );
    expect(page.querySelector('[data-testid="tournament-vip"] .yes')).not.toBeNull();
    expect(page.querySelector('[data-testid="tournament-join-mode"]')?.textContent).toMatch(
      /Needs approval\s*No/,
    );
    expect(page.querySelector('[data-testid="tournament-join-mode"] .no')).not.toBeNull();
    expect(page.querySelector('[data-testid="tournament-min-level"]')).toBeNull();
    expect(page.querySelector('[data-testid="tournament-overall-avg"]')).toBeNull();
    expect(body?.textContent).not.toMatch(/Avg\s*\/\s*day/i);
    const prizes = page.querySelector('[data-testid="tournament-prize-places"]');
    expect(prizes?.querySelector('[data-testid="prize-place-card-1"]')?.textContent).toMatch(/1st/);
    expect(prizes?.querySelector('[data-testid="prize-place-card-1"]')?.textContent).toMatch(
      /50 \$Flower/,
    );
    expect(prizes?.querySelector('[data-testid="prize-place-card-1"]')?.textContent).toMatch(
      /Rare Key/,
    );
    expect(prizes?.querySelector('[data-testid="prize-place-card-2"]')?.textContent).toMatch(
      /20 \$Flower/,
    );
    expect(prizes?.querySelector('[data-testid="prize-place-card-3"]')?.textContent).toMatch(
      /10 \$Flower/,
    );
    expect(prizes?.querySelector('[data-testid="prize-place-card-4"]')).toBeNull();
    expect(page.querySelector('[data-testid="tournament-winners"]')).toBeNull();
    expect(page.querySelector('[data-testid="view-all-winners"]')).toBeNull();
    const morePrizes = page.querySelector(
      '[data-testid="tournament-more-prizes"]',
    ) as HTMLButtonElement;
    expect(morePrizes).not.toBeNull();
    expect(page.querySelector('[data-testid="tournament-prizes-modal"]')).toBeNull();
    act(() => {
      morePrizes.click();
    });
    const modal = page.querySelector('[data-testid="tournament-prizes-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toMatch(/4th/);
    expect(modal?.textContent).toMatch(/5 \$Flower/);
    expect(modal?.textContent).not.toMatch(/Avg\s*\/\s*day/i);
    expect(modal?.textContent).not.toMatch(/average per day/i);
    expect(page.querySelector('[data-testid="join-copy"]')?.textContent).toMatch(
      /enrolled immediately/,
    );
  });

  it("marks long prize reward text with the is-long class for smaller wrap", async () => {
    const live = summary({
      tournament_id: "live",
      name: "Long prize cup",
      status: "active",
      prize_places: [
        {
          place: 1,
          amount: "1000",
          nft_name: "Ultra Rare Legendary Digging Trophy NFT",
        },
        { place: 2, amount: "5" },
      ],
      prize_amount: "1005",
    });
    fetchTournament.mockResolvedValue({
      ...archive(live, []),
      config: {
        ...archive(live, []).config,
        prize_places: live.prize_places,
      },
    });
    expect(
      isLongRewardText({
        place: 1,
        amount: "1000",
        nft_name: "Ultra Rare Legendary Digging Trophy NFT",
      }),
    ).toBe(true);
    expect(isLongRewardText({ place: 2, amount: "5" })).toBe(false);
    const page = await renderAt("/tournaments/live");
    expect(
      page.querySelector('[data-testid="prize-place-reward-1"]')?.classList.contains("is-long"),
    ).toBe(true);
    expect(
      page.querySelector('[data-testid="prize-place-reward-2"]')?.classList.contains("is-long"),
    ).toBe(false);
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.prize-place-reward\s*\{[^}]*-webkit-line-clamp:\s*2/s);
    expect(css).toMatch(/\.prize-place-reward\.is-long\s*\{[^}]*font-size:\s*12px/s);
    expect(css).toMatch(/\.winners-card\s*\{/);
    expect(css).toMatch(/\.medal\.gold\s+\.medal-dot/);
    expect(css).toMatch(/\.medal\.silver\s+\.medal-dot/);
    expect(css).toMatch(/\.medal\.bronze\s+\.medal-dot/);
    expect(css).toMatch(/\.view-all-winners\s*\{[^}]*border:\s*1px dashed/s);
    expect(css).toMatch(/\.detail-stat-list\s*\{/);
  });

  it("renders min dig streak and max players as None when unset", async () => {
    const live = summary({
      tournament_id: "live",
      name: "Open cup",
      status: "active",
      min_digging_streak: null,
      max_players: null,
      enrolled_count: 6,
      prize_places: [{ place: 1, amount: "30" }],
    });
    fetchTournament.mockResolvedValue(archive(live, []));
    const page = await renderAt("/tournaments/live");
    expect(page.querySelector('[data-testid="tournament-streak"]')?.textContent).toMatch(/None/);
    expect(page.querySelector('[data-testid="tournament-participants"]')?.textContent).toMatch(
      /6 \/ None/,
    );
    expect(page.querySelector('[data-testid="prize-place-count"]')?.textContent).toMatch(
      /1 player wins/,
    );
    expect(page.querySelector('[data-testid="prize-place-card-1"]')?.textContent).toMatch(
      /30 \$Flower/,
    );
    expect(page.querySelector('[data-testid="prize-place-card-2"]')).toBeNull();
    expect(page.querySelector('[data-testid="view-all-winners"]')).toBeNull();
  });

  it("hides the farm podium and view-all when ranked winners are fewer than 2", async () => {
    const solo = [entry({ farm_id: "1", rank: 1, score: 10, name: "OnlyOne" })];
    expect(showWinnersStrip(solo)).toBe(false);
    expect(showViewAllWinners(solo)).toBe(false);
    expect(displayPrizePlaces([{ place: 1, amount: "30" }], "30")).toEqual([
      { place: 1, amount: "30" },
    ]);
    expect(prizePlaceCountLabel(1)).toBe("1 player wins");
    const live = summary({
      tournament_id: "live",
      name: "Solo",
      status: "active",
      prize_places: [{ place: 1, amount: "30" }],
    });
    fetchTournament.mockResolvedValue(archive(live, solo));
    const page = await renderAt("/tournaments/live");
    expect(page.querySelector('[data-testid="tournament-winners"]')).toBeNull();
    expect(page.querySelector('[data-testid="tournament-podium"]')).toBeNull();
    expect(page.querySelector('[data-testid="view-all-winners"]')).toBeNull();
    expect(page.querySelector('[data-testid="prize-place-card-1"]')?.textContent).toMatch(/1st/);
    expect(page.querySelector('[data-testid="prize-place-card-2"]')).toBeNull();
    expect(page.textContent).toMatch(/OnlyOne/);
  });

  it("shows prize rows for 2–3 places without a more-prizes control", async () => {
    const two = places({ place: 1, amount: "20" }, { place: 2, amount: "10" });
    const three = places(
      { place: 1, amount: "20" },
      { place: 2, amount: "10" },
      { place: 3, amount: "5" },
    );
    expect(showMorePrizes(two)).toBe(false);
    expect(showMorePrizes(three)).toBe(false);
    expect(prizePlaceCountLabel(3)).toBe("3 players win");
    const live = summary({
      tournament_id: "live",
      name: "Trio prizes",
      status: "active",
      prize_places: three,
      prize_amount: "35",
    });
    fetchTournament.mockResolvedValue(archive(live, []));
    const page = await renderAt("/tournaments/live");
    expect(page.querySelector('[data-testid="prize-place-count"]')?.textContent).toMatch(
      /3 players win/,
    );
    expect(page.querySelector('[data-testid="prize-place-card-1"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="prize-place-card-2"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="prize-place-card-3"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="tournament-more-prizes"]')).toBeNull();
    expect(page.querySelector('[data-testid="tournament-winners"]')).toBeNull();
    expect(page.querySelector('[data-testid="view-all-winners"]')).toBeNull();
  });

  it("shows the farm podium without view-all for 2–3 ranked winners", async () => {
    const three = [
      entry({ farm_id: "1", rank: 1, score: 10, name: "A" }),
      entry({ farm_id: "2", rank: 2, score: 12, name: "B" }),
      entry({ farm_id: "3", rank: 3, score: 14, name: "C" }),
    ];
    expect(showWinnersStrip(three)).toBe(true);
    expect(showViewAllWinners(three)).toBe(false);
    const live = summary({ tournament_id: "live", name: "Trio", status: "active" });
    fetchTournament.mockResolvedValue(archive(live, three));
    const page = await renderAt("/tournaments/live");
    expect(page.querySelector('[data-testid="tournament-winners"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="tournament-podium"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="view-all-winners"]')).toBeNull();
  });

  it("shows a prizes overlay for more than three prize places", async () => {
    const four = places(
      { place: 1, amount: "40" },
      { place: 2, amount: "20" },
      { place: 3, amount: "10" },
      { place: 4, amount: "5", nft_name: "Dusty Pick" },
    );
    expect(showMorePrizes(four)).toBe(true);
    expect(prizePlaceCountLabel(4)).toBe("4 players win");
    const live = summary({
      tournament_id: "live",
      name: "Crowd prizes",
      status: "active",
      prize_places: four,
      prize_amount: "75",
    });
    fetchTournament.mockResolvedValue(archive(live, []));
    const page = await renderAt("/tournaments/live");
    const more = page.querySelector('[data-testid="tournament-more-prizes"]') as HTMLButtonElement;
    expect(more).not.toBeNull();
    expect(page.querySelector('[data-testid="view-all-winners"]')).toBeNull();
    act(() => {
      more.click();
    });
    const modal = page.querySelector('[data-testid="tournament-prizes-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toMatch(/4th/);
    expect(modal?.textContent).toMatch(/Dusty Pick/);
    expect(modal?.textContent).not.toMatch(/Avg\s*\/\s*day/i);
  });

  it("shows view-all winners overlay without avg/day when ranked winners exceed 3", async () => {
    const four = [
      entry({ farm_id: "1", rank: 1, score: 10, name: "A", digs_to_third_op: 10 }),
      entry({ farm_id: "2", rank: 2, score: 12, name: "B", digs_to_third_op: 12 }),
      entry({ farm_id: "3", rank: 3, score: 14, name: "C", digs_to_third_op: 14 }),
      entry({ farm_id: "4", rank: 4, score: 16, name: "D", digs_to_third_op: 16 }),
    ];
    expect(showViewAllWinners(four)).toBe(true);
    const live = summary({ tournament_id: "live", name: "Crowd", status: "active" });
    fetchTournament.mockResolvedValue(archive(live, four));
    const page = await renderAt("/tournaments/live");
    expect(page.querySelector('[data-testid="tournament-winners"]')).not.toBeNull();
    const viewAll = page.querySelector('[data-testid="view-all-winners"]') as HTMLButtonElement;
    expect(viewAll).not.toBeNull();
    expect(page.querySelector('[data-testid="tournament-winners-modal"]')).toBeNull();
    act(() => {
      viewAll.click();
    });
    const modal = page.querySelector('[data-testid="tournament-winners-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toMatch(/A/);
    expect(modal?.textContent).toMatch(/D/);
    expect(modal?.textContent).not.toMatch(/Avg\s*\/\s*day/i);
    expect(modal?.textContent).not.toMatch(/average per day/i);
  });

  it("uses must-confirm join copy when join_mode is confirm", async () => {
    const next = summary({
      tournament_id: "next",
      name: "Confirm cup",
      status: "scheduled",
      join_mode: "confirm",
      description: "Wait for approval.",
    });
    fetchTournament.mockResolvedValue({
      ...archive(next, []),
      config: {
        ...archive(next, []).config,
        join_mode: "confirm",
        description: "Wait for approval.",
      },
    });
    const page = await renderAt("/tournaments/next");
    expect(page.querySelector('[data-testid="tournament-description"]')?.textContent).toMatch(
      /Wait for approval/,
    );
    expect(page.querySelector('[data-testid="tournament-join-mode"]')?.textContent).toMatch(
      /Needs approval\s*Yes/,
    );
    expect(page.querySelector('[data-testid="tournament-join-mode"] .yes')).not.toBeNull();
    expect(page.querySelector('[data-testid="join-copy"]')?.textContent).toMatch(
      /admin will approve/,
    );
  });

  it("lists compact island, streak, VIP, and joined/total on catalog cards", async () => {
    const live = summary({
      tournament_id: "live",
      name: "Settings cup",
      status: "active",
      description: "Bring a shovel.",
      min_bumpkin_island: "spring",
      min_digging_streak: null,
      vip_required: false,
      max_players: 8,
      enrolled_count: 2,
      join_mode: "auto",
      prize_places: [{ place: 1, amount: "40" }],
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    const page = await renderAt("/tournaments");
    expect(page.querySelector('[data-testid="tourney-desc-live"]')?.textContent).toMatch(
      /Bring a shovel/,
    );
    expect(page.querySelector('[data-testid="tourney-prizes-live"]')?.textContent).toMatch(
      /1st 40 Flower/,
    );
    expect(page.querySelector('[data-testid="tourney-island-live"]')?.textContent).toMatch(
      /Spring/,
    );
    expect(page.querySelector('[data-testid="tourney-streak-live"]')?.textContent).toMatch(/None/);
    expect(page.querySelector('[data-testid="tourney-vip-live"]')?.textContent).toMatch(/No/);
    expect(page.querySelector('[data-testid="tourney-participants-live"]')?.textContent).toMatch(
      /2\/8/,
    );
    expect(page.querySelector('[data-testid="tourney-min-level-live"]')).toBeNull();
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
