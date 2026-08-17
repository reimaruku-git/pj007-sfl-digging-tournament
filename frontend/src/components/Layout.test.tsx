import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { FarmSessionProvider } from "../lib/farmSession";
import { writeFarmIdentity } from "../lib/followFarm";
import { Layout } from "./Layout";

let root: Root;
let container: HTMLDivElement;

function renderAt(path = "/") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <FarmSessionProvider>
          <Layout>
            <main>page-body</main>
          </Layout>
        </FarmSessionProvider>
      </MemoryRouter>,
    );
  });
  return container;
}

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  localStorage.clear();
});

describe("public chrome", () => {
  it("has a burger and no Leaderboard or Admin nav links", () => {
    const el = renderAt("/");
    const links = [...el.querySelectorAll("a")].map((node) => node.getAttribute("href"));
    expect(links).not.toContain("/admin");
    expect(el.textContent).not.toMatch(/\bAdmin\b/);
    expect(el.querySelector("nav")?.textContent ?? "").not.toMatch(/Leaderboard/);
    const burger = el.querySelector('button[aria-label="Menu"]');
    expect(burger).not.toBeNull();
    act(() => {
      (burger as HTMLButtonElement).click();
    });
    expect(el.textContent).toMatch(/Rules/);
    expect(el.textContent).toMatch(/Join a tournament/);
    expect(el.textContent).toMatch(/Tournaments/);
    expect(el.textContent).not.toMatch(/Find a farm/);
    expect(el.querySelector('[data-testid="disconnect-farm"]')).toBeNull();
    const hrefs = [...el.querySelectorAll("a")].map((node) => node.getAttribute("href"));
    expect(hrefs).not.toContain("/admin");
  });

  it("offers disconnect when a farm identity is stored", () => {
    writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
    const el = renderAt("/");
    act(() => {
      (el.querySelector('button[aria-label="Menu"]') as HTMLButtonElement).click();
    });
    const disconnect = el.querySelector('[data-testid="disconnect-farm"]');
    expect(disconnect).not.toBeNull();
    expect(disconnect?.textContent).toMatch(/Disconnect rmr/);
  });
});
