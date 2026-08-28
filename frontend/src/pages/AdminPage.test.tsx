import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Layout } from "../components/Layout";
import { FarmSessionProvider } from "../lib/farmSession";

vi.mock("../auth/amplify", () => ({}));
vi.mock("aws-amplify/auth", () => ({
  signIn: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  confirmSignIn: vi.fn(),
}));
vi.mock("../auth/session", () => ({
  getAuthToken: vi.fn().mockResolvedValue(null),
}));
vi.mock("../api/admin", () => ({
  adminSession: vi.fn().mockResolvedValue(true),
  listFarms: vi.fn().mockResolvedValue([]),
  listIdentities: vi.fn().mockResolvedValue([]),
  listSubmissions: vi.fn().mockResolvedValue([]),
  listAdminTournaments: vi.fn().mockResolvedValue({ tournaments: [], count: 0 }),
  addFarm: vi.fn(),
  addTournamentFarms: vi.fn(),
  approveSubmission: vi.fn(),
  createTournament: vi.fn(),
  deleteTournament: vi.fn(),
  fetchAdminFarm: vi.fn(),
  fetchSnapshot: vi.fn(),
  fetchTournamentRoster: vi.fn(),
  setFeaturedTournament: vi.fn(),
  refreshFarm: vi.fn(),
  rejectSubmission: vi.fn(),
  removeFarm: vi.fn(),
  removeTournamentFarm: vi.fn(),
  triggerSync: vi.fn(),
  updateFarm: vi.fn(),
  updateTournament: vi.fn(),
  fetchAdminSlogans: vi.fn().mockResolvedValue({ slogans: [], count: 0 }),
  saveSlogans: vi.fn(),
  addSlogan: vi.fn(),
}));
vi.mock("../api/public", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/public")>();
  return {
    ...actual,
    fetchSlogans: vi.fn().mockResolvedValue({ slogans: [], count: 0 }),
  };
});

import { getAuthToken } from "../auth/session";
import { AdminPage } from "./AdminPage";

let root: Root;
let container: HTMLDivElement;

function renderAdmin() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/admin"]}>
        <QueryClientProvider client={client}>
          <FarmSessionProvider>
            <Layout>
              <AdminPage />
            </Layout>
          </FarmSessionProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  return container;
}

beforeEach(() => {
  vi.mocked(getAuthToken).mockResolvedValue(null);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("AdminPage", () => {
  it("reaches the login form after the session check without a hooks crash", async () => {
    const el = renderAdmin();
    await act(async () => {
      await Promise.resolve();
    });
    expect(el.textContent).toMatch(/Master admin/);
    expect(el.querySelector('button[type="submit"]')?.textContent).toMatch(/Sign in/);
  });

  it("sits Force full sync below the header on the authed dashboard", async () => {
    vi.mocked(getAuthToken).mockResolvedValue("id-token");
    const el = renderAdmin();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    const sync = el.querySelector('[data-testid="admin-force-sync"]');
    expect(sync).not.toBeNull();
    expect(sync?.textContent).toMatch(/Force full sync/);
    expect(sync?.closest(".admin-sync-toolbar")).not.toBeNull();
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.admin-sync-toolbar\s*\{[^}]*margin-top:\s*28px/s);
    const topbar = el.querySelector('[data-testid="admin-topbar"]');
    expect(topbar?.contains(sync)).toBe(false);
    expect(el.querySelector('[data-testid="admin-sign-out"]')).toBeNull();
    act(() => {
      (el.querySelector('button[aria-label="Menu"]') as HTMLButtonElement).click();
    });
    expect(el.querySelector('[data-testid="admin-sign-out"]')?.textContent).toMatch(/Sign out/);
  });
});
