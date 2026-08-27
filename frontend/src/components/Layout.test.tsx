import { act, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FarmSessionProvider } from "../lib/farmSession";
import { writeFarmIdentity } from "../lib/followFarm";
import { SITE_VERSION } from "../siteVersion";
import { Layout, useAdminHeaderActions } from "./Layout";

function AdminDashStub() {
  const onSignOut = useCallback(() => undefined, []);
  useAdminHeaderActions({ onSignOut });
  return <main data-testid="admin-dash-stub">dashboard</main>;
}

let root: Root;
let container: HTMLDivElement;

/** Public desert frame must keep the PNG and sit a partial dusk scrim over it. */
function assertAppFrameDuskScrim(block: string) {
  expect(block).toMatch(/url\(["']?\/desert-dig-site\.png["']?\)/);
  expect(block).toMatch(/background-size:\s*cover/);
  expect(block).not.toMatch(/(?:^|{|;)\s*filter\s*:/);
  expect(block).toMatch(/linear-gradient\(/);
  const gradientAt = block.search(/linear-gradient\(/);
  const imageAt = block.search(/desert-dig-site\.png/);
  expect(gradientAt).toBeGreaterThanOrEqual(0);
  expect(imageAt).toBeGreaterThan(gradientAt);
  const mixes = [
    ...block.matchAll(/color-mix\(\s*in\s+srgb\s*,\s*var\(--bg\)\s+(\d+(?:\.\d+)?)%/g),
  ];
  expect(mixes.length).toBeGreaterThanOrEqual(1);
  for (const mix of mixes) {
    const pct = Number(mix[1]);
    expect(pct).toBe(85);
  }
}

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

  it("names the public brand, shows a version, and disclaims unofficial status", () => {
    const el = renderAt("/");
    const brand = el.querySelector('[data-testid="public-brand"]');
    expect(brand?.querySelector("h1")?.textContent).toBe("Bumpkin Clash: Digging");
    expect(brand?.querySelector("p")?.textContent).toBe("Sunflower Land Digging Tournament");
    const version = el.querySelector('[data-testid="site-version"]');
    expect(version?.textContent).toBe(`v${SITE_VERSION}`);
    expect(version?.textContent).toMatch(/^v\d+\.\d+\.\d+$/);
    const disclaimer = el.querySelector('[data-testid="public-disclaimer"]');
    expect(disclaimer?.textContent).toMatch(/unofficial/i);
    expect(disclaimer?.textContent).toMatch(/third-party/i);
    expect(disclaimer?.textContent).toMatch(/not[\s\S]*official Sunflower Land team/i);
    const footer = el.querySelector('[data-testid="public-footer"]');
    expect(footer).not.toBeNull();
    expect(footer?.contains(disclaimer)).toBe(true);
    expect(footer?.contains(version)).toBe(true);
    expect(el.querySelector(".public-shell")?.contains(footer)).toBe(false);
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
    expect(el.querySelector(".app-frame.admin-frame")).not.toBeNull();
    expect(el.querySelector('[data-testid="admin-topbar"]')).not.toBeNull();
    expect(el.querySelector(".public-shell")).toBeNull();
    expect(el.querySelector(".public-topbar")).toBeNull();
    expect(el.querySelector('[data-testid="public-brand"]')).toBeNull();
    expect(el.querySelector('[data-testid="public-footer"]')).toBeNull();
    expect(el.querySelector('[data-testid="site-version"]')).toBeNull();
    expect(el.querySelector("h1")?.textContent).toBe("SFL Digging Tournament");
    expect(el.querySelector('[data-testid="admin-sign-out"]')).toBeNull();
  });

  it("wraps public pages in the desert-backed app frame", () => {
    const el = renderAt("/");
    expect(el.querySelector(".app-frame")).not.toBeNull();
    expect(el.querySelector(".admin-frame")).toBeNull();
    expect(el.querySelector(".shell.public-shell")).not.toBeNull();
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    const appFrame = css.match(/\.app-frame\s*\{[^}]+\}/);
    expect(appFrame?.[0]).toMatch(/url\(["']?\/desert-dig-site\.png["']?\)/);
    expect(appFrame?.[0]).toMatch(/background-size:\s*cover/);
    assertAppFrameDuskScrim(appFrame![0]);
  });

  it("puts the same desert dusk scrim behind admin", () => {
    const el = renderAt("/admin");
    expect(el.querySelector(".app-frame.admin-frame")).not.toBeNull();
    expect(el.querySelector(".shell")).not.toBeNull();
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    const appFrame = css.match(/\.app-frame\s*\{[^}]+\}/);
    expect(appFrame).not.toBeNull();
    assertAppFrameDuskScrim(appFrame![0]);
    const adminFrame = css.match(/\.admin-frame\s*\{[^}]+\}/);
    expect(adminFrame).not.toBeNull();
    expect(adminFrame![0]).toMatch(/padding-top:\s*var\(--topbar-height\)/);
  });

  it("pins the admin top bar full-width and opaque like the public banner", () => {
    const el = renderAt("/admin");
    const topbar = el.querySelector('[data-testid="admin-topbar"]');
    expect(topbar).not.toBeNull();
    expect(topbar?.classList.contains("admin-topbar")).toBe(true);
    expect(el.querySelector(".shell")?.contains(topbar)).toBe(false);
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.admin-topbar\s*\{[^}]*position:\s*(sticky|fixed)[^}]*top:\s*0[^}]*width:\s*100%[^}]*background:\s*var\(--bg\)/s,
    );
    expect(css).toMatch(/\.admin-topbar\s*\{[^}]*left:\s*0[^}]*right:\s*0/s);
    expect(css).not.toMatch(/\.admin-topbar\s*\{[^}]*background:\s*rgba\(/s);
  });

  it("parks Sign out in the full-bleed admin top bar when the dashboard is open", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/admin"]}>
          <FarmSessionProvider>
            <Layout>
              <AdminDashStub />
            </Layout>
          </FarmSessionProvider>
        </MemoryRouter>,
      );
    });
    const topbar = container.querySelector('[data-testid="admin-topbar"]');
    const signOut = container.querySelector('[data-testid="admin-sign-out"]');
    expect(signOut).not.toBeNull();
    expect(signOut?.textContent).toMatch(/Sign out/);
    expect(topbar?.contains(signOut)).toBe(true);
    expect(container.querySelector(".shell")?.contains(signOut)).toBe(false);
  });

  it("keeps the dusk palette and Live badge green", () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.tourney-status\.ongoing\s*\{[^}]*color:\s*var\(--green\)/s);
    expect(css).toMatch(/\.tourney-status\.upcoming\s*\{[^}]*color:\s*var\(--amber\)/s);
    expect(css).not.toMatch(/\.tourney-status\.upcoming\s*\{[^}]*color:\s*var\(--mute\)/s);
    expect(css).toMatch(/\.tourney-status\.ended\s*\{[^}]*color:\s*var\(--mute\)/s);
    expect(css).not.toMatch(/#e8b923/);
  });

  it("does not point the browser at the SFL Community API", () => {
    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const files = [
      resolve(srcRoot, "api/client.ts"),
      resolve(srcRoot, "api/public.ts"),
      resolve(srcRoot, "api/admin.ts"),
    ];
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toMatch(/sunflower-land\.com/);
    }
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
