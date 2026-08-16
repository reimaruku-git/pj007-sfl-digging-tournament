import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
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

import { writeFollowedFarm } from "../lib/followFarm";
import { LeaderboardPage } from "./LeaderboardPage";

let root: Root;
let container: HTMLDivElement;

function summary(partial: Partial<TournamentSummary> & Pick<TournamentSummary, "tournament_id" | "name" | "status">): TournamentSummary {
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

function entry(partial: Partial<LeaderboardEntry> & Pick<LeaderboardEntry, "farm_id" | "rank" | "score">): LeaderboardEntry {
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
          <LeaderboardPage />
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
      if (id === "soon") return archive(soon, [entry({ farm_id: "a", rank: 1, score: 1.2, name: "Alpha" })]);
      return archive(later, [entry({ farm_id: "b", rank: 1, score: 2.4, name: "Bravo" })]);
    });

    const page = await renderHome();
    expect(page.querySelector('[data-testid="ongoing-group"]')?.textContent).toMatch(/Ends first/);
    expect(page.querySelector('[data-testid="ongoing-group"]')?.textContent).toMatch(/Ends later/);
    expect(page.querySelector('[data-testid="upcoming-group"]')?.textContent).toMatch(/September cup/);
    expect(page.querySelectorAll('[data-testid^="tourney-card-"]')).toHaveLength(3);

    const durationText = page.querySelector('[data-testid="tourney-duration-soon"]')?.textContent ?? "";
    expect(durationText).toMatch(/1 Aug → 18 Aug · 17d/);
    expect(durationText).not.toMatch(/\d{2}:\d{2}/);
    expect(durationText).not.toMatch(/UTC/);
    expect(page.querySelector('[data-testid="tourney-card-soon"]')?.textContent).toMatch(/Next refresh/);
    expect(page.querySelector('[data-testid="tourney-card-next"]')?.textContent).not.toMatch(/Next refresh/);

    const boards = [...page.querySelectorAll('[data-testid^="live-board-"]')];
    expect(boards).toHaveLength(2);
    expect(boards[0]?.getAttribute("data-testid")).toBe("live-board-soon");
    expect(boards[1]?.getAttribute("data-testid")).toBe("live-board-later");
    expect(page.textContent).not.toMatch(/Finished \/ tracked/);
  });

  it("caps each live board at 10 rows and only reverses that board when avg/day is toggled", async () => {
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
    const many = Array.from({ length: 12 }, (_, index) =>
      entry({
        farm_id: `p${index + 1}`,
        rank: index + 1,
        score: (index + 1) * 0.25,
        name: `Player ${index + 1}`,
      }),
    );
    listTournaments.mockResolvedValue({ tournaments: [first, second], count: 2 });
    fetchTournament.mockImplementation(async (id: string) => {
      if (id === "one") return archive(first, many);
      return archive(second, [
        entry({ farm_id: "keep", rank: 1, score: 0.8, name: "Keep me first" }),
        entry({ farm_id: "other", rank: 2, score: 1.1, name: "Keep me second" }),
      ]);
    });

    const page = await renderHome();
    const firstBoard = page.querySelector('[data-testid="live-board-one"]');
    const secondBoard = page.querySelector('[data-testid="live-board-two"]');
    expect(firstBoard?.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(firstBoard?.textContent).toMatch(/Score/);
    expect(firstBoard?.textContent).toMatch(/Avg \/ day/);
    expect(firstBoard?.textContent).toMatch(/Player 1/);
    expect(firstBoard?.textContent).toMatch(/Player 10/);
    expect(firstBoard?.textContent).not.toMatch(/Player 11/);
    expect(secondBoard?.textContent).toMatch(/Keep me first/);

    const sort = page.querySelector('[data-testid="sort-score-one"]') as HTMLButtonElement;
    expect(sort).not.toBeNull();
    act(() => {
      sort.click();
    });
    expect(firstBoard?.querySelector("tbody tr")?.textContent).toMatch(/Player 12/);
    expect(firstBoard?.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(secondBoard?.querySelector("tbody tr")?.textContent).toMatch(/Keep me first/);
    expect(secondBoard?.querySelector("tbody tr")?.textContent).not.toMatch(/Player 12/);
  });

  it("prefills the remembered farm id and offers a tournament picker", async () => {
    writeFollowedFarm("3666918801844311");
    const live = summary({
      tournament_id: "live",
      name: "Live cup",
      status: "active",
    });
    const next = summary({
      tournament_id: "next",
      name: "September cup",
      status: "scheduled",
      start_at: "2026-09-01T00:00:00.000Z",
      end_at: "2026-09-08T00:00:00.000Z",
    });
    listTournaments.mockResolvedValue({ tournaments: [live, next], count: 2 });
    fetchTournament.mockResolvedValue(archive(live, []));
    submitFarm.mockResolvedValue({ submissions: [], count: 0 });

    const page = await renderHome();
    const farmInput = page.querySelector('[data-testid="join-farm-id"]') as HTMLInputElement;
    expect(farmInput.value).toBe("3666918801844311");
    const picker = page.querySelector('[data-testid="join-tournaments"]');
    expect(picker?.textContent).toMatch(/Live cup/);
    expect(picker?.textContent).toMatch(/September cup/);

    const boxes = [...page.querySelectorAll('[data-testid="join-tournaments"] input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    act(() => {
      boxes[0]?.click();
      boxes[1]?.click();
    });
    act(() => {
      (page.querySelector('[data-testid="join-form"]') as HTMLFormElement).requestSubmit();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(submitFarm).toHaveBeenCalledWith("3666918801844311", "", ["live", "next"]);
  });
});
