import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminSlogansPanel } from "./AdminSlogansPanel";

vi.mock("../api/client", () => ({
  requestJson: vi.fn(),
  errorMessage: (_data: unknown, fallback: string) => fallback,
}));

import { requestJson } from "../api/client";

const mockRequest = vi.mocked(requestJson);

function ok<T>(data: T) {
  return { response: { ok: true, status: 200 } as Response, data };
}

const listed = {
  slogans: [{ text: "Slap my pets" }, { text: "Grow my banana" }],
  count: 2,
  today_text: null as string | null,
  today_day: null as string | null,
};

let root: Root;
let container: HTMLDivElement;

function renderPanel() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <AdminSlogansPanel open onClose={() => undefined} />
      </QueryClientProvider>,
    );
  });
  return container;
}

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue(ok(listed));
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("AdminSlogansPanel", () => {
  it("adds, edits, deletes, and pins today through admin slogans", async () => {
    const el = renderPanel();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mockRequest).toHaveBeenCalledWith("admin/slogans");
    expect(el.querySelector('[data-testid="admin-slogans-panel"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="admin-slogan-edit-0"]')).not.toBeNull();

    mockRequest.mockResolvedValueOnce(
      ok({
        slogan: { text: "Feed my chicken" },
        slogans: [...listed.slogans, { text: "Feed my chicken" }],
        count: 3,
        today_text: null,
        today_day: null,
      }),
    );
    act(() => {
      const input = el.querySelector('[data-testid="admin-slogan-text"]') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Feed my chicken",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (el.querySelector('[data-testid="admin-slogan-add"]') as HTMLButtonElement).click();
    });
    expect(mockRequest).toHaveBeenCalledWith("admin/slogans", {
      method: "POST",
      body: JSON.stringify({ text: "Feed my chicken" }),
    });

    mockRequest.mockResolvedValueOnce(
      ok({
        slogans: listed.slogans,
        count: 2,
        today_text: "Grow my banana",
        today_day: "2026-08-28",
      }),
    );
    await act(async () => {
      (el.querySelector('[data-testid="admin-slogan-today-1"]') as HTMLButtonElement).click();
    });
    expect(mockRequest).toHaveBeenCalledWith("admin/slogans", {
      method: "PUT",
      body: JSON.stringify({
        slogans: listed.slogans,
        today_text: "Grow my banana",
      }),
    });

    mockRequest.mockResolvedValueOnce(
      ok({ slogans: [{ text: "Grow my banana" }], count: 1, today_text: null, today_day: null }),
    );
    await act(async () => {
      (el.querySelector('[data-testid="admin-slogan-delete-0"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (el.querySelector('[data-testid="confirm-yes"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mockRequest).toHaveBeenCalledWith("admin/slogans", {
      method: "PUT",
      body: JSON.stringify({
        slogans: [{ text: "Grow my banana" }],
        today_text: null,
      }),
    });

    mockRequest.mockResolvedValueOnce(
      ok({
        slogans: [{ text: "Slap my pets ✋" }, { text: "Grow my banana" }],
        count: 2,
        today_text: null,
        today_day: null,
      }),
    );
    const edit = el.querySelector('[data-testid="admin-slogan-edit-0"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        edit,
        "Slap my pets ✋",
      );
      edit.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (el.querySelector('[data-testid="admin-slogan-save-0"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mockRequest).toHaveBeenCalledWith("admin/slogans", {
      method: "PUT",
      body: JSON.stringify({
        slogans: [{ text: "Slap my pets ✋" }, { text: "Grow my banana" }],
        today_text: null,
      }),
    });
  });
});
