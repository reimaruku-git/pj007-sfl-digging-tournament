import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardEntry, TournamentArchive, TournamentSummary } from "../api/public";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const listTournaments = vi.fn();
const fetchTournament = vi.fn();
const fetchFarm = vi.fn();

vi.mock("../api/public", () => ({
  listTournaments: (...args: unknown[]) => listTournaments(...args),
  fetchTournament: (...args: unknown[]) => fetchTournament(...args),
  fetchFarm: (...args: unknown[]) => fetchFarm(...args),
}));

import { FarmSessionProvider } from "../lib/farmSession";
import { writeFarmIdentity } from "../lib/followFarm";
import { LeaderboardPage } from "./LeaderboardPage";

let root: Root;
let container: HTMLDivElement;

function summary(
  partial: Partial<TournamentSummary> &
    Pick<TournamentSummary, "tournament_id" | "name" | "status">,
): TournamentSummary {
  return {
    start_at: "2026-08-22T00:00:00.000Z",
    end_at: "2026-08-28T00:00:00.000Z",
    duration_days: 7,
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
    score_today: 10,
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
    overall_average_per_day: entries.length ? entries[0].score : null,
    accepts_joins: true,
  };
}

async function renderHome() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <FarmSessionProvider>
            <LeaderboardPage />
          </FarmSessionProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  return container;
}

