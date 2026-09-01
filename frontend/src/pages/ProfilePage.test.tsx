import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FarmSessionProvider } from "../lib/farmSession";
import { writeFarmIdentity } from "../lib/followFarm";
import type { LeaderboardEntry } from "../api/public";

const fetchFarmProfile = vi.fn();
const putFarmAvatar = vi.fn();
const fetchFarm = vi.fn();

vi.mock("../api/public", () => ({
  fetchFarmProfile: (...args: unknown[]) => fetchFarmProfile(...args),
  putFarmAvatar: (...args: unknown[]) => putFarmAvatar(...args),
  fetchFarm: (...args: unknown[]) => fetchFarm(...args),
}));

import { ProfilePage } from "./ProfilePage";
import { ProfilePicturePage } from "./ProfilePicturePage";

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
    avatar_kind: "preset",
    avatar_preset: "betty",
    days: [],
    ...partial,
  };
}

async function renderAt(path: string, state?: { from?: string }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[{ pathname: path, state }]}>
          <FarmSessionProvider>
            <Routes>
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/profile/picture" element={<ProfilePicturePage />} />
              <Route path="/" element={<main data-testid="home">home</main>} />
              <Route path="/tournaments/:tournamentId" element={<main data-testid="event">event</main>} />
            </Routes>
          </FarmSessionProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  return container;
}

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  localStorage.clear();
  fetchFarmProfile.mockReset();
  putFarmAvatar.mockReset();
  fetchFarm.mockReset();
});

describe("ProfilePage", () => {
  beforeEach(() => {
    writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
    fetchFarmProfile.mockResolvedValue({
      farm_id: "3666918801844311",
      name: "rmr",
      avatar_kind: "preset",
      avatar_preset: "betty",
    });
    fetchFarm.mockResolvedValue(farm());
  });

  it("sends a visitor without a connected farm home", async () => {
    localStorage.clear();
    const el = await renderAt("/profile");
    expect(el.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="profile-page"]')).toBeNull();
  });

  it("shows the personal result and opens the picture page from the avatar", async () => {
    const el = await renderAt("/profile");
    expect(el.querySelector('[data-testid="profile-name"]')?.textContent).toBe("rmr");
    expect(el.querySelector('[data-testid="farm-total"]')?.textContent).toBe("14");
    expect(el.querySelector('[data-testid="avatar-presets"]')).toBeNull();
    const back = el.querySelector('[data-testid="back-link"]');
    expect(back?.textContent).toMatch(/^Back$/);
    expect(back?.classList.contains("detail-crumb")).toBe(true);
    expect(back?.querySelector("svg")).not.toBeNull();
    expect(el.querySelector('[data-testid="edit-avatar"]')?.getAttribute("href")).toBe(
      "/profile/picture",
    );
    await act(async () => {
      (el.querySelector('[data-testid="edit-avatar"]') as HTMLAnchorElement).click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(el.querySelector('[data-testid="profile-picture-page"]')).not.toBeNull();
  });

  it("returns to the tournament with Back when opened from an event", async () => {
    const el = await renderAt("/profile", { from: "/tournaments/sprint" });
    const back = el.querySelector('[data-testid="back-link"]');
    expect(back?.textContent).toBe("Back");
    expect(back?.getAttribute("href")).toBe("/tournaments/sprint");
  });
});

describe("ProfilePicturePage", () => {
  beforeEach(() => {
    writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
    fetchFarmProfile.mockResolvedValue({
      farm_id: "3666918801844311",
      name: "rmr",
      avatar_kind: "preset",
      avatar_preset: "betty",
    });
  });

  it("selects an NPC without saving until Save, and backs to profile", async () => {
    putFarmAvatar.mockResolvedValue({
      farm_id: "3666918801844311",
      name: "rmr",
      avatar_kind: "preset",
      avatar_preset: "jafar",
    });
    const el = await renderAt("/profile/picture");
    expect(el.querySelector('[data-testid="farm-avatar"] img')?.getAttribute("src")).toBe(
      "/avatars/betty.webp",
    );
    expect(el.querySelector('[data-testid="avatar-preset-betty"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    const save = el.querySelector('[data-testid="avatar-save"]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await act(async () => {
      (el.querySelector('[data-testid="avatar-preset-jafar"]') as HTMLButtonElement).click();
    });
    expect(putFarmAvatar).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="farm-avatar"] img')?.getAttribute("src")).toBe(
      "/avatars/betty.webp",
    );
    expect(el.querySelector('[data-testid="avatar-preset-jafar"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(save.disabled).toBe(false);
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    expect(putFarmAvatar).toHaveBeenCalledWith("3666918801844311", {
      kind: "preset",
      preset_id: "jafar",
    });
    const back = el.querySelector('[data-testid="back-link"]');
    expect(back?.textContent).toBe("Back to Profile");
    expect(back?.classList.contains("detail-crumb")).toBe(true);
    expect(back?.getAttribute("href")).toBe("/profile");
  });
});
