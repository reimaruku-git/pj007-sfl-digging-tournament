import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FarmSessionProvider } from "../lib/farmSession";
import { writeFarmIdentity } from "../lib/followFarm";

const fetchFarmProfile = vi.fn();
const putFarmAvatar = vi.fn();

vi.mock("../api/public", () => ({
  fetchFarmProfile: (...args: unknown[]) => fetchFarmProfile(...args),
  putFarmAvatar: (...args: unknown[]) => putFarmAvatar(...args),
}));

import { ProfilePage } from "./ProfilePage";

let root: Root;
let container: HTMLDivElement;

async function renderProfile() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/profile"]}>
          <FarmSessionProvider>
            <Routes>
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/" element={<main data-testid="home">home</main>} />
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
});

describe("ProfilePage", () => {
  beforeEach(() => {
    writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
    fetchFarmProfile.mockResolvedValue({
      farm_id: "3666918801844311",
      name: "rmr",
      avatar_kind: "preset",
      avatar_preset: "hoot",
    });
  });

  it("sends a visitor without a connected farm home", async () => {
    localStorage.clear();
    const el = await renderProfile();
    expect(el.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="profile-page"]')).toBeNull();
  });

  it("shows the connected farm and NPC picker, and saves a preset", async () => {
    putFarmAvatar.mockResolvedValue({
      farm_id: "3666918801844311",
      name: "rmr",
      avatar_kind: "preset",
      avatar_preset: "genie",
    });
    const el = await renderProfile();
    expect(el.querySelector('[data-testid="profile-name"]')?.textContent).toBe("rmr");
    expect(el.querySelector('[data-testid="profile-farm-id"]')?.textContent).toBe("3666918801844311");
    expect(el.querySelector('[data-testid="farm-avatar"] img')?.getAttribute("src")).toBe(
      "/avatars/hoot.png",
    );
    expect(el.querySelector('[data-testid="avatar-preset-hoot"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    await act(async () => {
      (el.querySelector('[data-testid="avatar-preset-genie"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(putFarmAvatar).toHaveBeenCalledWith("3666918801844311", {
      kind: "preset",
      preset_id: "genie",
    });
  });
});
