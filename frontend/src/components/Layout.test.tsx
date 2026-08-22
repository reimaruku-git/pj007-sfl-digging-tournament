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
  it("has Live and Tournaments nav and no Admin link", () => {
    const el = renderAt("/");
    const nav = el.querySelector('[data-testid="public-nav"]');
    expect(nav?.textContent).toMatch(/Live/);
    expect(nav?.textContent).toMatch(/Tournaments/);
    expect(nav?.textContent).not.toMatch(/Windows/);
    expect(el.querySelector('[data-testid="nav-tournaments"]')?.getAttribute("href")).toBe(
      "/tournaments",
    );
    const links = [...el.querySelectorAll("a")].map((node) => node.getAttribute("href"));
    expect(links).not.toContain("/admin");
    expect(el.textContent).not.toMatch(/\bAdmin\b/);
    expect(el.querySelector('button[aria-label="Menu"]')).toBeNull();
  });

  it("puts the connect field on the right when no farm is connected", () => {
    const el = renderAt("/");
    const tools = el.querySelector(".topbar-tools");
    const connect = tools?.querySelector('[data-testid="farm-connect"]');
    const input = tools?.querySelector('[data-testid="farm-id-input"]');
    const submit = tools?.querySelector('[data-testid="farm-id-submit"]');
    expect(connect).not.toBeNull();
    expect(input).not.toBeNull();
    expect(submit).not.toBeNull();
    expect(submit?.textContent).toMatch(/Connect|Enter/);
    expect(el.querySelector('[data-testid="farm-id-gate"]')).toBeNull();
    expect(el.querySelector('[data-testid="farm-connected"]')).toBeNull();
  });

  it("shows the connected farm chip in the header, not a burger", () => {
    writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
    const el = renderAt("/");
    const tools = el.querySelector(".topbar-tools");
    expect(tools?.querySelector('[data-testid="farm-connect"]')).toBeNull();
    const connected = el.querySelector('[data-testid="farm-connected"]');
    expect(connected).not.toBeNull();
    expect(tools?.contains(connected)).toBe(true);
    expect(connected?.querySelector(".farm-connected-name")?.textContent).toBe("rmr");
    expect(connected?.querySelector('[data-testid="color-canvas"]')).not.toBeNull();
    expect(el.querySelector('button[aria-label="Menu"]')).toBeNull();
    expect(el.querySelector('[data-testid="disconnect-farm"]')).toBeNull();

    act(() => {
      (connected as HTMLButtonElement).click();
    });
    const options = el.querySelector('[data-testid="menu-options"]');
    expect(options?.textContent).toMatch(/View farm/);
    expect(options?.querySelector('[data-testid="disconnect-farm"]')?.textContent).toMatch(
      /Disconnect rmr/,
    );
    expect(options?.textContent).not.toMatch(/Windows/);
  });

  it("opens Tournaments from the header nav", () => {
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
      (container.querySelector('[data-testid="nav-tournaments"]') as HTMLAnchorElement).click();
    });
    expect(container.querySelector('[data-testid="catalog-body"]')?.textContent).toBe("catalog");
    expect(container.querySelector('[data-testid="home-body"]')).toBeNull();
  });

  it("hides connect and connected chrome on /admin", () => {
    writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
    const el = renderAt("/admin");
    expect(el.querySelector('[data-testid="farm-connect"]')).toBeNull();
    expect(el.querySelector('[data-testid="farm-connected"]')).toBeNull();
    expect(el.querySelector('[data-testid="farm-id-input"]')).toBeNull();
    expect(el.querySelector('[data-testid="public-nav"]')).toBeNull();
    expect(el.querySelector('button[aria-label="Menu"]')).not.toBeNull();
    expect(el.querySelector(".utc-chip")).not.toBeNull();
  });

  it("keeps the dusk palette and Live badge green", () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.tourney-status\.ongoing\s*\{[^}]*color:\s*var\(--green\)/s);
    expect(css).not.toMatch(/#e8b923/);
  });

  it("pins the public top bar full-width and opaque", () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.public-topbar\s*\{[^}]*position:\s*(sticky|fixed)[^}]*top:\s*0[^}]*width:\s*100%[^}]*background:\s*var\(--bg\)/s,
    );
    expect(css).toMatch(/\.public-topbar\s*\{[^}]*left:\s*0[^}]*right:\s*0/s);
    expect(css).not.toMatch(/\.public-topbar\s*\{[^}]*background:\s*rgba\(/s);
  });
});
