import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TournamentSummary } from "../api/public";
import { AdminTournaments } from "./AdminTournaments";

let root: Root;
let container: HTMLDivElement;

function row(
  partial: Partial<TournamentSummary> &
    Pick<TournamentSummary, "tournament_id" | "name" | "status">,
): TournamentSummary {
  return {
    start_at: "2026-08-10T00:00:00.000Z",
    end_at: "2026-08-17T00:00:00.000Z",
    duration_days: 7,
    prize_amount: "30",
    archived_at: null,
    count: 0,
    leader_farm_id: null,
    ...partial,
  };
}

function render(items: TournamentSummary[], handlers = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props = {
    items,
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    ...handlers,
  };
  act(() => {
    root.render(<AdminTournaments {...props} />);
  });
  return { container, props };
}

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("AdminTournaments", () => {
  it("opens a create window with start and end dates on one row", () => {
    const { container } = render([]);
    expect(container.textContent).toMatch(/Ongoing/);
    expect(container.textContent).toMatch(/Upcoming/);
    expect(container.querySelector('[data-testid="create-tournament-window"]')).toBeNull();
    expect(container.querySelector('input[placeholder="Late August Otter Cup"]')).toBeNull();

    act(() => {
      const button = [...container.querySelectorAll("button")].find((node) =>
        node.textContent?.includes("Create new tournament"),
      );
      button?.click();
    });
    const window = container.querySelector('[data-testid="create-tournament-window"]');
    expect(window).not.toBeNull();
    expect(window?.querySelector("form")).not.toBeNull();
    expect(container.textContent).toMatch(/Title/);
    expect(container.textContent).toMatch(/Description/);
    expect(container.textContent).toMatch(/Start date/);
    expect(container.textContent).toMatch(/End date/);
    expect(container.textContent).not.toMatch(/Min bumpkin level/);
    expect(container.textContent).toMatch(/Min bumpkin island/);
    expect(container.querySelector('[data-testid="min-bumpkin-island"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="min-digging-streak"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="vip-status"]')).not.toBeNull();
    expect(container.textContent).toMatch(/Maximum players/);
    expect(container.textContent).toMatch(/How many players can win/);
    expect(container.querySelector('[data-testid="prize-pool"]')).not.toBeNull();
    const prizeRow = container.querySelector(".prize-pool-row");
    expect(prizeRow?.querySelector('[data-testid="nft-giveaway"]')).not.toBeNull();
    const dateRow = container.querySelector(".dates-row");
    expect(dateRow?.querySelector('[data-testid="start-date"]')).not.toBeNull();
    expect(dateRow?.querySelector('[data-testid="end-date"]')).not.toBeNull();
    expect(dateRow?.querySelector('[data-testid="duration-days"]')).not.toBeNull();

    const setValue = (selector: string, value: string) => {
      const input = container.querySelector(selector) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    act(() => {
      setValue('[data-testid="start-date"]', "2026-08-23");
      setValue('[data-testid="end-date"]', "2026-08-30");
    });
    expect((container.querySelector('[data-testid="duration-days"]') as HTMLInputElement).value).toBe(
      "8",
    );
  });

  it("lets admin feature a live, upcoming, or past tournament", async () => {
    const onFeature = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      [
        row({
          tournament_id: "live",
          name: "Live cup",
          status: "active",
        }),
        row({
          tournament_id: "next",
          name: "September cup",
          status: "scheduled",
          start_at: "2026-09-01T00:00:00.000Z",
          end_at: "2026-09-08T00:00:00.000Z",
        }),
        row({
          tournament_id: "past-cup",
          name: "July cup",
          status: "ended",
          start_at: "2026-07-01T00:00:00.000Z",
          end_at: "2026-07-08T00:00:00.000Z",
        }),
      ],
      { onFeature, featuredId: "live" },
    );
    expect(container.querySelector('[data-testid="admin-past-group"]')?.textContent).toMatch(
      /July cup/,
    );
    expect(container.querySelector('[data-testid="admin-feature-live"]')?.textContent).toMatch(
      /Featured/,
    );
    expect(container.querySelector('[data-testid="admin-feature-past-cup"]')?.textContent).toMatch(
      /^Feature$/,
    );
    expect(container.querySelector('[data-testid="admin-feature-next"]')?.textContent).toMatch(
      /^Feature$/,
    );
    await act(async () => {
      (container.querySelector('[data-testid="admin-feature-next"]') as HTMLButtonElement).click();
    });
    expect(onFeature).toHaveBeenCalledWith("next");
    await act(async () => {
      (container.querySelector('[data-testid="admin-feature-past-cup"]') as HTMLButtonElement).click();
    });
    expect(onFeature).toHaveBeenCalledWith("past-cup");
  });

  it("splits current and upcoming and lets both be edited", () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      [
        row({
          tournament_id: "live",
          name: "Live cup",
          status: "active",
          start_at: "2026-08-10T00:00:00.000Z",
          end_at: "2026-08-20T00:00:00.000Z",
          duration_days: 10,
        }),
        row({
          tournament_id: "next",
          name: "September cup",
          status: "scheduled",
          start_at: "2026-09-01T00:00:00.000Z",
          end_at: "2026-09-08T00:00:00.000Z",
        }),
      ],
      { onUpdate },
    );
    expect(container.querySelector('[data-testid="admin-ongoing-group"]')?.textContent).toMatch(
      /Live cup/,
    );
    expect(container.querySelector('[data-testid="admin-upcoming-group"]')?.textContent).toMatch(
      /September cup/,
    );

    act(() => {
      const edit = [...container.querySelectorAll('[data-testid="admin-card-live"] button')].find(
        (node) => node.textContent === "Edit",
      );
      (edit as HTMLButtonElement | null)?.click();
    });
    const name = container.querySelector(
      'input[placeholder="Late August Otter Cup"]',
    ) as HTMLInputElement;
    const days = container.querySelector('[data-testid="duration-days"]') as HTMLInputElement;
    expect(name.value).toBe("Live cup");
    expect(days.value).toBe("10");

    act(() => {
      const end = container.querySelector('[data-testid="end-date"]') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(end, "2026-08-23");
      end.dispatchEvent(new Event("input", { bubbles: true }));
      end.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((container.querySelector('[data-testid="duration-days"]') as HTMLInputElement).value).toBe(
      "14",
    );
    act(() => {
      const save = [...container.querySelectorAll("button")].find(
        (node) => node.textContent === "Save changes",
      );
      save?.click();
    });
    expect(onUpdate).toHaveBeenCalledWith(
      "live",
      expect.objectContaining({ duration_days: 14, name: "Live cup" }),
    );
  });

  it("opens a roster to multi-add existing players and approve a named join", () => {
    const onAddFarms = vi.fn().mockResolvedValue(undefined);
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      [
        row({
          tournament_id: "live",
          name: "Live cup",
          status: "active",
        }),
      ],
      {
        selectedId: "live",
        players: [{ farm_id: "99", name: "rmr", active: true }],
        roster: [
          {
            farm_id: "11",
            name: "pending",
            tournament_id: "live",
            status: "pending",
            submitted_at: "2026-08-14T13:00:00+00:00",
          },
        ],
        onAddFarms,
        onApprove,
      },
    );
    expect(container.querySelector('[data-testid="admin-roster-live"]')?.textContent).toMatch(
      /pending/,
    );
    const box = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box).not.toBeNull();
    act(() => {
      box.click();
    });
    act(() => {
      const add = [...container.querySelectorAll("button")].find(
        (node) => node.textContent === "Add selected",
      );
      add?.click();
    });
    expect(onAddFarms).toHaveBeenCalledWith("live", ["99"]);
    act(() => {
      const approve = [...container.querySelectorAll("button")].find(
        (node) => node.textContent === "Approve",
      );
      approve?.click();
    });
    expect(onApprove).toHaveBeenCalledWith("11", "live");
  });

  it("exposes each event name and Edit/Delete in the group body", () => {
    const { container } = render([
      row({
        tournament_id: "live",
        name: "Live cup",
        status: "active",
        start_at: "2026-08-10T00:00:00.000Z",
        end_at: "2026-08-20T00:00:00.000Z",
        duration_days: 10,
      }),
      row({
        tournament_id: "next",
        name: "September cup",
        status: "scheduled",
        start_at: "2026-09-01T00:00:00.000Z",
        end_at: "2026-09-08T00:00:00.000Z",
      }),
    ]);
    const ongoing = container.querySelector('[data-testid="admin-ongoing-group"]');
    const upcoming = container.querySelector('[data-testid="admin-upcoming-group"]');
    const liveCard = container.querySelector('[data-testid="admin-card-live"]');
    const nextCard = container.querySelector('[data-testid="admin-card-next"]');
    expect(ongoing?.querySelector(".kicker")?.textContent).toMatch(/Ongoing/);
    expect(upcoming?.querySelector(".kicker")?.textContent).toMatch(/Upcoming/);
    expect(liveCard?.textContent).toMatch(/Live cup/);
    expect(liveCard?.textContent).toMatch(/Edit/);
    expect(liveCard?.textContent).toMatch(/Delete/);
    expect(nextCard?.textContent).toMatch(/September cup/);
    expect(nextCard?.textContent).toMatch(/Edit/);
    expect(nextCard?.textContent).toMatch(/Delete/);
    expect(ongoing?.querySelector('[data-testid="admin-ongoing-empty"]')).toBeNull();
    expect(upcoming?.querySelector('[data-testid="admin-upcoming-empty"]')).toBeNull();
  });

  it("shows empty-state copy in each group body, not only the kicker", () => {
    const { container } = render([]);
    const ongoing = container.querySelector('[data-testid="admin-ongoing-group"]');
    const upcoming = container.querySelector('[data-testid="admin-upcoming-group"]');
    expect(ongoing?.querySelector('[data-testid="admin-ongoing-empty"]')?.textContent).toBe(
      "No ongoing tournament.",
    );
    expect(upcoming?.querySelector('[data-testid="admin-upcoming-empty"]')?.textContent).toBe(
      "No upcoming tournaments.",
    );
    expect(ongoing?.querySelector(".kicker")?.textContent).toMatch(/Ongoing/);
    expect(upcoming?.querySelector(".kicker")?.textContent).toMatch(/Upcoming/);
    expect(container.querySelector('[data-testid^="admin-card-"]')).toBeNull();
  });

  it("asks before deleting a tournament and skips when no is chosen", () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      [row({ tournament_id: "live", name: "Live cup", status: "active" })],
      { onDelete },
    );
    act(() => {
      (container.querySelector('[data-testid="admin-delete-live"]') as HTMLButtonElement).click();
    });
    const dialog = container.querySelector('[data-testid="confirm-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toMatch(/Are you sure to do this/);
    expect(dialog?.textContent).toMatch(/Delete Live cup/);
    act(() => {
      (container.querySelector('[data-testid="confirm-no"]') as HTMLButtonElement).click();
    });
    expect(onDelete).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
  });

  it("deletes a tournament only after yes", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      [row({ tournament_id: "live", name: "Live cup", status: "active" })],
      { onDelete },
    );
    act(() => {
      (container.querySelector('[data-testid="admin-delete-live"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="confirm-yes"]') as HTMLButtonElement).click();
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ tournament_id: "live" }));
  });

  it("asks before reject and remove-from-roster; approve still fires immediately", async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    const onRemoveFarm = vi.fn().mockResolvedValue(undefined);
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      [row({ tournament_id: "live", name: "Live cup", status: "active" })],
      {
        selectedId: "live",
        roster: [
          {
            farm_id: "11",
            name: "pending",
            tournament_id: "live",
            status: "pending",
            submitted_at: "2026-08-14T13:00:00+00:00",
          },
          {
            farm_id: "22",
            name: "enrolled",
            tournament_id: "live",
            status: "enrolled",
            submitted_at: "2026-08-14T12:00:00+00:00",
          },
        ],
        onReject,
        onRemoveFarm,
        onApprove,
      },
    );
    act(() => {
      (container.querySelector('[data-testid="admin-reject-11"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    act(() => {
      (container.querySelector('[data-testid="confirm-no"]') as HTMLButtonElement).click();
    });
    expect(onReject).not.toHaveBeenCalled();

    act(() => {
      (container.querySelector('[data-testid="admin-reject-11"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="confirm-yes"]') as HTMLButtonElement).click();
    });
    expect(onReject).toHaveBeenCalledWith("11", "live");

    act(() => {
      (
        container.querySelector('[data-testid="admin-remove-roster-22"]') as HTMLButtonElement
      ).click();
    });
    expect(container.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    act(() => {
      (container.querySelector('[data-testid="confirm-no"]') as HTMLButtonElement).click();
    });
    expect(onRemoveFarm).not.toHaveBeenCalled();
    act(() => {
      (
        container.querySelector('[data-testid="admin-remove-roster-22"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="confirm-yes"]') as HTMLButtonElement).click();
    });
    expect(onRemoveFarm).toHaveBeenCalledWith("live", "22");

    act(() => {
      const approve = [...container.querySelectorAll("button")].find(
        (node) => node.textContent === "Approve",
      );
      approve?.click();
    });
    expect(onApprove).toHaveBeenCalledWith("11", "live");
    expect(container.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
  });

  it("submits snake_case extra settings on create and edit", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      [
        row({
          tournament_id: "live",
          name: "Live cup",
          status: "active",
          description: "Old blurb",
          min_bumpkin_island: "spring",
          min_digging_streak: 2,
          vip_required: false,
          max_players: 16,
          join_mode: "confirm",
          nft_giveaway: false,
          prize_places: [{ place: 1, amount: "30" }],
          prize_amount: "30",
        }),
      ],
      { onCreate, onUpdate },
    );

    act(() => {
      const button = [...container.querySelectorAll("button")].find((node) =>
        node.textContent?.includes("Create new tournament"),
      );
      button?.click();
    });
    const setValue = (selector: string, value: string) => {
      const input = container.querySelector(selector) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const setSelect = (selector: string, value: string) => {
      const select = container.querySelector(selector) as HTMLSelectElement;
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setValue('input[placeholder="Late August Otter Cup"]', "Autumn cup");
    setValue('[data-testid="start-date"]', "2026-08-23");
    setValue('[data-testid="end-date"]', "2026-08-30");
    const desc = container.querySelector(
      '[data-testid="tournament-description-input"]',
    ) as HTMLTextAreaElement;
    const descSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    descSetter?.call(desc, "Bring a shovel.");
    desc.dispatchEvent(new Event("input", { bubbles: true }));
    act(() => {
      setSelect('[data-testid="min-bumpkin-island"]', "desert");
      setSelect('[data-testid="vip-status"]', "true");
      setSelect('[data-testid="join-mode"]', "auto");
    });
    setValue('[data-testid="min-digging-streak"]', "3");
    setValue('[data-testid="max-players"]', "32");
    setValue('[data-testid="prize-pool"]', "70");
    setValue('[data-testid="winner-count"]', "2");
    setValue('[data-testid="prize-place-1"]', "50");
    setValue('[data-testid="prize-place-2"]', "20");
    expect(container.querySelector('[data-testid="prize-place-1-nft"]')).toBeNull();
    act(() => {
      const nft = container.querySelector('[data-testid="nft-giveaway"]') as HTMLInputElement;
      nft.click();
    });
    expect(container.querySelector('[data-testid="prize-place-1-nft"]')).not.toBeNull();
    setValue('[data-testid="prize-place-1-nft"]', "Rare Key");
    await act(async () => {
      const save = [...container.querySelectorAll("button")].find(
        (node) => node.textContent === "Create tournament",
      );
      save?.click();
    });
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Autumn cup",
        start_at: "2026-08-23T00:00:00.000Z",
        end_at: "2026-08-30T00:00:00.000Z",
        duration_days: 8,
        prize_amount: "70",
        description: "Bring a shovel.",
        min_bumpkin_island: "desert",
        min_digging_streak: 3,
        vip_required: true,
        max_players: 32,
        join_mode: "auto",
        nft_giveaway: true,
        prize_places: [
          { place: 1, amount: "50", nft_name: "Rare Key" },
          { place: 2, amount: "20", nft_name: "" },
        ],
      }),
    );

    act(() => {
      const edit = [...container.querySelectorAll('[data-testid="admin-card-live"] button')].find(
        (node) => node.textContent === "Edit",
      );
      (edit as HTMLButtonElement | null)?.click();
    });
    expect(
      (container.querySelector('[data-testid="tournament-description-input"]') as HTMLTextAreaElement)
        .value,
    ).toBe("Old blurb");
    expect((container.querySelector('[data-testid="min-bumpkin-island"]') as HTMLSelectElement).value).toBe(
      "spring",
    );
    expect((container.querySelector('[data-testid="join-mode"]') as HTMLSelectElement).value).toBe(
      "confirm",
    );
    act(() => {
      setSelect('[data-testid="min-bumpkin-island"]', "volcano+");
    });
    await act(async () => {
      const save = [...container.querySelectorAll("button")].find(
        (node) => node.textContent === "Save changes",
      );
      save?.click();
    });
    expect(onUpdate).toHaveBeenCalledWith(
      "live",
      expect.objectContaining({
        name: "Live cup",
        description: "Old blurb",
        min_bumpkin_island: "volcano+",
        max_players: 16,
        join_mode: "confirm",
        prize_places: [{ place: 1, amount: "30", nft_name: undefined }],
      }),
    );
  });

  it("previews 3 ongoing + 3 upcoming in column 1 and 6 past in column 2", () => {
    const live = Array.from({ length: 4 }, (_, index) =>
      row({
        tournament_id: `live-${index + 1}`,
        name: `Live ${index + 1}`,
        status: "active",
        start_at: "2026-08-01T00:00:00.000Z",
        end_at: `2026-08-${String(20 + index).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const upcoming = Array.from({ length: 4 }, (_, index) =>
      row({
        tournament_id: `up-${index + 1}`,
        name: `Upcoming ${index + 1}`,
        status: "scheduled",
        start_at: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        end_at: `2026-09-${String(index + 8).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const past = Array.from({ length: 7 }, (_, index) =>
      row({
        tournament_id: `past-${index + 1}`,
        name: `Past ${index + 1}`,
        status: "ended",
        start_at: `2026-0${Math.min(index + 1, 9)}-01T00:00:00.000Z`,
        end_at: `2026-0${Math.min(index + 1, 9)}-08T00:00:00.000Z`,
      }),
    );
    const { container } = render([...live, ...upcoming, ...past]);
    const col1 = container.querySelector('[data-testid="admin-live-column"]');
    const col2 = container.querySelector('[data-testid="admin-past-column"]');
    const ongoing = container.querySelector('[data-testid="admin-ongoing-group"]');
    const upcomingGroup = container.querySelector('[data-testid="admin-upcoming-group"]');
    const pastGroup = container.querySelector('[data-testid="admin-past-group"]');
    expect(col1?.contains(ongoing)).toBe(true);
    expect(col1?.contains(upcomingGroup)).toBe(true);
    expect(col2?.contains(pastGroup)).toBe(true);
    expect(ongoing?.querySelectorAll('[data-testid^="admin-card-"]')).toHaveLength(3);
    expect(upcomingGroup?.querySelectorAll('[data-testid^="admin-card-"]')).toHaveLength(3);
    expect(pastGroup?.querySelectorAll('[data-testid^="admin-card-"]')).toHaveLength(6);
    expect(ongoing?.querySelector('[data-testid="admin-card-live-4"]')).toBeNull();
    expect(upcomingGroup?.querySelector('[data-testid="admin-card-up-4"]')).toBeNull();
    expect(container.querySelector('[data-testid="admin-check-all-ongoing"]')).toBeNull();
    expect(container.querySelector('[data-testid="admin-check-all-past"]')).toBeNull();
    const seeLive = container.querySelector(
      '[data-testid="admin-see-all-live"]',
    ) as HTMLButtonElement;
    const seePast = container.querySelector(
      '[data-testid="admin-see-all-past"]',
    ) as HTMLButtonElement;
    expect(seeLive?.textContent).toMatch(/See all ongoing and upcoming/i);
    expect(seePast?.textContent).toMatch(/See all past/i);
    expect(seeLive.className).toMatch(/admin-overflow-link/);
    expect(seeLive.className).not.toMatch(/check-standings/);
    expect(seeLive.className).not.toMatch(/btn/);
    expect(container.querySelector('[data-testid="admin-overflow-live"]')).toBeNull();
    act(() => {
      seeLive.click();
    });
    const liveOverlay = container.querySelector('[data-testid="admin-overflow-live"]');
    expect(liveOverlay).not.toBeNull();
    expect(liveOverlay?.querySelector('[data-testid="admin-overflow-search"]')).not.toBeNull();
    expect(liveOverlay?.querySelector('[data-testid="admin-overflow-ongoing"]')).not.toBeNull();
    expect(liveOverlay?.querySelector('[data-testid="admin-overflow-upcoming"]')).not.toBeNull();
    expect(
      liveOverlay?.querySelectorAll('[data-testid="admin-overflow-ongoing"] [data-testid^="admin-card-"]'),
    ).toHaveLength(4);
    expect(
      liveOverlay?.querySelectorAll(
        '[data-testid="admin-overflow-upcoming"] [data-testid^="admin-card-"]',
      ),
    ).toHaveLength(4);
    expect(ongoing?.querySelectorAll('[data-testid^="admin-card-"]')).toHaveLength(3);
    expect(upcomingGroup?.querySelectorAll('[data-testid^="admin-card-"]')).toHaveLength(3);
    act(() => {
      const input = liveOverlay?.querySelector(
        '[data-testid="admin-overflow-search"]',
      ) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Upcoming 4");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(liveOverlay?.querySelector('[data-testid="admin-card-up-4"]')).not.toBeNull();
    expect(liveOverlay?.querySelector('[data-testid="admin-card-up-1"]')).toBeNull();
    expect(liveOverlay?.querySelector('[data-testid="admin-card-live-1"]')).toBeNull();
    act(() => {
      seePast.click();
    });
    const pastOverlay = container.querySelector('[data-testid="admin-overflow-past"]');
    expect(pastOverlay).not.toBeNull();
    expect(pastOverlay?.querySelector('[data-testid="admin-overflow-search"]')).not.toBeNull();
    expect(pastOverlay?.querySelector('[data-testid="admin-overflow-past-list"]')).not.toBeNull();
    expect(pastOverlay?.querySelector('[data-testid="admin-overflow-ongoing"]')).toBeNull();
    expect(
      pastOverlay?.querySelectorAll(
        '[data-testid="admin-overflow-past-list"] [data-testid^="admin-card-"]',
      ),
    ).toHaveLength(7);
    expect(pastGroup?.querySelectorAll('[data-testid^="admin-card-"]')).toHaveLength(6);
    act(() => {
      const input = pastOverlay?.querySelector(
        '[data-testid="admin-overflow-search"]',
      ) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "past-1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(pastOverlay?.querySelector('[data-testid="admin-card-past-1"]')).not.toBeNull();
    expect(pastOverlay?.querySelector('[data-testid="admin-card-past-2"]')).toBeNull();
  });

  it("omits overflow controls when live buckets have 3 or fewer and past has 6 or fewer", () => {
    const { container } = render([
      row({ tournament_id: "live", name: "Live cup", status: "active" }),
      row({
        tournament_id: "next",
        name: "September cup",
        status: "scheduled",
        start_at: "2026-09-01T00:00:00.000Z",
        end_at: "2026-09-08T00:00:00.000Z",
      }),
    ]);
    expect(container.querySelector('[data-testid="admin-see-all-live"]')).toBeNull();
    expect(container.querySelector('[data-testid="admin-see-all-past"]')).toBeNull();
    expect(container.querySelector('[data-testid="admin-check-all-ongoing"]')).toBeNull();
  });

  it("keeps the overflow control as text only, without a gray fill", () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    const block = css.match(/button\.admin-overflow-link\s*\{[^}]+\}/);
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/background:\s*transparent/);
    expect(block![0]).toMatch(/background-color:\s*transparent/);
    expect(block![0]).toMatch(/border:\s*none/);
    expect(block![0]).not.toMatch(/background:\s*#/);
    expect(block![0]).not.toMatch(/background:\s*rgb/);
    expect(block![0]).not.toMatch(/zinc/);
    expect(block![0]).not.toMatch(/var\(--mute\)/);
    expect(css).toMatch(/\.admin-overflow-col\s*\{[^}]*overflow(?:-y)?:\s*auto/s);
    expect(css).toMatch(/\.admin-overflow-col\s*\{[^}]*max-height:\s*calc\(10 \*/s);
    expect(css).toMatch(/\.admin-overflow-grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s);
    expect(css).toMatch(
      /\.admin-overflow-window\.is-past\s+\.admin-overflow-grid\s*\{[^}]*grid-template-columns:\s*1fr/s,
    );
  });

  it("opens a pending-only review from an upcoming card with confirmed bulk approve and reject", async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const onReject = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      [
        row({
          tournament_id: "next",
          name: "September cup",
          status: "scheduled",
          start_at: "2026-09-01T00:00:00.000Z",
          end_at: "2026-09-08T00:00:00.000Z",
          description: "Bring a shovel.",
          prize_amount: "30",
          prize_places: [{ place: 1, amount: "30" }],
          min_bumpkin_island: "desert",
          vip_required: true,
          join_mode: "confirm",
          max_players: 16,
        }),
      ],
      {
        roster: [
          {
            farm_id: "11",
            name: "pending-a",
            tournament_id: "next",
            status: "pending",
            submitted_at: "2026-08-14T13:00:00+00:00",
          },
          {
            farm_id: "12",
            name: "pending-b",
            tournament_id: "next",
            status: "pending",
            submitted_at: "2026-08-14T13:10:00+00:00",
          },
          {
            farm_id: "22",
            name: "already-in",
            tournament_id: "next",
            status: "enrolled",
            submitted_at: "2026-08-14T12:00:00+00:00",
          },
        ],
        onApprove,
        onReject,
      },
    );
    act(() => {
      (container.querySelector('[data-testid="admin-open-next"]') as HTMLButtonElement).click();
    });
    const overlay = container.querySelector('[data-testid="admin-pending-review"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toMatch(/September cup/);
    expect(overlay?.querySelector('[data-testid="admin-review-facts"]')?.textContent).toMatch(
      /Bring a shovel/,
    );
    expect(overlay?.querySelector('[data-testid="admin-review-prizes"]')?.textContent).toMatch(/30/);
    expect(overlay?.textContent).toMatch(/pending-a/);
    expect(overlay?.textContent).toMatch(/pending-b/);
    expect(overlay?.textContent).not.toMatch(/already-in/);
    expect(overlay?.textContent).not.toMatch(/Add existing players/);
    expect(overlay?.textContent).not.toMatch(/Enrolled/);
    expect(container.querySelector('[data-testid="admin-roster-next"]')).toBeNull();
    act(() => {
      (container.querySelector('[data-testid="admin-review-select-all"]') as HTMLButtonElement).click();
    });
    act(() => {
      (container.querySelector('[data-testid="admin-review-approve"]') as HTMLButtonElement).click();
    });
    expect(onApprove).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="confirm-dialog"]')?.textContent).toMatch(
      /Approve 2 join requests/,
    );
    act(() => {
      (container.querySelector('[data-testid="confirm-no"]') as HTMLButtonElement).click();
    });
    expect(onApprove).not.toHaveBeenCalled();
    act(() => {
      (container.querySelector('[data-testid="admin-review-approve"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="confirm-yes"]') as HTMLButtonElement).click();
    });
    expect(onApprove).toHaveBeenCalledTimes(2);
    expect(onApprove).toHaveBeenCalledWith("11", "next");
    expect(onApprove).toHaveBeenCalledWith("12", "next");

    act(() => {
      (container.querySelector('[data-testid="admin-review-pick-11"]') as HTMLInputElement).click();
      (container.querySelector('[data-testid="admin-review-pick-12"]') as HTMLInputElement).click();
    });
    act(() => {
      (container.querySelector('[data-testid="admin-review-deselect-all"]') as HTMLButtonElement).click();
    });
    act(() => {
      (container.querySelector('[data-testid="admin-review-pick-11"]') as HTMLInputElement).click();
    });
    act(() => {
      (container.querySelector('[data-testid="admin-review-reject"]') as HTMLButtonElement).click();
    });
    expect(onReject).not.toHaveBeenCalled();
    await act(async () => {
      (container.querySelector('[data-testid="confirm-yes"]') as HTMLButtonElement).click();
    });
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith("11", "next");
  });

  it("opens the same pending review when reviewId is set from pending joins", () => {
    const { container } = render(
      [
        row({
          tournament_id: "next",
          name: "September cup",
          status: "scheduled",
          start_at: "2026-09-01T00:00:00.000Z",
          end_at: "2026-09-08T00:00:00.000Z",
        }),
      ],
      {
        reviewId: "next",
        roster: [
          {
            farm_id: "11",
            name: "pending-a",
            tournament_id: "next",
            status: "pending",
            submitted_at: "2026-08-14T13:00:00+00:00",
          },
        ],
      },
    );
    const overlay = container.querySelector('[data-testid="admin-pending-review"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toMatch(/September cup/);
    expect(overlay?.textContent).toMatch(/pending-a/);
    expect(overlay?.textContent).not.toMatch(/Add existing players/);
  });

  it("lets admin groups size to their content in the shipped stylesheet", () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.admin-tourney-home\s+\.tourney-group\s*\{[^}]*overflow:\s*visible/s);
    expect(css).toMatch(/\.admin-tourney-home\s+\.tourney-group\s*\{[^}]*flex:\s*none/s);
    expect(css).toMatch(/\.admin-tourney-home\s+\.tourney-empty\s*\{[^}]*padding:/s);
  });

  it("saves a text prize pool when NFTs are given away", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { container } = render([], { onCreate });
    act(() => {
      const button = [...container.querySelectorAll("button")].find((node) =>
        node.textContent?.includes("Create new tournament"),
      );
      button?.click();
    });
    const setValue = (selector: string, value: string) => {
      const input = container.querySelector(selector) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setValue('input[placeholder="Late August Otter Cup"]', "NFT pack cup");
    setValue('[data-testid="start-date"]', "2026-08-23");
    setValue('[data-testid="end-date"]', "2026-08-30");
    act(() => {
      const nft = container.querySelector('[data-testid="nft-giveaway"]') as HTMLInputElement;
      nft.click();
    });
    setValue('[data-testid="prize-pool"]', "3x Rare Key");
    await act(async () => {
      const save = [...container.querySelectorAll("button")].find(
        (node) => node.textContent === "Create tournament",
      );
      save?.click();
    });
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "NFT pack cup",
        prize_amount: "3x Rare Key",
        nft_giveaway: true,
      }),
    );
  });

  it("does not suffix Flower on a text prize pool", () => {
    const { container } = render([
      row({
        tournament_id: "live",
        name: "NFT pack cup",
        status: "active",
        prize_amount: "3x Rare Key",
        nft_giveaway: true,
      }),
    ]);
    const meta =
      container.querySelector('[data-testid="admin-card-live"]')?.textContent ?? "";
    expect(meta).toMatch(/3x Rare Key/);
    expect(meta).not.toMatch(/3x Rare Key Flower/);
  });
});
