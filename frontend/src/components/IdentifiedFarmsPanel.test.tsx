import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentifiedFarmsPanel, rankIdentitiesBySearch } from "./IdentifiedFarmsPanel";

vi.mock("../api/admin", () => ({
  listIdentities: vi.fn().mockResolvedValue([
    { farm_id: "111", name: "Alpha" },
    { farm_id: "222", name: "Beta" },
    { farm_id: "999", name: "Zed" },
  ]),
}));

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
        <IdentifiedFarmsPanel open onClose={() => undefined} />
      </QueryClientProvider>,
    );
  });
  return container;
}

afterEach(() => {
  if (root) {
    act(() => {
      root.unmount();
    });
  }
  container?.remove();
});

describe("rankIdentitiesBySearch", () => {
  it("puts name or id matches at the top and keeps the rest", () => {
    const items = [
      { farm_id: "111", name: "Alpha" },
      { farm_id: "222", name: "Beta" },
      { farm_id: "999", name: "Zed" },
    ];
    expect(rankIdentitiesBySearch(items, "zed").map((row) => row.farm_id)).toEqual([
      "999",
      "111",
      "222",
    ]);
    expect(rankIdentitiesBySearch(items, "22").map((row) => row.farm_id)).toEqual([
      "222",
      "111",
      "999",
    ]);
    expect(rankIdentitiesBySearch(items, " ").map((row) => row.farm_id)).toEqual([
      "111",
      "222",
      "999",
    ]);
  });
});

describe("IdentifiedFarmsPanel", () => {
  it("renders Name then ID and ranks search matches to the top", async () => {
    const el = renderPanel();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(el.querySelector('[data-testid="identified-farms-overlay"]')?.textContent).toMatch(
      /Identified farms/,
    );
    const table = el.querySelector('[data-testid="identified-farms-table"]') as HTMLTableElement;
    const headers = [...table.querySelectorAll("th")].map((node) => node.textContent);
    expect(headers).toEqual(["Name", "ID"]);
    const search = el.querySelector('[data-testid="identified-farms-search"]') as HTMLInputElement;
    expect(search).not.toBeNull();
    const head = el.querySelector(".identified-farms-head");
    expect(head?.contains(search)).toBe(true);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "999");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const ids = [...table.querySelectorAll("tbody tr")].map(
      (row) => row.querySelector(".farm-id")?.textContent,
    );
    expect(ids[0]).toBe("999");
    expect(ids).toEqual(["999", "111", "222"]);
  });
});
