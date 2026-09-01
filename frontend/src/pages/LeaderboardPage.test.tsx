import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardEntry, TournamentArchive, TournamentSummary } from "../api/public";
import { readdirSync, readFileSync } from "node:fs";
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

    expect(podium.querySelector(".band-head")).toBeNull();
    expect(podium.querySelector("h2")).toBeNull();
    expect(podium.textContent).not.toMatch(/Podium/);
    expect(podium.textContent).not.toMatch(/Top three/);
    expect(podium.querySelector('[data-testid="tournament-podium"]')).not.toBeNull();
    expect(podium.querySelector(".place-1")?.textContent).toMatch(/rmr/);
    expect(podium.querySelector('[data-testid="podium-avg-1"]')?.textContent).toMatch(/27\.57/);
    expect(podium.querySelector('[data-testid="podium-avg-1"]')?.textContent).toMatch(/Avg\/day/);
    expect(podium.querySelector(".place-1")?.textContent).not.toMatch(/193/);
    expect(podium.querySelector(".place-2")?.textContent).toMatch(/Farm 218/);
    expect(podium.querySelector(".place-3")?.textContent).toMatch(/Farm 219/);

    expect(standings.querySelector(".band-head")).toBeNull();
    expect(standings.querySelector("h2")).toBeNull();
    expect(standings.textContent).not.toMatch(/\bField\b/);
    expect([...standings.querySelectorAll(".kicker")].map((node) => node.textContent)).not.toContain(
      "Field",
    );
    expect(standings.querySelector("table.board-table")).not.toBeNull();
    expect(standings.querySelector(".board-cards")).not.toBeNull();
    expect(standings.getAttribute("id")).toBe("standings");
    expect(standings.textContent).toMatch(/Total/);
    expect(standings.textContent).toMatch(/Today/);
    expect(standings.textContent).toMatch(/Pebbles/);
    expect(standings.textContent).toMatch(/Avg \/ day/);
    expect(page.querySelector('[data-testid="you-farm-name"]')?.textContent).toBe("rmr");
    expect(page.querySelector('[data-testid="you-farm-avg"]')?.textContent).toMatch(/27\.57/);

    expect(rules.querySelector("h2")?.textContent).toBe("RULES");
    expect(rules.textContent).not.toMatch(/Rules, briefly/);
    expect(rules.textContent).not.toMatch(/How a tournament is scored/);
    const lead = rules.querySelector('[data-testid="rules-lead"]') as HTMLElement;
    expect(lead).not.toBeNull();
    expect(lead.classList.contains("band-note")).toBe(false);
    expect(lead.classList.contains("rules-lead")).toBe(true);
    expect(rules.querySelector("h2")?.nextElementSibling).toBe(lead);
    expect(lead.textContent).toMatch(
      /Get the 3 Otter Pebbles in as few digs as possible\. Digs after the 3rd pebble do not affect your score\./,
    );
    expect(rules.textContent).toMatch(/Counts as 1 dig/);
    expect(rules.textContent).toMatch(/Counts as 4 digs/);
    expect(rules.textContent).toMatch(/last dig of those 4/);
    expect(rules.textContent).toMatch(/only on days that already have a recorded score/);
    expect(rules.textContent).toMatch(/14:00, 16:00, 18:00, 20:00, 23:00 UTC/);
    expect(rules.querySelector("strong")?.textContent).toBe("Digs after 23:00 UTC do not count");
    expect(rules.textContent).toMatch(/worst finisher that day or 30/);
    expect(rules.textContent).toMatch(/5 for every missing pebble/);
    expect(rules.textContent).toMatch(/Average of 3rd pebble, then 2nd, then 1st/);
    expect(rules.textContent).not.toMatch(/How a window is won/);
    expect(rules.textContent).not.toMatch(/Enter a window/);
    expect(rules.textContent).not.toMatch(/Hunt three pebbles/);
    expect(rules.textContent).not.toMatch(/Spend fewer strokes/);
    expect(page.textContent).not.toMatch(/\bWindows\b/);
    expect(page.textContent).not.toMatch(
      /Lowest average of days that already have a 3rd-pebble score/,
    );
    expect(page.textContent).not.toMatch(/Fewest digs to three Otter Pebbles/);
    expect(page.querySelector("#past")).toBeNull();
    expect(page.querySelector('[data-testid="tourney-home"]')).toBeNull();
    const featuredTitle = page.querySelector('[data-testid="featured-title"]');
    expect(featuredTitle?.textContent).toBe("Creators Digging Tournament");
    expect(featuredTitle?.closest("a")).toBeNull();
    expect(page.querySelector('[data-testid="featured-link"]')).toBeNull();
    expect(page.querySelector('[data-testid="featured-now-link"]')?.getAttribute("href")).toBe(
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
    expect(page.querySelector('[data-testid="home-hero"] img')).toBeNull();
    expect(page.querySelector('[data-testid="home-hero-scrim"]')).toBeNull();
    expect(page.querySelector('[data-testid="now-digging-scrim"]')).toBeNull();
    expect(page.querySelector(".place-1 [data-testid='color-canvas']")).not.toBeNull();
    expect(page.querySelector(".you-farm-art [data-testid='color-canvas']")).not.toBeNull();

    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const publicRoot = resolve(srcRoot, "../public");
    const names = [
      ...readdirSync(srcRoot, { recursive: true }).map(String),
      ...readdirSync(publicRoot, { recursive: true }).map(String),
    ];
    const rasters = names.filter((name) => /\.(png|jpe?g)$/i.test(name)).sort();
    expect(rasters).toEqual(["desert-dig-site.png", "shovel.png"]);

    const css = readFileSync(resolve(srcRoot, "index.css"), "utf8");
    const appFrame = css.match(/\.app-frame\s*\{[^}]+\}/);
    expect(appFrame).not.toBeNull();
    expect(appFrame![0]).toMatch(/url\(["']?\/desert-dig-site\.png["']?\)/);
    expect(appFrame![0]).toMatch(/background-size:\s*cover/);
    expect(appFrame![0]).not.toMatch(/(?:^|{|;)\s*filter\s*:/);
    expect(appFrame![0]).toMatch(/linear-gradient\(/);
    const gradientAt = appFrame![0].search(/linear-gradient\(/);
    const imageAt = appFrame![0].search(/desert-dig-site\.png/);
    expect(imageAt).toBeGreaterThan(gradientAt);
    const mixes = [
      ...appFrame![0].matchAll(/color-mix\(\s*in\s+srgb\s*,\s*var\(--bg\)\s+(\d+(?:\.\d+)?)%/g),
    ];
    expect(mixes.length).toBeGreaterThanOrEqual(1);
    for (const mix of mixes) {
      const pct = Number(mix[1]);
      expect(pct).toBe(85);
    }
    expect(css).not.toMatch(/\.live-hero[^{]*\{[^}]*desert-dig-site/);
    expect(css).not.toMatch(/\.live-hero-art[^{]*\{[^}]*desert-dig-site/);
    const heroBlocks = [...css.matchAll(/\.live-hero\s*\{[^}]+\}/g)].map((match) => match[0]);
    expect(heroBlocks.length).toBeGreaterThan(0);
    const fullBleed = heroBlocks.find((block) => /width:\s*100vw/.test(block));
    expect(fullBleed).toBeDefined();
    expect(fullBleed).toMatch(/margin-left:\s*calc\(50% - 50vw\)/);
    expect(fullBleed).toMatch(/margin-right:\s*calc\(50% - 50vw\)/);
    for (const block of heroBlocks) {
      expect(block).not.toMatch(/width:\s*auto/);
      expect(block).not.toMatch(/margin-left:\s*0/);
      expect(block).not.toMatch(/margin-right:\s*0/);
    }

    const leadRule = css.match(/\.rules-lead\s*\{[^}]+\}/);
    expect(leadRule).not.toBeNull();
    const leadSize = leadRule![0].match(/font-size:\s*(\d+(?:\.\d+)?)px/);
    expect(leadSize).not.toBeNull();
    expect(Number(leadSize![1])).toBeGreaterThan(13);
    const noteRule = css.match(/\.band-note\s*\{[^}]+\}/);
    expect(noteRule).not.toBeNull();
    const noteSize = noteRule![0].match(/font-size:\s*(\d+(?:\.\d+)?)px/);
    expect(noteSize).not.toBeNull();
    expect(Number(leadSize![1])).toBeGreaterThan(Number(noteSize![1]));
    expect(leadRule![0]).not.toMatch(/text-align:\s*right/);
  });

  it("keeps the original hero frame when Image 2 is set", async () => {
    const live = summary({
      tournament_id: "sprint",
      name: "Creators Digging Tournament",
      status: "active",
      count: 1,
      image_1_url: "https://example.test/thumb.jpg",
      image_2_url: "https://example.test/hero.jpg",
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(archive(live, []));

    const page = await renderHome();
    const art = page.querySelector(".live-hero-art");
    const heroImage = page.querySelector('[data-testid="home-hero-image"]');
    expect(art).not.toBeNull();
    expect(heroImage).not.toBeNull();
    expect(art?.contains(heroImage)).toBe(true);
    expect(heroImage?.classList.contains("live-hero-art")).toBe(false);
    expect(page.querySelector('[data-testid="home-hero-scrim"]')).toBeNull();
    expect(page.querySelector('[data-testid="now-digging-image"]')).not.toBeNull();
    expect(page.querySelector(".now-digging-art")?.contains(page.querySelector('[data-testid="now-digging-image"]'))).toBe(
      true,
    );
    expect(page.querySelector('[data-testid="now-digging-scrim"]')).toBeNull();

    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"), "utf8");
    const artBlock = [...css.matchAll(/\.live-hero-art\s*\{[^}]+\}/g)].map((match) => match[0])[0];
    expect(artBlock).toMatch(/min-height:\s*560px/);
    expect(artBlock).toMatch(/border:/);
    expect(artBlock).toMatch(/var\(--gold\)/);
    const thumbBlock = [...css.matchAll(/\.now-digging-art\s*\{[^}]+\}/g)].map((match) => match[0])[0];
    expect(thumbBlock).toMatch(/border:/);
    expect(thumbBlock).toMatch(/var\(--gold\)/);
    expect(css).not.toMatch(/\.tournament-image-scrim/);
  });

  it("applies featured hero text color and outline on the home copy", async () => {
    const live = summary({
      tournament_id: "sprint",
      name: "Creators Digging Tournament",
      status: "active",
      count: 1,
      image_2_url: "https://example.test/hero.jpg",
      hero_text: { color: "#1a1815", outline: "#e4dfd5" },
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(archive(live, []));

    const page = await renderHome();
    const copy = page.querySelector('[data-testid="hero-copy"]') as HTMLElement;
    expect(copy).not.toBeNull();
    expect(copy.style.color.replace(/\s/g, "").toLowerCase()).toMatch(/#1a1815|rgb\(26,24,21\)/);
    expect(copy.style.textShadow.toLowerCase()).toMatch(/#e4dfd5/);
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

  it("lists at most 10 farms on the home board and links Check Standings to the event", async () => {
    const live = summary({
      tournament_id: "sprint",
      name: "Creators Digging Tournament",
      status: "active",
      count: 12,
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(
      archive(
        live,
        Array.from({ length: 12 }, (_, index) =>
          entry({
            farm_id: String(index + 1),
            rank: index + 1,
            score: 10 + index,
            name: `Farm ${index + 1}`,
          }),
        ),
      ),
    );
    const page = await renderHome();
    const tableRows = page.querySelectorAll('[data-testid="standings"] tbody tr');
    const cards = page.querySelectorAll('[data-testid="standings"] .board-cards .farm-card');
    expect(tableRows).toHaveLength(10);
    expect(cards).toHaveLength(10);
    const names = [...tableRows].map((row) => row.querySelector("td a")?.childNodes[0]?.textContent);
    expect(names).toContain("Farm 10");
    expect(names).not.toContain("Farm 11");
    expect(names).not.toContain("Farm 12");
    const check = page.querySelector('[data-testid="check-standings"]');
    expect(check?.textContent).toMatch(/Check Standings >/);
    expect(check?.getAttribute("href")).toBe("/tournaments/sprint");
  });

  it("appends the connected farm as the last standings row when they rank outside the top 10", async () => {
    writeFarmIdentity({ farm_id: "12", name: "YouFarm" });
    const live = summary({
      tournament_id: "sprint",
      name: "Creators Digging Tournament",
      status: "active",
      count: 12,
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(
      archive(
        live,
        Array.from({ length: 12 }, (_, index) =>
          entry({
            farm_id: String(index + 1),
            rank: index + 1,
            score: 10 + index,
            name: `Farm ${index + 1}`,
          }),
        ),
      ),
    );
    const page = await renderHome();
    const tableRows = [...page.querySelectorAll('[data-testid="standings"] tbody tr')];
    const cards = [...page.querySelectorAll('[data-testid="standings"] .board-cards .farm-card')];
    expect(tableRows).toHaveLength(11);
    expect(cards).toHaveLength(11);
    expect(tableRows[10]?.textContent).toMatch(/Farm 12/);
    expect(tableRows[10]?.querySelector(".rank")?.textContent).toBe("12");
    expect(tableRows[10]?.classList.contains("is-you")).toBe(true);
    expect(cards[10]?.textContent).toMatch(/Farm 12/);
    expect(cards[10]?.querySelector(".rank")?.textContent).toBe("12");
  });

  it("does not duplicate the connected farm when they already sit in the top 10", async () => {
    writeFarmIdentity({ farm_id: "1", name: "Farm 1" });
    const live = summary({
      tournament_id: "sprint",
      name: "Creators Digging Tournament",
      status: "active",
      count: 12,
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(
      archive(
        live,
        Array.from({ length: 12 }, (_, index) =>
          entry({
            farm_id: String(index + 1),
            rank: index + 1,
            score: 10 + index,
            name: `Farm ${index + 1}`,
          }),
        ),
      ),
    );
    const page = await renderHome();
    const tableRows = [...page.querySelectorAll('[data-testid="standings"] tbody tr')];
    expect(tableRows).toHaveLength(10);
    expect(tableRows.filter((row) => row.classList.contains("is-you"))).toHaveLength(1);
    expect(tableRows[0]?.classList.contains("is-you")).toBe(true);
    expect(tableRows[0]?.querySelector(".farm-id")?.textContent).toBe("1");
    expect(page.querySelectorAll('[data-testid="standings"] .board-cards .farm-card')).toHaveLength(
      10,
    );
  });

  it("does not add a standings row for a connected farm that is not on the board", async () => {
    writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
    const live = summary({
      tournament_id: "sprint",
      name: "Creators Digging Tournament",
      status: "active",
      count: 12,
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(
      archive(
        live,
        Array.from({ length: 12 }, (_, index) =>
          entry({
            farm_id: String(index + 1),
            rank: index + 1,
            score: 10 + index,
            name: `Farm ${index + 1}`,
          }),
        ),
      ),
    );
    const page = await renderHome();
    expect(page.querySelectorAll('[data-testid="standings"] tbody tr')).toHaveLength(10);
    expect(page.querySelectorAll('[data-testid="standings"] .board-cards .farm-card')).toHaveLength(
      10,
    );
  });

  it("lists every farm when the live board has 10 or fewer", async () => {
    const live = summary({
      tournament_id: "sprint",
      name: "Small cup",
      status: "active",
      count: 3,
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(
      archive(live, [
        entry({ farm_id: "1", rank: 1, score: 10, name: "A" }),
        entry({ farm_id: "2", rank: 2, score: 12, name: "B" }),
        entry({ farm_id: "3", rank: 3, score: 14, name: "C" }),
      ]),
    );
    const page = await renderHome();
    expect(page.querySelectorAll('[data-testid="standings"] tbody tr')).toHaveLength(3);
    expect(page.querySelector('[data-testid="check-standings"]')?.getAttribute("href")).toBe(
      "/tournaments/sprint",
    );
  });

  it("navigates Check Standings to the tournament standings page", async () => {
    const live = summary({
      tournament_id: "sprint",
      name: "Creators Digging Tournament",
      status: "active",
      count: 1,
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(
      archive(live, [entry({ farm_id: "1", rank: 1, score: 10, name: "A" })]),
    );
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
              <Routes>
                <Route path="/" element={<LeaderboardPage />} />
                <Route
                  path="/tournaments/:tournamentId"
                  element={<main data-testid="event-standings">event board</main>}
                />
              </Routes>
            </FarmSessionProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    act(() => {
      (container.querySelector('[data-testid="check-standings"]') as HTMLAnchorElement).click();
    });
    expect(container.querySelector('[data-testid="event-standings"]')?.textContent).toBe(
      "event board",
    );
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
    expect(page.querySelector('[data-testid="featured-title"]')?.closest("a")).toBeNull();
    expect(page.querySelector('[data-testid="featured-now-link"]')?.getAttribute("href")).toBe(
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

  it("shows an admin-featured upcoming event on home until it goes live", async () => {
    const live = summary({
      tournament_id: "soon",
      name: "Ends first",
      status: "active",
      end_at: "2026-08-25T00:00:00.000Z",
    });
    const next = summary({
      tournament_id: "next",
      name: "September cup",
      status: "scheduled",
      start_at: "2026-09-01T00:00:00.000Z",
      end_at: "2026-09-08T00:00:00.000Z",
      duration_days: 7,
      count: 2,
    });
    listTournaments.mockResolvedValue({
      tournaments: [live, next],
      count: 2,
      featured_tournament_id: "next",
    });
    fetchTournament.mockImplementation(async (id: string) => {
      if (id === "next") return archive(next, []);
      return archive(live, []);
    });

    const page = await renderHome();
    expect(page.querySelector('[data-testid="featured-title"]')?.textContent).toBe("September cup");
    expect(page.querySelector('[data-testid="home-hero"]')?.textContent).toMatch(
      /Upcoming tournament/,
    );
    expect(page.querySelector('[data-testid="now-digging"]')?.textContent).toMatch(/Up next/);
    expect(page.querySelector('[data-testid="featured-now-link"]')?.getAttribute("href")).toBe(
      "/tournaments/next",
    );
    expect(fetchTournament.mock.calls.map((call) => call[0])).toEqual(["next"]);
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

  it("shows a text prize pool as Top Prize without $Flower", async () => {
    const live = summary({
      tournament_id: "text",
      name: "NFT pack cup",
      status: "active",
      prize_amount: "3x Rare Key",
    });
    listTournaments.mockResolvedValue({ tournaments: [live], count: 1 });
    fetchTournament.mockResolvedValue(archive(live, []));
    const page = await renderHome();
    expect(page.querySelector('[data-testid="hero-prize"]')?.textContent).toBe("3x Rare Key");
    expect(page.querySelector('[data-testid="hero-prize"]')?.textContent).not.toMatch(/\$Flower/);
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
    expect(page.querySelector('[data-testid="featured-title"]')?.closest("a")).toBeNull();
    expect(page.querySelector('[data-testid="featured-now-link"]')?.getAttribute("href")).toBe(
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
