import { act, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FarmSessionProvider } from "../lib/farmSession";
import { writeFarmIdentity } from "../lib/followFarm";
import {
  DONATION_WALLET,
  OPERATOR_FARM_ID,
  OPERATOR_FARM_NAME,
  OPERATOR_FARM_URL,
  OPERATOR_X_URL,
  truncatedDonationWallet,
} from "../lib/operator";
import { pickDailySlogan, SEED_SLOGANS } from "../lib/slogans";
import { SITE_VERSION } from "../siteVersion";
import { Layout, useAdminHeaderActions } from "./Layout";

vi.mock("../api/public", () => ({
  fetchSlogans: vi.fn().mockResolvedValue({
    slogans: [
      { text: "Slap my pets", icon: "hand" },
      { text: "Grow my banana", icon: "banana" },
      { text: "Squeeze my orange", icon: "orange" },
      { text: "Clean my poop", icon: "poop" },
      { text: "Want some weed?", icon: "smiley" },
      { text: "Erect my monument", icon: "statue" },
    ],
    count: 6,
  }),
}));

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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider client={client}>
          <FarmSessionProvider>
            <Layout>
              <main>page-body</main>
            </Layout>
          </FarmSessionProvider>
        </QueryClientProvider>
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
  vi.unstubAllGlobals();
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

  it("links the operator farm top-right and shows the donation wallet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const el = renderAt("/");
    await act(async () => {
      await Promise.resolve();
    });
    const header = el.querySelector(".public-topbar");
    const farmLink = el.querySelector('[data-testid="operator-farm-link"]');
    const slogan = el.querySelector('[data-testid="daily-slogan"]');
    const picked = pickDailySlogan(SEED_SLOGANS, new Date());
    expect(farmLink).not.toBeNull();
    expect(header?.contains(farmLink)).toBe(true);
    expect(farmLink?.getAttribute("href")).toBe(OPERATOR_FARM_URL);
    expect(farmLink?.getAttribute("href")).toContain(OPERATOR_FARM_ID);
    expect(farmLink?.getAttribute("href")).toMatch(/sunflower-land\.com\/play\/#\/visit\//);
    expect(farmLink?.getAttribute("href")).not.toMatch(/sfl\.world/);
    expect(farmLink?.textContent).toBe(OPERATOR_FARM_NAME);
    expect(slogan?.textContent).toContain(picked?.text ?? "");
    expect(slogan?.textContent).toMatch(/:\s*rmr/);
    const created = el.querySelector('[data-testid="created-by"]');
    expect(created?.textContent).toMatch(/Created by/);
    expect(created?.querySelector("strong")?.textContent).toBe(OPERATOR_FARM_NAME);
    const xLink = el.querySelector('[data-testid="operator-x-link"]');
    expect(xLink?.getAttribute("href")).toBe(OPERATOR_X_URL);
    expect(xLink?.querySelector("svg")).not.toBeNull();
    expect(header?.contains(created)).toBe(true);
    const wallet = el.querySelector('[data-testid="donation-wallet"]');
    const label = wallet?.querySelector(".donation-label");
    expect(label?.tagName).toBe("STRONG");
    expect(label?.textContent).toBe("Support the tournaments:");
    expect(el.querySelector('[data-testid="donation-wallet-short"]')?.textContent).toBe(
      truncatedDonationWallet(),
    );
    expect(wallet?.textContent).not.toContain(DONATION_WALLET.replace("0xad89dD", ""));
    expect(el.querySelector('[data-testid="public-footer"]')?.contains(wallet)).toBe(true);
    await act(async () => {
      (el.querySelector('[data-testid="copy-wallet"]') as HTMLButtonElement).click();
    });
    expect(writeText).toHaveBeenCalledWith(DONATION_WALLET);
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.donation-label\s*\{[^}]*font-weight:\s*700/s);
    expect(css).toMatch(/\.donation-line\s*\{[^}]*font-size:\s*14px/s);
    vi.unstubAllGlobals();
  });

  it("puts the connect field on the right when no farm is connected", () => {
    const el = renderAt("/");
    const header = el.querySelector(".public-topbar");
    const connect = header?.querySelector('[data-testid="farm-connect"]');
    const input = header?.querySelector('[data-testid="farm-id-input"]');
    const submit = header?.querySelector('[data-testid="farm-id-submit"]');
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
    const header = el.querySelector(".public-topbar");
    expect(header?.querySelector('[data-testid="farm-connect"]')).toBeNull();
    const connected = el.querySelector('[data-testid="farm-connected"]');
    expect(connected).not.toBeNull();
    expect(header?.contains(connected)).toBe(true);
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <QueryClientProvider client={client}>
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
          </QueryClientProvider>
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
    expect(el.querySelector('[data-testid="operator-farm-link"]')).toBeNull();
    expect(el.querySelector('[data-testid="created-by"]')).toBeNull();
    expect(el.querySelector('[data-testid="operator-x-link"]')).toBeNull();
    expect(el.querySelector('[data-testid="donation-wallet"]')).toBeNull();
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/admin"]}>
          <QueryClientProvider client={client}>
            <FarmSessionProvider>
              <Layout>
                <AdminDashStub />
              </Layout>
            </FarmSessionProvider>
          </QueryClientProvider>
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
