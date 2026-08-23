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
  it("hides the create form until the button is clicked and has a single length field", () => {
    const { container } = render([]);
    expect(container.textContent).toMatch(/Ongoing/);
    expect(container.textContent).toMatch(/Upcoming/);
    expect(container.textContent).not.toMatch(/Custom days/);
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('input[placeholder="Late August Otter Cup"]')).toBeNull();

    act(() => {
      const button = [...container.querySelectorAll("button")].find((node) =>
        node.textContent?.includes("Create new tournament"),
      );
      button?.click();
    });
    expect(container.querySelector("form")).not.toBeNull();
    expect(container.textContent).toMatch(/Length \(days\)/);
    expect(container.textContent).not.toMatch(/Custom days/);
    expect(container.textContent).not.toMatch(/To \(optional\)/);
    expect(container.querySelector('[data-testid="duration-days"]')).not.toBeNull();
    expect((container.querySelector('[data-testid="duration-days"]') as HTMLInputElement).min).toBe(
      "1",
    );
    expect(container.textContent).toMatch(/Min bumpkin level/);
    expect(container.textContent).toMatch(/Maximum players/);
    expect(container.textContent).toMatch(/Join mode/);
    expect(container.textContent).toMatch(/How many players can win/);
    expect(container.textContent).toMatch(/Description/);
  });

  it("lets admin feature a live or past tournament, not upcoming", async () => {
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
    expect(container.querySelector('[data-testid="admin-feature-next"]')).toBeNull();
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
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(days, "14");
      days.dispatchEvent(new Event("input", { bubbles: true }));
    });
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
          min_bumpkin_level: 10,
          max_players: 16,
          join_mode: "confirm",
          prize_places: [{ place: 1, amount: "30" }],
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
    };
    setValue('input[placeholder="Late August Otter Cup"]', "Autumn cup");
    setValue('input[type="date"]', "2026-10-01");
    setValue('[data-testid="duration-days"]', "7");
    const desc = container.querySelector(
      '[data-testid="tournament-description-input"]',
    ) as HTMLTextAreaElement;
    const descSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    descSetter?.call(desc, "Bring a shovel.");
    desc.dispatchEvent(new Event("input", { bubbles: true }));
    setValue('[data-testid="min-bumpkin-level"]', "20");
    setValue('[data-testid="max-players"]', "32");
    act(() => {
      const select = container.querySelector('[data-testid="join-mode"]') as HTMLSelectElement;
      select.value = "auto";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    setValue('[data-testid="winner-count"]', "2");
    setValue('[data-testid="prize-place-1"]', "50");
    setValue('[data-testid="prize-place-2"]', "20");
    await act(async () => {
      const save = [...container.querySelectorAll("button")].find(
        (node) => node.textContent === "Create tournament",
      );
      save?.click();
    });
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Autumn cup",
        duration_days: 7,
        prize_amount: "30",
        description: "Bring a shovel.",
        min_bumpkin_level: 20,
        max_players: 32,
        join_mode: "auto",
        prize_places: [
          { place: 1, amount: "50" },
          { place: 2, amount: "20" },
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
    expect((container.querySelector('[data-testid="min-bumpkin-level"]') as HTMLInputElement).value).toBe(
      "10",
    );
    expect((container.querySelector('[data-testid="join-mode"]') as HTMLSelectElement).value).toBe(
      "confirm",
    );
    setValue('[data-testid="min-bumpkin-level"]', "25");
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
        min_bumpkin_level: 25,
        max_players: 16,
        join_mode: "confirm",
        prize_places: [{ place: 1, amount: "30" }],
      }),
    );
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
});
