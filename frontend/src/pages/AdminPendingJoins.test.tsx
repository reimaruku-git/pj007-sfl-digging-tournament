import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TournamentSummary } from "../api/public";
import { AdminPendingJoins, tournamentNameForJoin } from "./AdminPendingJoins";

let root: Root;
let container: HTMLDivElement;

function render(handlers: Partial<Parameters<typeof AdminPendingJoins>[0]> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props = {
    submissions: [
      {
        farm_id: "11",
        name: "pending",
        tournament_id: "live",
        tournament_name: "Creators Digging Tournament",
        submitted_at: "2026-08-14T13:00:00+00:00",
        status: "pending",
      },
    ],
    onApprove: vi.fn().mockResolvedValue(undefined),
    onReject: vi.fn().mockResolvedValue(undefined),
    onOpen: vi.fn(),
    ...handlers,
  };
  act(() => {
    root.render(
      <MemoryRouter>
        <AdminPendingJoins {...props} />
      </MemoryRouter>,
    );
  });
  return { container, props };
}

afterEach(() => {
  if (root) {
    act(() => {
      root.unmount();
    });
  }
  container?.remove();
});

describe("tournamentNameForJoin", () => {
  it("prefers the API name and never falls back to the tournament id", () => {
    expect(
      tournamentNameForJoin({
        farm_id: "11",
        name: "pending",
        tournament_id: "20260814T120000Z_7d",
        tournament_name: "Week of 14 Aug",
        submitted_at: null,
        status: "pending",
      }),
    ).toBe("Week of 14 Aug");
    expect(
      tournamentNameForJoin(
        {
          farm_id: "11",
          name: "pending",
          tournament_id: "20260814T120000Z_7d",
          submitted_at: null,
          status: "pending",
        },
        [{ tournament_id: "20260814T120000Z_7d", name: "Catalog cup" } as TournamentSummary],
      ),
    ).toBe("Catalog cup");
    expect(
      tournamentNameForJoin({
        farm_id: "11",
        name: "pending",
        tournament_id: "20260814T120000Z_7d",
        submitted_at: null,
        status: "pending",
      }),
    ).toBe("Untitled tournament");
    expect(
      tournamentNameForJoin({
        farm_id: "11",
        name: "pending",
        tournament_id: "20260814T120000Z_7d",
        submitted_at: null,
        status: "pending",
      }),
    ).not.toBe("20260814T120000Z_7d");
  });
});

describe("AdminPendingJoins", () => {
  it("asks before dashboard reject and skips when no is chosen", () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    const { container } = render({ onReject });
    act(() => {
      (
        container.querySelector('[data-testid="admin-dashboard-reject-11"]') as HTMLButtonElement
      ).click();
    });
    const dialog = container.querySelector('[data-testid="confirm-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toMatch(/Are you sure to do this/);
    act(() => {
      (container.querySelector('[data-testid="confirm-no"]') as HTMLButtonElement).click();
    });
    expect(onReject).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
  });

  it("rejects a dashboard join only after yes; approve stays immediate", async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const { container } = render({ onReject, onApprove });
    act(() => {
      (
        container.querySelector('[data-testid="admin-dashboard-reject-11"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="confirm-yes"]') as HTMLButtonElement).click();
    });
    expect(onReject).toHaveBeenCalledWith("11", "live");
    act(() => {
      (
        container.querySelector('[data-testid="admin-dashboard-approve-11"]') as HTMLButtonElement
      ).click();
    });
    expect(onApprove).toHaveBeenCalledWith("11", "live");
    expect(container.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
  });

  it("shows the tournament name and lets admin open or view it", () => {
    const onOpen = vi.fn();
    const { container } = render({ onOpen });
    const panel = container.querySelector('[data-testid="admin-pending-joins"]');
    expect(panel?.textContent).toMatch(/Creators Digging Tournament/);
    expect(panel?.textContent).not.toMatch(/\blive\b/);
    const open = container.querySelector(
      '[data-testid="admin-pending-open-live"]',
    ) as HTMLButtonElement;
    expect(open?.textContent).toBe("Creators Digging Tournament");
    act(() => {
      open.click();
    });
    expect(onOpen).toHaveBeenCalledWith("live");
    const view = container.querySelector('[data-testid="admin-pending-view-live"]');
    expect(view?.getAttribute("href")).toBe("/tournaments/live");
  });

  it("is the dashboard pending list AdminPage renders", () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "AdminPage.tsx"),
      "utf8",
    );
    expect(src).toMatch(/<AdminPendingJoins/);
    expect(src).toMatch(/onOpen=\{\(id\) => setSelectedTournamentId\(id\)\}/);
    expect(src).toMatch(/tournaments=\{tournaments\.data\?\.tournaments/);
    expect(src).not.toMatch(/onClick=\{\(\) =>\s*\n?\s*rejectSubmission/);
  });
});
