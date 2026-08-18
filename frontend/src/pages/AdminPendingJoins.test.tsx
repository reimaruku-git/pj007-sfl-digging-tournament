import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPendingJoins } from "./AdminPendingJoins";

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
        submitted_at: "2026-08-14T13:00:00+00:00",
        status: "pending",
      },
    ],
    onApprove: vi.fn().mockResolvedValue(undefined),
    onReject: vi.fn().mockResolvedValue(undefined),
    ...handlers,
  };
  act(() => {
    root.render(<AdminPendingJoins {...props} />);
  });
  return { container, props };
}

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
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

  it("is the dashboard pending list AdminPage renders", () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "AdminPage.tsx"),
      "utf8",
    );
    expect(src).toMatch(/<AdminPendingJoins/);
    expect(src).not.toMatch(/onClick=\{\(\) =>\s*\n?\s*rejectSubmission/);
  });
});
