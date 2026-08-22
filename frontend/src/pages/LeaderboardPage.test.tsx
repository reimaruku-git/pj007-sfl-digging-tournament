import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardEntry, TournamentArchive, TournamentSummary } from "../api/public";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const listTournaments = vi.fn();
const fetchTournament = vi.fn();

vi.mock("../api/public", () => ({
  listTournaments: (...args: unknown[]) => listTournaments(...args),
  fetchTournament: (...args: unknown[]) => fetchTournament(...args),
}));

import { PAST_BADGE_ENDED, PAST_CARD_CLASS } from "../components/PastTournamentList";
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
    start_at: "2026-08-10T14:44:00.000Z",
    end_at: "2026-08-20T13:47:00.000Z",
    duration_days: 10,
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
  it("shows empty ongoing and upcoming with no default Active card or boards", async () => {
    listTournaments.mockResolvedValue({ tournaments: [], count: 0 });
    const page = await renderHome();
    expect(page.querySelector('[data-testid="ongoing-group"]')?.textContent).toMatch(/Ongoing/);
    expect(page.querySelector('[data-testid="upcoming-group"]')?.textContent).toMatch(/Upcoming/);
    expect(page.textContent).toMatch(/No ongoing tournament/);
    expect(page.textContent).toMatch(/No upcoming tournaments/);
    expect(page.textContent).not.toMatch(/Finished \/ tracked/);
    expect(page.textContent).not.toMatch(/Active/);
    expect(page.querySelector("table.board-table")).toBeNull();
    expect(page.querySelector('[data-testid^="live-board-"]')).toBeNull();
    expect(page.textContent).not.toMatch(/Create tournament/);
    expect(page.querySelector("#join")).toBeNull();
    expect(page.querySelector('[data-testid="you-farm"]')).toBeNull();
    expect(page.querySelector('[data-testid="latest-result"]')).toBeNull();
    expect(page.querySelector("#past")?.textContent).toMatch(/Past tournaments/);
    expect(page.querySelector("#past")?.textContent).toMatch(/No past tournaments yet/);
    const catalogLink = page.querySelector('[data-testid="home-tournaments-link"]');
    expect(catalogLink?.getAttribute("href")).toBe("/tournaments");
    expect(catalogLink?.textContent).toMatch(/^Tournaments$/);
    expect(page.querySelector('[data-testid="tourney-home"]')?.contains(catalogLink)).toBe(true);
  });

  it("puts a small Tournaments control at the top-right of the ongoing/upcoming panel", async () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.tourney-home-head\s*\{[^}]*justify-content:\s*flex-end/s);
    const sheet = document.createElement("style");
    sheet.textContent = css;
    document.head.appendChild(sheet);
    listTournaments.mockResolvedValue({ tournaments: [], count: 0 });
    try {
      const page = await renderHome();
      const panel = page.querySelector('[data-testid="tourney-home"]') as HTMLElement;
      const head = page.querySelector(".tourney-home-head") as HTMLElement;
      const link = page.querySelector('[data-testid="home-tournaments-link"]') as HTMLAnchorElement;
      const ongoing = page.querySelector('[data-testid="ongoing-group"]') as HTMLElement;
      expect(panel).not.toBeNull();
      expect(head).not.toBeNull();
      expect(link).not.toBeNull();
      expect(panel.contains(head)).toBe(true);
      expect(panel.contains(ongoing)).toBe(true);
      expect(head.contains(link)).toBe(true);
      expect(link.getAttribute("href")).toBe("/tournaments");
      expect(link.textContent).toBe("Tournaments");
      expect(head.compareDocumentPosition(ongoing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(getComputedStyle(head).justifyContent).toBe("flex-end");
      expect(getComputedStyle(head).display).toBe("flex");
    } finally {
      sheet.remove();
    }
  });

  it("renders two parent sections, date-only child cards, and soonest-ending board first", async () => {
    const soon = summary({
      tournament_id: "soon",
      name: "Ends first",
      status: "active",
      start_at: "2026-08-01T14:44:00.000Z",
      end_at: "2026-08-18T13:47:00.000Z",
      duration_days: 17,
    });
    const later = summary({
      tournament_id: "later",
      name: "Ends later",
      status: "active",
      start_at: "2026-08-05T09:10:00.000Z",
      end_at: "2026-08-25T18:00:00.000Z",
      duration_days: 20,
    });
    const upcoming = summary({
      tournament_id: "next",
      name: "September cup",
      status: "scheduled",
      start_at: "2026-09-01T14:00:00.000Z",
      end_at: "2026-09-08T14:00:00.000Z",
      duration_days: 7,
    });
    listTournaments.mockResolvedValue({ tournaments: [later, upcoming, soon], count: 3 });
    fetchTournament.mockImplementation(async (id: string) => {
      if (id === "soon")
        return archive(soon, [entry({ farm_id: "a", rank: 1, score: 1.2, name: "Alpha" })]);
      return archive(later, [entry({ farm_id: "b", rank: 1, score: 2.4, name: "Bravo" })]);
    });

    const page = await renderHome();
    expect(page.querySelector('[data-testid="ongoing-group"]')?.textContent).toMatch(/Ends first/);
    expect(page.querySelector('[data-testid="ongoing-group"]')?.textContent).toMatch(/Ends later/);
    expect(page.querySelector('[data-testid="upcoming-group"]')?.textContent).toMatch(
      /September cup/,
    );
    expect(page.querySelectorAll('[data-testid^="tourney-card-"]')).toHaveLength(3);

    const durationText =
      page.querySelector('[data-testid="tourney-duration-soon"]')?.textContent ?? "";
    expect(durationText).toMatch(/1 Aug → 18 Aug · 17d/);
    expect(durationText).not.toMatch(/\d{2}:\d{2}/);
    expect(durationText).not.toMatch(/UTC/);
    const liveCard = page.querySelector('[data-testid="tourney-card-soon"]');
    const nextRefresh = liveCard?.querySelector('[data-testid="tourney-next-refresh"]');
    expect(liveCard?.textContent).toMatch(/Next refresh/);
    expect(nextRefresh).not.toBeNull();
    expect(nextRefresh?.classList.contains("tourney-next")).toBe(true);
    expect(nextRefresh?.classList.contains("stat")).toBe(false);
    expect(liveCard?.querySelector(".stat")).toBeNull();
    expect(liveCard?.getAttribute("href")).toBe("/tournaments/soon");
    expect(page.querySelector('[data-testid="tourney-card-next"]')?.textContent).not.toMatch(
      /Next refresh/,
    );
    expect(page.querySelector('[data-testid="tourney-card-next"]')?.getAttribute("href")).toBe(
      "/tournaments/next",
    );

    const boards = [...page.querySelectorAll('[data-testid^="live-board-"]')];
    expect(boards).toHaveLength(2);
    expect(boards[0]?.getAttribute("data-testid")).toBe("live-board-soon");
    expect(boards[1]?.getAttribute("data-testid")).toBe("live-board-later");
    expect(boards[0]?.textContent).toMatch(/Total/);
    expect(boards[0]?.textContent).toMatch(/Avg \/ day/);
    expect(boards[0]?.textContent).toMatch(/Today/);
    expect(boards[0]?.textContent).toMatch(/Pebbles/);
    expect(page.querySelector('[data-testid="open-board-soon"]')?.getAttribute("href")).toBe(
      "/tournaments/soon",
    );
    expect(page.querySelector('[data-testid="open-board-later"]')?.getAttribute("href")).toBe(
      "/tournaments/later",
    );
    expect(page.querySelector('[data-testid="open-board-soon"]')?.textContent).toMatch(
      /Ends first/,
    );
    expect(page.querySelector('[data-testid="open-board-soon"]')?.textContent).not.toMatch(
      /Open →/,
    );
    expect(page.querySelector('[data-testid^="download-board"]')).toBeNull();
    expect(page.textContent).not.toMatch(/Download image/);
    expect(page.textContent).not.toMatch(/Finished \/ tracked/);
    expect(page.querySelector('[data-testid="you-farm"]')).toBeNull();
    expect(page.querySelector('[data-testid="latest-result"]')).toBeNull();
    expect(page.querySelector('[data-testid="tournament-podium"]')).toBeNull();
    expect(page.querySelector(".podium")).toBeNull();
    expect(page.querySelector('[aria-label="Top three"]')).toBeNull();
    expect(page.textContent).not.toMatch(/Top three/);
  });

  it("defaults to API rank, cycles avg/day three times, and isolates boards", async () => {
    const first = summary({
      tournament_id: "one",
      name: "First board",
      status: "active",
      end_at: "2026-08-18T00:00:00.000Z",
    });
    const second = summary({
      tournament_id: "two",
      name: "Second board",
      status: "active",
      end_at: "2026-08-22T00:00:00.000Z",
    });
    const laterScores = [11, 12, 13, 14, 15, 16, 17, 19, 21, 22];
    const many = [
      entry({ farm_id: "dug", rank: 1, score: 18, name: "Dug today" }),
      entry({ farm_id: "idle", rank: 2, score: 10, name: "Idle best" }),
      ...laterScores.map((score, index) =>
        entry({
          farm_id: `p${index + 3}`,
          rank: index + 3,
          score,
          name: index === 9 ? "Worst avg" : `Player ${index + 3}`,
        }),
      ),
    ];
    listTournaments.mockResolvedValue({ tournaments: [first, second], count: 2 });
    fetchTournament.mockImplementation(async (id: string) => {
      if (id === "one") return archive(first, many);
      return archive(second, [
        entry({ farm_id: "keep", rank: 1, score: 0.8, name: "Keep me first" }),
        entry({ farm_id: "other", rank: 2, score: 0.4, name: "Better unused avg" }),
      ]);
    });

    const page = await renderHome();
    const firstBoard = page.querySelector('[data-testid="live-board-one"]');
    const secondBoard = page.querySelector('[data-testid="live-board-two"]');
    const sort = page.querySelector('[data-testid="sort-score-one"]') as HTMLButtonElement;
    expect(firstBoard?.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(firstBoard?.textContent).toMatch(/Total/);
    expect(firstBoard?.textContent).toMatch(/Avg \/ day/);
    expect(firstBoard?.textContent).toMatch(/Today/);
    expect(firstBoard?.textContent).toMatch(/Dug today/);
    expect(firstBoard?.textContent).not.toMatch(/Worst avg/);
    expect(firstBoard?.textContent).not.toMatch(/Player 11/);
    expect(sort.getAttribute("data-sort")).toBe("none");
    expect(sort.getAttribute("aria-pressed")).toBe("false");
    expect(sort.textContent).toBe("Avg / day");
    expect(firstBoard?.querySelector("tbody tr")?.textContent).toMatch(/Dug today/);
    expect(secondBoard?.querySelector("tbody tr")?.textContent).toMatch(/Keep me first/);

    act(() => {
      sort.click();
    });
    expect(sort.getAttribute("data-sort")).toBe("asc");
    expect(sort.textContent).toBe("Avg / day ↑");
    expect(firstBoard?.querySelector("tbody tr")?.textContent).toMatch(/Idle best/);
    expect(firstBoard?.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(secondBoard?.querySelector("tbody tr")?.textContent).toMatch(/Keep me first/);

    act(() => {
      sort.click();
    });
    expect(sort.getAttribute("data-sort")).toBe("desc");
    expect(sort.textContent).toBe("Avg / day ↓");
    expect(firstBoard?.querySelector("tbody tr")?.textContent).toMatch(/Worst avg/);
    expect(firstBoard?.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(secondBoard?.querySelector("tbody tr")?.textContent).toMatch(/Keep me first/);
    expect(secondBoard?.querySelector("tbody tr")?.textContent).not.toMatch(/Worst avg/);

    act(() => {
      sort.click();
    });
    expect(sort.getAttribute("data-sort")).toBe("none");
    expect(sort.getAttribute("aria-pressed")).toBe("false");
    expect(sort.textContent).toBe("Avg / day");
    expect(firstBoard?.querySelector("tbody tr")?.textContent).toMatch(/Dug today/);
    expect(secondBoard?.querySelector("tbody tr")?.textContent).toMatch(/Keep me first/);
  });

  it("lists past tournaments newest-end first and omits live join cards", async () => {
    const live = summary({
      tournament_id: "creators",
      name: "Creators Digging Tournament",
      status: "active",
      start_at: "2026-08-17T00:00:00.000Z",
      end_at: "2026-08-24T00:00:00.000Z",
      duration_days: 7,
    });
    const next = summary({
      tournament_id: "test-3",
      name: "Test Tournament 3",
      status: "scheduled",
      start_at: "2026-08-24T00:00:00.000Z",
      end_at: "2026-08-31T00:00:00.000Z",
      duration_days: 7,
    });
    const older = summary({
      tournament_id: "july-cup",
      name: "July cup",
      status: "ended",
      start_at: "2026-07-01T00:00:00.000Z",
      end_at: "2026-07-08T00:00:00.000Z",
      duration_days: 7,
      prize_amount: "30",
      archived_at: "2026-07-08T00:00:00.000Z",
      count: 3,
    });
    const newer = summary({
      tournament_id: "august-cup",
      name: "August cup",
      status: "ended",
      start_at: "2026-08-01T00:00:00.000Z",
      end_at: "2026-08-08T00:00:00.000Z",
      duration_days: 7,
      prize_amount: "45",
      archived_at: "2026-08-08T00:00:00.000Z",
      count: 1,
    });
    listTournaments.mockResolvedValue({
      tournaments: [next, live, older, newer],
      count: 4,
    });
    fetchTournament.mockImplementation(async (id: string) => {
      if (id === "august-cup") {
        return archive(newer, [
          entry({ farm_id: "f1", rank: 1, score: 19.17, name: "Freako", digs_to_third_op: 115 }),
          entry({ farm_id: "f2", rank: 2, score: 20.67, name: "Leauwuuu", digs_to_third_op: 124 }),
          entry({ farm_id: "f3", rank: 3, score: 19.6, name: "Purikku22", digs_to_third_op: 98 }),
        ]);
      }
      if (id === "july-cup") return archive(older, []);
      return archive(live, []);
    });

    const page = await renderHome();
    expect(page.querySelector("#join")).toBeNull();
    expect(page.querySelector('[data-testid="join-tournaments"]')).toBeNull();
    expect(page.textContent).not.toMatch(/Join a tournament/);
    expect(page.querySelector('[data-testid="join-farm-id"]')).toBeNull();
    expect(page.querySelector('[data-testid="join-form"]')).toBeNull();

    const past = page.querySelector("#past");
    const picker = page.querySelector('[data-testid="past-tournaments"]');
    expect(past?.textContent).toMatch(/Past tournaments/);
    expect(past?.textContent).toMatch(/Finished events, newest first/);
    expect(picker?.textContent).toMatch(/August cup/);
    expect(picker?.textContent).toMatch(/July cup/);
    expect(picker?.textContent).not.toMatch(/Creators Digging Tournament/);
    expect(picker?.textContent).not.toMatch(/Test Tournament 3/);
    expect(picker?.textContent).toMatch(/1 Aug → 8 Aug · 7d/);
    expect(picker?.textContent).toMatch(/45 Flower · 1 farm/);
    expect(picker?.textContent).toMatch(/1 Jul → 8 Jul · 7d/);
    expect(picker?.textContent).toMatch(/30 Flower · 3 farms/);
    expect(picker?.querySelectorAll("input")).toHaveLength(0);

    const links = [...page.querySelectorAll('[data-testid="past-tournaments"] a')].map((node) =>
      node.getAttribute("data-testid"),
    );
    expect(links).toEqual(["past-link-august-cup", "past-link-july-cup"]);
    const august = page.querySelector('[data-testid="past-link-august-cup"]');
    expect(august?.getAttribute("href")).toBe("/tournaments/august-cup");
    expect(august?.className).toBe(PAST_CARD_CLASS);
    expect(august?.className).toMatch(/rounded-2xl/);
    expect(august?.className).toMatch(/bg-dusk-panel|bg-\[#23201c\]/);
    expect(august?.className).toMatch(/border/);
    expect(august?.className).toMatch(/shadow-/);
    expect(august?.className).toMatch(/\bp-5\b/);
    expect(august?.className).not.toMatch(/join-option/);
    expect(august?.querySelector(".font-bold")?.textContent).toBe("August cup");
    const badge = august?.querySelector('[data-testid="past-badge-ended"]');
    expect(badge?.textContent).toBe("Ended");
    expect(badge?.className).toBe(PAST_BADGE_ENDED);
    expect(badge?.className).toMatch(/bg-zinc-700/);
    expect(badge?.className).toMatch(/text-white/);
  });

  it("keeps live boards ordered by soonest end when past events are present", async () => {
    const liveSoonEnd = summary({
      tournament_id: "live-soon-end",
      name: "Ends first",
      status: "active",
      start_at: "2026-08-10T00:00:00.000Z",
      end_at: "2026-08-18T00:00:00.000Z",
      duration_days: 8,
    });
    const liveOldStart = summary({
      tournament_id: "live-old-start",
      name: "Started first",
      status: "active",
      start_at: "2026-08-01T00:00:00.000Z",
      end_at: "2026-08-25T00:00:00.000Z",
      duration_days: 24,
    });
    const past = summary({
      tournament_id: "past-cup",
      name: "Old cup",
      status: "ended",
      start_at: "2026-07-01T00:00:00.000Z",
      end_at: "2026-07-08T00:00:00.000Z",
      duration_days: 7,
    });
    listTournaments.mockResolvedValue({
      tournaments: [past, liveSoonEnd, liveOldStart],
      count: 3,
    });
    fetchTournament.mockImplementation(async (id: string) => {
      const row = id === "live-soon-end" ? liveSoonEnd : liveOldStart;
      return archive(row, []);
    });

    const page = await renderHome();
    const boards = [...page.querySelectorAll('[data-testid^="live-board-"]')].map((node) =>
      node.getAttribute("data-testid"),
    );
    expect(boards).toEqual(["live-board-live-soon-end", "live-board-live-old-start"]);
    expect(page.querySelector('[data-testid="past-link-past-cup"]')?.getAttribute("href")).toBe(
      "/tournaments/past-cup",
    );
    expect(page.querySelector('[data-testid="latest-result-name"]')?.textContent).toBe("Old cup");
    expect(page.querySelector('[data-testid="latest-result-name"]')?.getAttribute("href")).toBe(
      "/tournaments/past-cup",
    );
  });

  it("caps the home ongoing and upcoming widgets at two each", async () => {
    const live = [1, 2, 3].map((index) =>
      summary({
        tournament_id: `live-${index}`,
        name: `Live ${index}`,
        status: "active",
        end_at: `2026-08-${18 + index}T00:00:00.000Z`,
      }),
    );
    const upcoming = [1, 2, 3].map((index) =>
      summary({
        tournament_id: `next-${index}`,
        name: `Soon ${index}`,
        status: "scheduled",
        start_at: `2026-09-0${index}T00:00:00.000Z`,
        end_at: `2026-09-1${index}T00:00:00.000Z`,
      }),
    );
    listTournaments.mockResolvedValue({ tournaments: [...live, ...upcoming], count: 6 });
    fetchTournament.mockImplementation(async (id: string) => {
      const row = live.find((item) => item.tournament_id === id) ?? live[0];
      return archive(row, []);
    });

    const page = await renderHome();
    const ongoingCards = page.querySelectorAll(
      '[data-testid="ongoing-group"] [data-testid^="tourney-card-"]',
    );
    const upcomingCards = page.querySelectorAll(
      '[data-testid="upcoming-group"] [data-testid^="tourney-card-"]',
    );
    expect(ongoingCards).toHaveLength(2);
    expect(upcomingCards).toHaveLength(2);
    expect(page.querySelector('[data-testid="tourney-card-live-3"]')).toBeNull();
    expect(page.querySelector('[data-testid="tourney-card-next-3"]')).toBeNull();
    expect(page.querySelectorAll('[data-testid^="live-board-"]')).toHaveLength(3);
  });

  it("gives past cards and badges computed padding that beats the universal reset", async () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\*\s*,\s*\*::before\s*,\s*\*::after\s*\{[^}]*padding:\s*0/s);
    expect(css).not.toMatch(/@layer[^{]*\{[^}]*\.past-card/s);
    expect(css).toMatch(/a\.past-card\s*\{[^}]*padding:\s*20px/s);
    expect(css).toMatch(/\.past-badge\s*\{[^}]*padding:\s*4px 10px/s);
    const sheet = document.createElement("style");
    sheet.setAttribute("data-testid", "past-style-sheet");
    sheet.textContent = css;
    document.head.appendChild(sheet);

    const ended = summary({
      tournament_id: "august-cup",
      name: "August cup",
      status: "ended",
      start_at: "2026-08-01T00:00:00.000Z",
      end_at: "2026-08-08T00:00:00.000Z",
      duration_days: 7,
      count: 2,
    });
    listTournaments.mockResolvedValue({ tournaments: [ended], count: 1 });
    fetchTournament.mockResolvedValue(archive(ended, []));

    try {
      const page = await renderHome();
      const card = page.querySelector('[data-testid="past-link-august-cup"]') as HTMLElement;
      const badge = page.querySelector('[data-testid="past-badge-ended"]') as HTMLElement;
      const sub = page.querySelector("#past .past-sub") as HTMLElement;
      const stack = page.querySelector('[data-testid="past-tournaments"]') as HTMLElement;
      expect(card).not.toBeNull();
      expect(badge).not.toBeNull();
      const cardStyle = getComputedStyle(card);
      expect(parseFloat(cardStyle.paddingTop)).toBeGreaterThanOrEqual(16);
      expect(parseFloat(cardStyle.paddingRight)).toBeGreaterThanOrEqual(16);
      expect(parseFloat(cardStyle.paddingBottom)).toBeGreaterThanOrEqual(16);
      expect(parseFloat(cardStyle.paddingLeft)).toBeGreaterThanOrEqual(16);
      const badgeStyle = getComputedStyle(badge);
      expect(parseFloat(badgeStyle.paddingTop)).toBeGreaterThan(0);
      expect(parseFloat(badgeStyle.paddingRight)).toBeGreaterThan(0);
      expect(parseFloat(badgeStyle.paddingBottom)).toBeGreaterThan(0);
      expect(parseFloat(badgeStyle.paddingLeft)).toBeGreaterThan(0);
      expect(parseFloat(getComputedStyle(sub).marginBottom)).toBeGreaterThanOrEqual(12);
      const stackStyle = getComputedStyle(stack);
      expect(parseFloat(stackStyle.gap || stackStyle.rowGap)).toBeGreaterThanOrEqual(12);
    } finally {
      sheet.remove();
    }
  });

  it("styles past cards with Tailwind utilities, not the old join-option row", () => {
    const list = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../components/PastTournamentList.tsx"),
      "utf8",
    );
    const tw = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../tailwind.css"),
      "utf8",
    );
    expect(list).toMatch(/rounded-2xl/);
    expect(list).toMatch(/bg-dusk-panel/);
    expect(list).toMatch(/border/);
    expect(list).toMatch(/shadow-/);
    expect(list).toMatch(/\bp-5\b/);
    expect(list).toMatch(/bg-zinc-700/);
    expect(list).toMatch(/text-white/);
    expect(list).not.toMatch(/join-option/);
    expect(list).not.toMatch(/Join a tournament/);
    expect(tw).not.toMatch(/tailwindcss\/preflight/);
    expect(tw).not.toMatch(/@import "tailwindcss";/);
    expect(tw).toMatch(/tailwindcss\/utilities/);
  });

  it("keeps home boards clickable without a download control", async () => {
    const live = summary({
      tournament_id: "empty",
      name: "Empty cup",
      status: "active",
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(archive(live, []));
    const page = await renderHome();
    expect(page.querySelector('[data-testid="open-board-empty"]')?.getAttribute("href")).toBe(
      "/tournaments/empty",
    );
    expect(page.querySelector('[data-testid="open-board-empty"]')?.textContent).toMatch(
      /Empty cup/,
    );
    expect(page.querySelector('[data-testid="open-board-empty"]')?.textContent).not.toMatch(
      /Open →/,
    );
    expect(page.querySelector('[data-testid^="download-board"]')).toBeNull();
    expect(page.textContent).not.toMatch(/Download image/);
    const homeSrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "./LeaderboardPage.tsx"),
      "utf8",
    );
    expect(homeSrc).not.toMatch(/DownloadBoardButton/);
    expect(homeSrc).not.toMatch(/Open →/);
  });

  it("replaces the thin your-farm row with rank, average, total, and today's digs", async () => {
    const live = summary({
      tournament_id: "creators",
      name: "Creators Digging Tournament",
      status: "active",
      start_at: "2026-08-17T00:00:00.000Z",
      end_at: "2026-08-24T00:00:00.000Z",
      duration_days: 7,
    });
    const later = summary({
      tournament_id: "later",
      name: "Ends later",
      status: "active",
      start_at: "2026-08-05T00:00:00.000Z",
      end_at: "2026-08-30T00:00:00.000Z",
      duration_days: 25,
    });
    const past = summary({
      tournament_id: "august-cup",
      name: "August cup",
      status: "ended",
      start_at: "2026-08-01T00:00:00.000Z",
      end_at: "2026-08-08T00:00:00.000Z",
      duration_days: 7,
    });
    listTournaments.mockResolvedValue({ tournaments: [later, live, past], count: 3 });
    fetchTournament.mockImplementation(async (id: string) => {
      if (id === "creators") {
        return archive(live, [
          entry({
            farm_id: "3666918801844311",
            name: "rmr",
            rank: 5,
            score: 20.4,
            digs_to_third_op: 102,
            digs_today: 14,
            score_today: 18,
            otter_count: 2,
            status: "in_progress",
          }),
        ]);
      }
      if (id === "later") {
        return archive(later, [
          entry({
            farm_id: "3666918801844311",
            name: "rmr",
            rank: 2,
            score: 16.5,
            digs_to_third_op: 33,
            digs_today: 6,
            score_today: 9,
            otter_count: 1,
            status: "in_progress",
          }),
        ]);
      }
      return archive(past, [
        entry({ farm_id: "f1", rank: 1, score: 19.17, name: "Freako", digs_to_third_op: 115 }),
      ]);
    });

    const page = await renderHome();
    const hero = page.querySelector('[data-testid="home-hero"]') as HTMLElement;
    const you = page.querySelector('[data-testid="you-farm"]') as HTMLElement;
    const latest = page.querySelector('[data-testid="latest-result"]') as HTMLElement;
    const liveBoard = page.querySelector('[data-testid="live-board-creators"]') as HTMLElement;
    expect(you).not.toBeNull();
    const cards = [...you.querySelectorAll("a.you-farm")];
    expect(cards.map((node) => node.getAttribute("data-testid"))).toEqual([
      "you-farm-creators",
      "you-farm-later",
    ]);
    expect(page.querySelector('[data-testid="you-farm-creators"]')?.getAttribute("href")).toBe(
      "/tournaments/creators/farm/3666918801844311",
    );
    expect(you.textContent).toMatch(/rmr/);
    expect(you.textContent).toMatch(/Creators Digging Tournament/);
    expect(you.textContent).toMatch(/Ends later/);
    expect(you.textContent).not.toMatch(/August cup/);
    expect(page.querySelector('[data-testid="you-farm-rank-creators"]')?.textContent).toMatch(/5/);
    expect(page.querySelector('[data-testid="you-farm-avg-creators"]')?.textContent).toMatch(
      /20\.40/,
    );
    expect(page.querySelector('[data-testid="you-farm-total-creators"]')?.textContent).toMatch(
      /102/,
    );
    expect(page.querySelector('[data-testid="you-farm-digs-today-creators"]')?.textContent).toMatch(
      /14/,
    );
    expect(
      page.querySelector('[data-testid="you-farm-score-today-creators"]')?.textContent,
    ).toMatch(/18/);
    expect(page.querySelector('[data-testid="you-farm-creators"]')?.textContent).toMatch(
      /In progress/,
    );
    expect(page.querySelector('[data-testid="you-farm-avg-later"]')?.textContent).toMatch(/16\.50/);
    expect(page.querySelector(".you-banner")).toBeNull();
    expect(hero.compareDocumentPosition(you) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(you.compareDocumentPosition(latest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      latest.compareDocumentPosition(liveBoard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.you-farm-stats\s*\{[^}]*grid-template-columns:\s*repeat\(5/s);
    expect(css).not.toMatch(/#e8b923/);
    expect(css).not.toMatch(/\.you-banner/);
    const sheet = document.createElement("style");
    sheet.textContent = css;
    document.head.appendChild(sheet);
    try {
      const stats = page.querySelector(".you-farm-stats") as HTMLElement;
      expect(getComputedStyle(stats).display).toBe("grid");
    } finally {
      sheet.remove();
    }
  });

  it("shows the newest ended tournament name and podium above live boards", async () => {
    const live = summary({
      tournament_id: "creators",
      name: "Creators Digging Tournament",
      status: "active",
      start_at: "2026-08-17T00:00:00.000Z",
      end_at: "2026-08-24T00:00:00.000Z",
      duration_days: 7,
    });
    const older = summary({
      tournament_id: "july-cup",
      name: "July cup",
      status: "ended",
      start_at: "2026-07-01T00:00:00.000Z",
      end_at: "2026-07-08T00:00:00.000Z",
      duration_days: 7,
    });
    const newer = summary({
      tournament_id: "august-cup",
      name: "August cup",
      status: "ended",
      start_at: "2026-08-01T00:00:00.000Z",
      end_at: "2026-08-08T00:00:00.000Z",
      duration_days: 7,
    });
    listTournaments.mockResolvedValue({ tournaments: [live, older, newer], count: 3 });
    fetchTournament.mockImplementation(async (id: string) => {
      if (id === "august-cup") {
        return archive(newer, [
          entry({ farm_id: "f1", rank: 1, score: 19.17, name: "Freako", digs_to_third_op: 115 }),
          entry({ farm_id: "f2", rank: 2, score: 20.67, name: "Leauwuuu", digs_to_third_op: 124 }),
          entry({ farm_id: "f3", rank: 3, score: 19.6, name: "Purikku22", digs_to_third_op: 98 }),
        ]);
      }
      if (id === "july-cup") {
        return archive(older, [
          entry({ farm_id: "old1", rank: 1, score: 10, name: "OldWinner", digs_to_third_op: 70 }),
        ]);
      }
      return archive(live, [entry({ farm_id: "live1", rank: 1, score: 8, name: "LiveLead" })]);
    });

    const page = await renderHome();
    const hero = page.querySelector('[data-testid="home-hero"]') as HTMLElement;
    const latest = page.querySelector('[data-testid="latest-result"]') as HTMLElement;
    const liveBoard = page.querySelector('[data-testid="live-board-creators"]') as HTMLElement;
    const name = page.querySelector('[data-testid="latest-result-name"]') as HTMLAnchorElement;
    expect(latest).not.toBeNull();
    expect(name?.textContent).toBe("August cup");
    expect(name?.getAttribute("href")).toBe("/tournaments/august-cup");
    expect(page.querySelector('[data-testid="latest-result-window"]')?.textContent).toMatch(
      /1 Aug → 8 Aug · 7d/,
    );
    expect(latest.textContent).toMatch(/Latest result/);
    expect(latest.textContent).not.toMatch(/July cup/);
    expect(latest.textContent).not.toMatch(/OldWinner/);
    expect(latest.textContent).not.toMatch(/Creators Digging Tournament/);
    const podium = latest.querySelector('[data-testid="tournament-podium"]');
    expect(podium).not.toBeNull();
    expect(podium?.querySelector(".place-1")?.textContent).toMatch(/Freako/);
    expect(podium?.querySelector(".place-1")?.textContent).toMatch(/115/);
    expect(podium?.querySelector(".place-2")?.textContent).toMatch(/Leauwuuu/);
    expect(podium?.querySelector(".place-3")?.textContent).toMatch(/Purikku22/);
    expect(hero.compareDocumentPosition(latest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      latest.compareDocumentPosition(liveBoard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const fetched = fetchTournament.mock.calls.map((call) => call[0]);
    expect(fetched).toContain("august-cup");
    expect(fetched).toContain("creators");
    expect(fetched).not.toContain("july-cup");

    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/a\.latest-result-name\s*\{[^}]*color:\s*var\(--cream\)/s);
    expect(css).toMatch(/a\.latest-result-name:hover[^}]*color:\s*var\(--gold\)/s);
    expect(css).not.toMatch(/#e8b923/);
    expect(css).toMatch(
      /\.latest-result \.podium\s*\{[^}]*grid-template-columns:\s*1fr 1\.15fr 1fr/s,
    );
    const sheet = document.createElement("style");
    sheet.textContent = css;
    document.head.appendChild(sheet);
    try {
      expect(getComputedStyle(latest.querySelector(".podium") as HTMLElement).display).toBe("grid");
    } finally {
      sheet.remove();
    }
  });

  it("stretches the home tourney panel to the prize card height", () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.hero\s*\{[^}]*align-items:\s*stretch/s);
    expect(css).toMatch(/\.hero\s*>\s*\.card\s*\{[^}]*height:\s*100%[^}]*margin-top:\s*0/s);
    expect(css).toMatch(/\.tourney-home\s*\{[^}]*min-height:\s*100%/s);
    expect(css).not.toMatch(/\.tourney-home\s*\{[^}]*align-content:\s*start/s);
    const siblingMargin = css.indexOf(".card + .card");
    const heroCardReset = css.indexOf(".hero > .card");
    expect(siblingMargin).toBeGreaterThan(-1);
    expect(heroCardReset).toBeGreaterThan(siblingMargin);
  });
});