beforeEach(() => {
  listTournaments.mockReset();
  fetchTournament.mockReset();
  fetchFarm.mockReset();
  fetchFarm.mockRejectedValue(new Error("farm not found"));
  writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
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

describe("LeaderboardPage home", () => {
  it("stacks hero, top three, standings, then our rules", async () => {
    const live = summary({
      tournament_id: "sprint",
      name: "Creators Digging Tournament",
      status: "active",
      prize_amount: "100",
      count: 6,
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(
      archive(live, [
        entry({
          farm_id: "3666918801844311",
          rank: 1,
          score: 27.57,
          name: "rmr",
          digs_to_third_op: 193,
          score_today: 27,
        }),
        entry({
          farm_id: "218",
          rank: 2,
          score: 31.14,
          name: "Farm 218",
          digs_to_third_op: 218,
          score_today: 32,
        }),
        entry({
          farm_id: "219",
          rank: 3,
          score: 31.29,
          name: "Farm 219",
          digs_to_third_op: 219,
          score_today: 31,
        }),
      ]),
    );
    fetchFarm.mockResolvedValue(
      entry({
        farm_id: "3666918801844311",
        name: "rmr",
        rank: 1,
        score: 27.57,
        recorded_average_per_day: 27.57,
        score_today: 27,
        digs_to_third_op: 193,
      }),
    );

    const page = await renderHome();
    const hero = page.querySelector('[data-testid="home-hero"]') as HTMLElement;
    const podium = page.querySelector('[data-testid="top-three"]') as HTMLElement;
    const standings = page.querySelector('[data-testid="standings"]') as HTMLElement;
    const rules = page.querySelector("#rules") as HTMLElement;
    expect(hero).not.toBeNull();
    expect(podium).not.toBeNull();
    expect(standings).not.toBeNull();
    expect(rules).not.toBeNull();
    expect(hero.compareDocumentPosition(podium) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(podium.compareDocumentPosition(standings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(standings.compareDocumentPosition(rules) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(hero.textContent).toMatch(/Creators Digging Tournament/);
    expect(page.querySelector('[data-testid="hero-prize"]')?.previousElementSibling?.textContent).toBe(
      "Top Prize",
    );
    expect(page.querySelector('[data-testid="hero-prize"]')?.textContent).toBe("100 $Flower");
    expect(page.querySelector('[data-testid="hero-farms"]')?.textContent).toBe("6");
    expect(page.querySelector('[data-testid="see-tournaments"]')?.getAttribute("href")).toBe(
      "/tournaments",
    );
    expect(page.querySelector('[data-testid="see-tournaments"]')?.textContent).toMatch(
      /See tournaments/,
    );

    expect(podium.textContent).toMatch(/Top three/);
    expect(podium.querySelector(".place-1")?.textContent).toMatch(/rmr/);
    expect(podium.querySelector(".place-1")?.textContent).toMatch(/193/);
    expect(podium.querySelector(".place-2")?.textContent).toMatch(/Farm 218/);
    expect(podium.querySelector(".place-3")?.textContent).toMatch(/Farm 219/);

    expect(standings.textContent).toMatch(/Standings/);
    expect(standings.textContent).toMatch(/Total/);
    expect(standings.textContent).toMatch(/Today/);
    expect(standings.textContent).toMatch(/Pebbles/);
    expect(standings.textContent).toMatch(/Avg \/ day/);
    expect(page.querySelector('[data-testid="you-farm-name"]')?.textContent).toBe("rmr");
    expect(page.querySelector('[data-testid="you-farm-avg"]')?.textContent).toMatch(/27\.57/);

    expect(rules.textContent).toMatch(/Counts as 1 dig/);
    expect(rules.textContent).toMatch(/Counts as 4 digs/);
    expect(rules.textContent).toMatch(/last dig of those 4/);
    expect(rules.textContent).toMatch(/only on days that already have a recorded score/);
    expect(rules.textContent).toMatch(/14:00, 16:00, 18:00, 20:00, 23:00 UTC/);
    expect(rules.querySelector("strong")?.textContent).toBe("Digs after 23:00 UTC do not count");
    expect(rules.textContent).toMatch(/worst finisher that day or 30/);
    expect(rules.textContent).toMatch(/5 for every missing pebble/);
    expect(rules.textContent).toMatch(/Average of 3rd pebble, then 2nd, then 1st/);
    expect(rules.textContent).toMatch(/How a tournament is scored/);
    expect(rules.textContent).not.toMatch(/How a window is won/);
    expect(rules.textContent).not.toMatch(/Enter a window/);
    expect(rules.textContent).not.toMatch(/Hunt three pebbles/);
    expect(rules.textContent).not.toMatch(/Spend fewer strokes/);
    expect(page.textContent).not.toMatch(/\bWindows\b/);
    expect(page.textContent).not.toMatch(
      /Lowest average of days that already have a 3rd-pebble score/,
    );
    expect(page.textContent).not.toMatch(/Unofficial fan board for Sunflower Land digging/);
    expect(page.textContent).not.toMatch(/Fewest digs to three Otter Pebbles/);
    expect(page.querySelector("#past")).toBeNull();
    expect(page.querySelector('[data-testid="tourney-home"]')).toBeNull();
    expect(page.querySelector('[data-testid="featured-link"]')?.getAttribute("href")).toBe(
      "/tournaments/sprint",
    );
    expect(page.textContent).not.toMatch(/By rank/);
    expect(page.textContent).not.toMatch(/By today/);
  });

  it("uses color canvases instead of raster photos", async () => {
    const live = summary({
      tournament_id: "sprint",
      name: "Creators Digging Tournament",
      status: "active",
      count: 1,
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(
      archive(live, [
        entry({ farm_id: "1", rank: 1, score: 10, name: "Alpha", digs_to_third_op: 10 }),
        entry({ farm_id: "2", rank: 2, score: 12, name: "Beta", digs_to_third_op: 12 }),
        entry({ farm_id: "3", rank: 3, score: 14, name: "Gamma", digs_to_third_op: 14 }),
      ]),
    );

    const page = await renderHome();
    const canvases = page.querySelectorAll('[data-testid="color-canvas"]');
    expect(canvases.length).toBeGreaterThan(3);
    expect(page.querySelector("img")).toBeNull();
    expect([...canvases].every((node) => !node.getAttribute("src"))).toBe(true);
    expect(page.querySelector(".live-hero-art")).not.toBeNull();
    expect(page.querySelector(".place-1 [data-testid='color-canvas']")).not.toBeNull();
    expect(page.querySelector(".you-farm-art [data-testid='color-canvas']")).not.toBeNull();

    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const publicRoot = resolve(srcRoot, "../public");
    const names = [
      ...readdirSync(srcRoot, { recursive: true }).map(String),
      ...readdirSync(publicRoot, { recursive: true }).map(String),
    ];
    expect(names.some((name) => /\.(png|jpe?g)$/i.test(name))).toBe(false);
  });

  it("cycles Avg / day, Today, and Total through asc, desc, then rank order", async () => {
    const live = summary({
      tournament_id: "one",
      name: "First board",
      status: "active",
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(
      archive(live, [
        entry({
          farm_id: "dug",
          rank: 1,
          score: 18,
          score_today: 27,
          digs_to_third_op: 80,
          name: "Dug today",
        }),
        entry({
          farm_id: "idle",
          rank: 2,
          score: 10,
          score_today: 12,
          digs_to_third_op: 40,
          name: "Idle best",
        }),
        entry({
          farm_id: "late",
          rank: 3,
          score: 22,
          score_today: 9,
          digs_to_third_op: 90,
          name: "Late low today",
        }),
      ]),
    );

    const page = await renderHome();
    const firstName = () =>
      page.querySelector('[data-testid="standings"] tbody tr')?.textContent ?? "";
    expect(firstName()).toMatch(/Dug today/);
    expect(page.querySelector('[data-testid="sort-rank"]')).toBeNull();
    expect(page.textContent).not.toMatch(/By rank/);
    expect(page.textContent).not.toMatch(/By today/);

    const avg = page.querySelector('[data-testid="sort-avg"]') as HTMLButtonElement;
    const today = page.querySelector('[data-testid="sort-today"]') as HTMLButtonElement;
    const total = page.querySelector('[data-testid="sort-total"]') as HTMLButtonElement;

    act(() => {
      avg.click();
    });
    expect(firstName()).toMatch(/Idle best/);
    act(() => {
      avg.click();
    });
    expect(firstName()).toMatch(/Late low today/);
    act(() => {
      avg.click();
    });
    expect(firstName()).toMatch(/Dug today/);

    act(() => {
      today.click();
    });
    expect(firstName()).toMatch(/Late low today/);
    act(() => {
      today.click();
    });
    expect(firstName()).toMatch(/Dug today/);
    act(() => {
      today.click();
    });
    expect(firstName()).toMatch(/Dug today/);

    act(() => {
      total.click();
    });
    expect(firstName()).toMatch(/Idle best/);
    act(() => {
      total.click();
    });
    expect(firstName()).toMatch(/Late low today/);
    act(() => {
      total.click();
    });
    expect(firstName()).toMatch(/Dug today/);
  });

  it("shows only the admin-featured board, including an ended event", async () => {
    const soon = summary({
      tournament_id: "soon",
      name: "Ends first",
      status: "active",
      end_at: "2026-08-25T00:00:00.000Z",
      count: 2,
    });
    const later = summary({
      tournament_id: "later",
      name: "Ends later",
      status: "active",
      end_at: "2026-08-30T00:00:00.000Z",
      count: 4,
    });
    const ended = summary({
      tournament_id: "past-cup",
      name: "Old cup",
      status: "ended",
      start_at: "2026-07-01T00:00:00.000Z",
      end_at: "2026-07-08T00:00:00.000Z",
    });
    listTournaments.mockResolvedValue({
      tournaments: [later, ended, soon],
      count: 3,
      featured_tournament_id: "past-cup",
    });
    fetchTournament.mockImplementation(async (id: string) => {
      if (id === "soon") {
        return archive(soon, [
          entry({ farm_id: "alpha", rank: 1, score: 8, name: "SoonLead", digs_to_third_op: 80 }),
        ]);
      }
      if (id === "later") {
        return archive(later, [
          entry({ farm_id: "bravo", rank: 1, score: 12, name: "LaterLead", digs_to_third_op: 120 }),
        ]);
      }
      return archive(ended, [
        entry({ farm_id: "old", rank: 1, score: 1, name: "OldWinner", digs_to_third_op: 10 }),
      ]);
    });

    const page = await renderHome();
    expect(page.querySelector('[data-testid="live-switcher"]')).toBeNull();
    expect(page.querySelector('[data-testid="live-board-soon"]')).toBeNull();
    expect(page.querySelector('[data-testid="live-board-later"]')).toBeNull();
    expect(page.querySelector('[data-testid="live-board-past-cup"]')?.textContent).toMatch(
      /OldWinner/,
    );
    expect(page.textContent).not.toMatch(/SoonLead/);
    expect(page.textContent).not.toMatch(/LaterLead/);
    expect(page.querySelector('[data-testid="featured-link"]')?.getAttribute("href")).toBe(
      "/tournaments/past-cup",
    );
    expect(page.querySelector('[data-testid="home-hero"]')?.textContent).toMatch(/Old cup/);
    expect(page.querySelector('[data-testid="hero-remaining"]')?.textContent).toBe("Ended");
    expect(page.querySelector('[data-testid="hero-remaining"]')?.textContent).not.toMatch(
      /Ends today/,
    );
    const fetched = fetchTournament.mock.calls.map((call) => call[0]);
    expect(fetched).toEqual(["past-cup"]);
  });

  it("shows the inclusive last playable day, not exclusive end_at", async () => {
    const live = summary({
      tournament_id: "week",
      name: "August sprint",
      status: "active",
      start_at: "2026-08-17T00:00:00.000Z",
      end_at: "2026-08-24T00:00:00.000Z",
      duration_days: 7,
      prize_amount: "30",
      count: 2,
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(
      archive(live, [entry({ farm_id: "1", rank: 1, score: 10, name: "Alpha" })]),
    );

    const page = await renderHome();
    const hero = page.querySelector('[data-testid="home-hero"]')?.textContent ?? "";
    const digging = page.querySelector('[data-testid="now-digging"]')?.textContent ?? "";
    expect(hero).toMatch(/August 17, 2026 to August 23, 2026/);
    expect(digging).toMatch(/August 17, 2026 to August 23, 2026/);
    expect(hero).not.toMatch(/August 24/);
    expect(digging).not.toMatch(/August 24/);
  });

  it("shows Top Prize as 1st-place Flower only", async () => {
    const live = summary({
      tournament_id: "flower",
      name: "Flower cup",
      status: "active",
      prize_amount: "100",
      prize_places: [{ place: 1, amount: "100" }],
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(archive(live, []));
    const page = await renderHome();
    expect(
      page.querySelector('[data-testid="hero-prize"]')?.previousElementSibling?.textContent,
    ).toBe("Top Prize");
    expect(page.querySelector('[data-testid="hero-prize"]')?.textContent).toBe("100 $Flower");
  });

  it("shows Top Prize as 1st-place NFT only, omitting a zero Flower amount", async () => {
    const live = summary({
      tournament_id: "nft",
      name: "NFT cup",
      status: "active",
      prize_amount: "0",
      prize_places: [{ place: 1, amount: "0", nft_name: "Rare Key" }],
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(archive(live, []));
    const page = await renderHome();
    expect(
      page.querySelector('[data-testid="hero-prize"]')?.previousElementSibling?.textContent,
    ).toBe("Top Prize");
    expect(page.querySelector('[data-testid="hero-prize"]')?.textContent).toBe("Rare Key");
    expect(page.querySelector('[data-testid="hero-prize"]')?.textContent).not.toMatch(/0 \$Flower/);
    expect(page.querySelector('[data-testid="hero-prize"]')?.textContent).not.toMatch(/^0 Flower/);
  });

  it("shows Top Prize as 1st-place Flower and NFT together", async () => {
    const live = summary({
      tournament_id: "both",
      name: "Both cup",
      status: "active",
      prize_amount: "50",
      prize_places: [{ place: 1, amount: "50", nft_name: "Golden Shovel" }],
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(archive(live, []));
    const page = await renderHome();
    expect(
      page.querySelector('[data-testid="hero-prize"]')?.previousElementSibling?.textContent,
    ).toBe("Top Prize");
    expect(page.querySelector('[data-testid="hero-prize"]')?.textContent).toBe(
      "50 $Flower · Golden Shovel",
    );
  });

  it("falls back to the soonest live board when nothing is featured", async () => {
    const soon = summary({
      tournament_id: "soon",
      name: "Ends first",
      status: "active",
      end_at: "2026-08-25T00:00:00.000Z",
    });
    const later = summary({
      tournament_id: "later",
      name: "Ends later",
      status: "active",
      end_at: "2026-08-30T00:00:00.000Z",
    });
    listTournaments.mockResolvedValue({ tournaments: [later, soon], count: 2 });
    fetchTournament.mockImplementation(async (id: string) => {
      if (id === "soon") {
        return archive(soon, [
          entry({ farm_id: "alpha", rank: 1, score: 8, name: "SoonLead", digs_to_third_op: 80 }),
        ]);
      }
      return archive(later, [
        entry({ farm_id: "bravo", rank: 1, score: 12, name: "LaterLead", digs_to_third_op: 120 }),
      ]);
    });

    const page = await renderHome();
    expect(page.querySelector('[data-testid="live-switcher"]')).toBeNull();
    expect(page.querySelector('[data-testid="live-board-soon"]')?.textContent).toMatch(/SoonLead/);
    expect(page.querySelector('[data-testid="live-board-later"]')).toBeNull();
    expect(page.textContent).not.toMatch(/LaterLead/);
    expect(page.querySelector('[data-testid="featured-link"]')?.getAttribute("href")).toBe(
      "/tournaments/soon",
    );
  });

  it("shows empty copy when there is no live tournament", async () => {
    listTournaments.mockResolvedValue({ tournaments: [], count: 0 });
    const page = await renderHome();
    expect(page.querySelector('[data-testid="home-hero"]')).not.toBeNull();
    expect(page.querySelector("#rules")).not.toBeNull();
    expect(page.textContent).toMatch(/No live tournament yet/);
    expect(page.textContent).not.toMatch(/No live window/);
    expect(page.querySelector('[data-testid="now-digging"]')).toBeNull();
    expect(page.querySelector("table.board-table")).toBeNull();
  });
});
