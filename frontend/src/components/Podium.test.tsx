import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { LeaderboardEntry } from "../api/public";
import { Podium } from "./Podium";

let root: Root;
let container: HTMLDivElement;

function entry(
  partial: Partial<LeaderboardEntry> & Pick<LeaderboardEntry, "farm_id" | "rank" | "score">,
): LeaderboardEntry {
  return {
    name: partial.name ?? `farm-${partial.farm_id}`,
    digs_to_third_op: 70,
    otter_count: 3,
    digs_today: 0,
    score_today: 10,
    total_digs: 70,
    last_updated_at: null,
    status: "completed",
    invalidated: false,
    ...partial,
  };
}

function renderPodium(entries: LeaderboardEntry[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <Podium entries={entries} tournamentId="sprint" />
      </MemoryRouter>,
    );
  });
  return container;
}

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("Podium", () => {
  it("shows the official per-day average, not the total, as the primary figure", () => {
    const el = renderPodium([
      entry({ farm_id: "1", rank: 1, score: 12.5, name: "Lead", digs_to_third_op: 88 }),
      entry({ farm_id: "2", rank: 2, score: 14, name: "Two", digs_to_third_op: 90 }),
      entry({ farm_id: "3", rank: 3, score: 16, name: "Three", digs_to_third_op: 99 }),
    ]);
    const first = el.querySelector('[data-testid="podium-avg-1"]');
    expect(first?.textContent).toMatch(/12\.50/);
    expect(first?.textContent).toMatch(/AVG SCORE/);
    expect(el.querySelector(".place-1")?.textContent).not.toMatch(/88/);
    expect(el.querySelector('[data-testid="podium-tie-1"]')).toBeNull();
    expect(el.querySelector('[data-testid="podium-tie-2"]')).toBeNull();
    expect(el.querySelector('[data-testid="podium-tie-3"]')).toBeNull();
  });

  it("shows 1st and 2nd pebble averages only on tied top-3 primary scores", () => {
    const el = renderPodium([
      entry({
        farm_id: "1",
        rank: 1,
        score: 10,
        score_first_op: 4.25,
        score_second_op: 6.5,
        name: "Lead",
        digs_to_third_op: 40,
      }),
      entry({
        farm_id: "2",
        rank: 2,
        score: 10,
        score_first_op: 5.0,
        score_second_op: 7.25,
        name: "Tied",
        digs_to_third_op: 40,
      }),
      entry({
        farm_id: "3",
        rank: 3,
        score: 18,
        score_first_op: 6,
        score_second_op: 9,
        name: "Clear",
        digs_to_third_op: 54,
      }),
    ]);
    expect(el.querySelector('[data-testid="podium-tie-1"]')?.textContent).toMatch(/2nd: 6\.50/);
    expect(el.querySelector('[data-testid="podium-tie-1"]')?.textContent).toMatch(/1st: 4\.25/);
    expect(el.querySelector('[data-testid="podium-tie-2"]')?.textContent).toMatch(/2nd: 7\.25/);
    expect(el.querySelector('[data-testid="podium-tie-2"]')?.textContent).toMatch(/1st: 5\.00/);
    expect(el.querySelector('[data-testid="podium-tie-3"]')).toBeNull();
  });

  it("shows a chosen NPC still on the podium art", () => {
    const el = renderPodium([
      entry({
        farm_id: "1",
        rank: 1,
        score: 12.5,
        name: "Lead",
        avatar_kind: "preset",
        avatar_preset: "betty",
      }),
    ]);
    const first = el.querySelector(".place-1 [data-testid='farm-avatar'] img");
    expect(first?.getAttribute("src")).toBe("/avatars/betty.webp");
    expect(el.querySelector(".place-1 [data-testid='color-canvas']")).toBeNull();
  });
});
