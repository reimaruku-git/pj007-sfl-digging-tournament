import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerDetail, TrackedFarm } from "../api/admin";
import { AdminPlayers } from "./AdminPlayers";

let root: Root;
let container: HTMLDivElement;

function farm(partial: Partial<TrackedFarm> & Pick<TrackedFarm, "farm_id">): TrackedFarm {
  return {
    name: partial.name ?? "rmr",
    active: partial.active ?? true,
    digging_streak: partial.digging_streak ?? 2,
    average_per_day: partial.average_per_day ?? 6,
    ...partial,
  };
}

function render(props: Partial<Parameters<typeof AdminPlayers>[0]> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const merged = {
    farms: [farm({ farm_id: "99", name: "rmr" })],
    selectedId: null as string | null,
    detail: null as PlayerDetail | null,
    snapshot: "",
    onSelect: vi.fn(),
    onAdd: vi.fn().mockResolvedValue(undefined),
    onToggleActive: vi.fn().mockResolvedValue(undefined),
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onSnapshot: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    ...props,
  };
  act(() => {
    root.render(<AdminPlayers {...merged} />);
  });
  return { container, props: merged };
}

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("AdminPlayers", () => {
  it("shows only identity, active, streak, and average on the collapsed list", () => {
    const { container } = render();
    const text = container.textContent ?? "";
    expect(text).toMatch(/Players/);
    expect(text).toMatch(/rmr/);
    expect(text).toMatch(/yes/);
    expect(text).toMatch(/Digging streak/);
    expect(text).toMatch(/AVG SCORE/);
    expect(container.querySelector('[data-testid="player-streak-99"]')?.textContent).toBe("2");
    expect(container.querySelector('[data-testid="player-avg-99"]')?.textContent).toBe("6.00");
    expect(text).not.toMatch(/Override/);
    expect(text).not.toMatch(/Invalidate/);
    expect(container.querySelector('[data-testid="player-detail-actions"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Disable/);
    expect(container.textContent).not.toMatch(/Refresh/);
    expect(container.textContent).not.toMatch(/Snapshot/);
    expect(container.textContent).not.toMatch(/Remove/);
  });

  it("opens a farm for history and the four in-detail actions only", () => {
    const onSelect = vi.fn();
    const { container } = render({
      selectedId: "99",
      onSelect,
      detail: {
        farm_id: "99",
        name: "rmr",
        active: true,
        digging_streak: 4,
        average_per_day: 3,
        score: { digs_to_third_op: 21, otter_count: 3, status: "completed" },
        history: [
          {
            tournament_id: "past",
            name: "July cup",
            start_at: "2026-07-01T00:00:00+00:00",
            end_at: "2026-07-08T00:00:00+00:00",
            duration_days: 7,
            score: 2,
            digs_to_third_op: 14,
            rank: 1,
            status: "completed",
            otter_count: 3,
          },
        ],
        enrollments: [],
        pending_joins: [],
      },
    });
    const detail = container.querySelector('[data-testid="player-detail-99"]');
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toMatch(/July cup/);
    expect(detail?.textContent).toMatch(/Streak 4/);
    expect(detail?.textContent).toMatch(/AVG SCORE 3\.00/);
    const actions =
      container.querySelector('[data-testid="player-detail-actions"]')?.textContent ?? "";
    expect(actions).toMatch(/Disable/);
    expect(actions).toMatch(/Refresh/);
    expect(actions).toMatch(/Snapshot/);
    expect(actions).toMatch(/Remove/);
    expect(actions).not.toMatch(/Override/);
    expect(actions).not.toMatch(/Invalidate/);
    expect(container.textContent).not.toMatch(/Override/);
    expect(container.textContent).not.toMatch(/Invalidate/);

    act(() => {
      (container.querySelector('[data-testid="player-row-99"]') as HTMLTableRowElement).click();
    });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("asks before removing a tracked farm and skips when no is chosen", () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onSnapshot = vi.fn().mockResolvedValue(undefined);
    const { container } = render({
      selectedId: "99",
      onRemove,
      onRefresh,
      onSnapshot,
    });
    act(() => {
      (container.querySelector('[data-testid="player-remove"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    act(() => {
      (container.querySelector('[data-testid="confirm-no"]') as HTMLButtonElement).click();
    });
    expect(onRemove).not.toHaveBeenCalled();
    act(() => {
      const refresh = [...container.querySelectorAll("button")].find(
        (node) => node.textContent === "Refresh",
      );
      refresh?.click();
    });
    act(() => {
      const snap = [...container.querySelectorAll("button")].find(
        (node) => node.textContent === "Snapshot",
      );
      snap?.click();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
  });

  it("removes a tracked farm only after yes", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const { container } = render({ selectedId: "99", onRemove });
    act(() => {
      (container.querySelector('[data-testid="player-remove"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="confirm-yes"]') as HTMLButtonElement).click();
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ farm_id: "99" }));
  });
});
