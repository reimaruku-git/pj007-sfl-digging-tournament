import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
    expect(el.querySelector('[data-testid="menu-options"]')?.textContent).not.toMatch(/Tournaments/);
    expect(el.textContent).not.toMatch(/Find a farm/);
    expect(el.querySelector('[data-testid="disconnect-farm"]')).toBeNull();
    const hrefs = [...el.querySelectorAll("a")].map((node) => node.getAttribute("href"));
    expect(hrefs).not.toContain("/admin");
  });

  it("puts the connect field left of the timer when no farm is connected", () => {
    const el = renderAt("/");
    const tools = el.querySelector(".topbar-tools");
    const connect = tools?.querySelector('[data-testid="farm-connect"]');
    const input = tools?.querySelector('[data-testid="farm-id-input"]');
    const submit = tools?.querySelector('[data-testid="farm-id-submit"]');
    const timer = tools?.querySelector(".utc-chip");
    expect(connect).not.toBeNull();
    expect(input).not.toBeNull();
    expect(submit).not.toBeNull();
    expect(submit?.textContent).toMatch(/Connect|Enter/);
    expect(timer).not.toBeNull();
    expect(el.querySelector('[data-testid="farm-id-gate"]')).toBeNull();
    expect(
      connect!.compareDocumentPosition(timer!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps connected name and id inside the opened burger, outside the options box", () => {
    writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
    const el = renderAt("/");
    const tools = el.querySelector(".topbar-tools");
    expect(tools?.querySelector('[data-testid="farm-connect"]')).toBeNull();
    expect(tools?.querySelector('[data-testid="farm-connected"]')).toBeNull();
    expect(tools?.textContent).not.toMatch(/rmr/);
    expect(tools?.textContent).not.toMatch(/3666918801844311/);

    act(() => {
      (el.querySelector('button[aria-label="Menu"]') as HTMLButtonElement).click();
    });

    const connected = el.querySelector('[data-testid="farm-connected"]');
    const options = el.querySelector('[data-testid="menu-options"]');
    expect(connected).not.toBeNull();
    expect(options).not.toBeNull();
    expect(connected?.closest(".menu-panel")).not.toBeNull();
    expect(connected?.closest('[data-testid="menu-options"]')).toBeNull();
    expect(options?.contains(connected)).toBe(false);
    const name = connected?.querySelector(".farm-connected-name");
    const id = connected?.querySelector(".farm-connected-id");
    expect(name?.textContent).toBe("rmr");
    expect(id?.textContent).toBe("3666918801844311");
    expect(name!.compareDocumentPosition(id!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      connected!.compareDocumentPosition(options!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(options?.textContent).toMatch(/Rules/);
    expect(options?.textContent).toMatch(/Join a tournament/);
    expect(options?.textContent).not.toMatch(/Tournaments/);
    expect(options?.querySelector('[data-testid="disconnect-farm"]')?.textContent).toMatch(
      /Disconnect rmr/,
    );
    expect(options?.textContent).not.toMatch(/3666918801844311/);
    expect(el.querySelector(".utc-chip")?.contains(connected)).toBe(false);
  });

  it("opens the boxed options without a name or id when no farm is connected", () => {
    const el = renderAt("/");
    act(() => {
      (el.querySelector('button[aria-label="Menu"]') as HTMLButtonElement).click();
    });
    expect(el.querySelector('[data-testid="farm-connected"]')).toBeNull();
    const options = el.querySelector('[data-testid="menu-options"]');
    expect(options?.textContent).toMatch(/Rules/);
    expect(options?.textContent).toMatch(/Join a tournament/);
    expect(options?.textContent).not.toMatch(/Tournaments/);
    expect(options?.querySelector('[data-testid="disconnect-farm"]')).toBeNull();
  });

  it("hides connect and connected chrome on /admin", () => {
    writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
    const el = renderAt("/admin");
    expect(el.querySelector('[data-testid="farm-connect"]')).toBeNull();
    expect(el.querySelector('[data-testid="farm-connected"]')).toBeNull();
    expect(el.querySelector('[data-testid="farm-id-input"]')).toBeNull();
    expect(el.querySelector(".utc-chip")).not.toBeNull();
  });

  it("sends Join a tournament to the catalog page", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <FarmSessionProvider>
            <Routes>
              <Route
                path="/"
                element={
                  <Layout>
                    <main data-testid="home-body">home</main>
                  </Layout>
                }
              />
              <Route
                path="/tournaments"
                element={
                  <Layout>
                    <main data-testid="catalog-body">catalog</main>
                  </Layout>
                }
              />
            </Routes>
          </FarmSessionProvider>
        </MemoryRouter>,
      );
    });
    act(() => {
      (container.querySelector('button[aria-label="Menu"]') as HTMLButtonElement).click();
    });
    const join = [...container.querySelectorAll('[data-testid="menu-options"] button')].find(
      (node) => node.textContent === "Join a tournament",
    ) as HTMLButtonElement;
    expect(join).not.toBeUndefined();
    act(() => {
      join.click();
    });
    expect(container.querySelector('[data-testid="catalog-body"]')?.textContent).toBe("catalog");
    expect(container.querySelector('[data-testid="home-body"]')).toBeNull();
  });

  it("styles ongoing green and upcoming gray in the shipped stylesheet", () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.tourney-status\.ongoing\s*\{[^}]*color:\s*var\(--green\)/s);
    expect(css).toMatch(/\.tourney-status\.upcoming\s*\{[^}]*color:\s*var\(--mute\)/s);
    expect(css).not.toMatch(/#e8b923/);
  });
});
