import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TournamentSummary } from "../api/public";
import {
  AdminPendingJoins,
  pendingJoinsByTournament,
  tournamentNameForJoin,
} from "./AdminPendingJoins";

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
      {
        farm_id: "12",
        name: "other",
        tournament_id: "live",
        tournament_name: "Creators Digging Tournament",
        submitted_at: "2026-08-14T13:10:00+00:00",
        status: "pending",
      },
    ],
    onOpen: vi.fn(),
    ...handlers,
  };
  act(() => {
    root.render(<AdminPendingJoins {...props} />);
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

describe("pendingJoinsByTournament", () => {
  it("groups pending players into tournament name plus count", () => {
    const groups = pendingJoinsByTournament([
      {
        farm_id: "11",
        name: "a",
        tournament_id: "live",
        tournament_name: "Creators Digging Tournament",
        submitted_at: null,
        status: "pending",
      },
      {
        farm_id: "12",
        name: "b",
        tournament_id: "live",
        tournament_name: "Creators Digging Tournament",
        submitted_at: null,
        status: "pending",
      },
      {
        farm_id: "13",
        name: "c",
        tournament_id: "next",
        tournament_name: "September cup",
        submitted_at: null,
        status: "pending",
      },
    ]);
    expect(groups).toEqual([
      { tournament_id: "live", name: "Creators Digging Tournament", count: 2 },
      { tournament_id: "next", name: "September cup", count: 1 },
    ]);
  });
});

describe("AdminPendingJoins", () => {
  it("lists tournament name and pending count, not per-player approve or reject", () => {
    const onOpen = vi.fn();
    const { container } = render({ onOpen });
    const panel = container.querySelector('[data-testid="admin-pending-joins"]');
    expect(panel?.textContent).toMatch(/Creators Digging Tournament/);
    expect(panel?.querySelector('[data-testid="admin-pending-count-live"]')?.textContent).toMatch(
      /2 pending/,
    );
    expect(panel?.textContent).not.toMatch(/pending-a|Unnamed/);
    expect(container.querySelector('[data-testid="admin-dashboard-approve-11"]')).toBeNull();
    expect(container.querySelector('[data-testid="admin-dashboard-reject-11"]')).toBeNull();
    expect(panel?.textContent).not.toMatch(/\bApprove\b/);
    expect(panel?.textContent).not.toMatch(/\bReject\b/);
    act(() => {
      (container.querySelector('[data-testid="admin-pending-open-live"]') as HTMLButtonElement).click();
    });
    expect(onOpen).toHaveBeenCalledWith("live");
  });

  it("is the dashboard pending list AdminPage renders into the review overlay", () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "AdminPage.tsx"),
      "utf8",
    );
    expect(src).toMatch(/<AdminPendingJoins/);
    expect(src).toMatch(/setPendingReviewId\(id\)/);
    expect(src).not.toMatch(/admin-dashboard-approve/);
    expect(src).not.toMatch(/onClick=\{\(\) =>\s*\n?\s*rejectSubmission/);
  });
});
