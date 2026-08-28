import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEED_SLOGANS } from "../lib/slogans";
import { AdminSlogans } from "./AdminSlogans";

let root: Root;
let container: HTMLDivElement;

function renderList(onAdd = vi.fn().mockResolvedValue(undefined)) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<AdminSlogans slogans={SEED_SLOGANS} onAdd={onAdd} />);
  });
  return { el: container, onAdd };
}

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("AdminSlogans", () => {
  it("lists the stored slogans and posts a new text with an icon", async () => {
    const { el, onAdd } = renderList();
    const items = [...el.querySelectorAll('[data-testid="admin-slogan-list"] li')].map(
      (node) => node.textContent,
    );
    expect(items[0]).toMatch(/Slap my pets/);
    expect(items).toHaveLength(SEED_SLOGANS.length);

    act(() => {
      const input = el.querySelector('[data-testid="admin-slogan-text"]') as HTMLInputElement;
      const select = el.querySelector('[data-testid="admin-slogan-icon"]') as HTMLSelectElement;
      const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      const selectSetter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      inputSetter?.call(input, "Feed my chicken");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      selectSetter?.call(select, "banana");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      (el.querySelector('[data-testid="admin-slogan-add"]') as HTMLButtonElement).click();
    });
    expect(onAdd).toHaveBeenCalledWith({ text: "Feed my chicken", icon: "banana" });
  });
});
