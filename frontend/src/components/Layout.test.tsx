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

const identifyFarm = vi.fn();

vi.mock("../api/public", () => ({
  fetchSlogans: vi.fn().mockResolvedValue({
    slogans: [
      { text: "Slap my pets" },
      { text: "Grow my banana" },
      { text: "Squeeze my orange" },
      { text: "Clean my poop" },
      { text: "Want some weed?" },
      { text: "Erect my monument" },
    ],
    count: 6,
    today_text: null,
    today_day: null,
  }),
  identifyFarm: (...args: unknown[]) => identifyFarm(...args),
}));

vi.mock("../api/admin", () => ({
  fetchAdminSlogans: vi.fn().mockResolvedValue({
    slogans: [{ text: "Slap my pets" }],
    count: 1,
    today_text: null,
    today_day: null,
  }),
  saveSlogans: vi.fn(),
  addSlogan: vi.fn(),
  listIdentities: vi.fn().mockResolvedValue([
    { farm_id: "111", name: "Alpha" },
    { farm_id: "999", name: "Zed" },
  ]),
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
  identifyFarm.mockReset();
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

  it("uses the issue 23 shovel as the public and admin brand mark and favicon", () => {
    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const publicRoot = resolve(srcRoot, "../public");
    const shovel = readFileSync(resolve(publicRoot, "shovel.png"));
    expect(shovel.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const html = readFileSync(resolve(srcRoot, "../index.html"), "utf8");
    expect(html).toMatch(/rel="icon"[^>]*href="\/shovel\.png"/);
    expect(html).not.toMatch(/favicon\.svg/);
    expect(html).not.toMatch(/pebble/);

    const publicPage = renderAt("/");
    const publicBrand = publicPage.querySelector('[data-testid="public-brand"]');
    const publicMark = publicBrand?.querySelector(".brand-mark img");
    expect(publicMark?.getAttribute("src")).toBe("/shovel.png");
    expect(publicBrand?.querySelectorAll(".brand-mark span").length).toBe(0);
    act(() => {
      root.unmount();
    });
    container.remove();

    const adminPage = renderAt("/admin");
    const adminBrand = adminPage.querySelector('[data-testid="admin-brand"]');
    expect(adminBrand?.querySelector(".brand-mark img")?.getAttribute("src")).toBe("/shovel.png");
    expect(adminBrand?.querySelectorAll(".brand-mark span").length).toBe(0);
    expect(adminPage.querySelectorAll('button[aria-label="Menu"] span').length).toBe(3);
  });

  it("shows a small loading popup while connecting a farm and closes it when identify finishes", async () => {
    let resolveIdentify: (value: { farm_id: string; name: string }) => void = () => undefined;
    identifyFarm.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveIdentify = resolve;
        }),
    );
    const el = renderAt("/");
    const input = el.querySelector('[data-testid="farm-id-input"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "3666918801844311");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(el.querySelector('[data-testid="loading-popup"]')).toBeNull();
    act(() => {
      (el.querySelector('[data-testid="farm-id-submit"]') as HTMLButtonElement).click();
    });
    expect(el.querySelector('[data-testid="loading-popup"]')?.textContent).toMatch(
      /Connecting farm/,
    );
    await act(async () => {
      resolveIdentify({ farm_id: "3666918801844311", name: "rmr" });
      await Promise.resolve();
    });
    expect(el.querySelector('[data-testid="loading-popup"]')).toBeNull();
    expect(el.querySelector('[data-testid="farm-connected"]')).not.toBeNull();
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
    const support = el.querySelector('[data-testid="public-footer-support"]');
    expect(support).not.toBeNull();
    expect(support?.contains(el.querySelector('[data-testid="donation-wallet"]'))).toBe(true);
    expect(support?.contains(version)).toBe(true);
    const donation = support?.querySelector('[data-testid="donation-wallet"]') as HTMLElement;
    expect(
      support?.contains(donation) &&
        donation.compareDocumentPosition(version as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
    expect(slogan?.textContent).toMatch(/→\s*rmr/);
    expect(slogan?.querySelector(".slogan-arrow")).not.toBeNull();
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
      "0xad8...f2c",
    );
    expect(el.querySelector('[data-testid="donation-wallet-short"]')?.textContent).toBe(
      truncatedDonationWallet(),
    );
    expect(wallet?.textContent).not.toContain(DONATION_WALLET.slice(3, -3));
    const copyBtn = el.querySelector('[data-testid="copy-wallet"]') as HTMLButtonElement;
    expect(copyBtn.querySelector("svg")).not.toBeNull();
    expect(copyBtn.textContent).not.toMatch(/copy/i);
    expect(copyBtn.getAttribute("aria-label")).toMatch(/copy wallet address/i);
    expect(el.querySelector('[data-testid="public-footer"]')?.contains(wallet)).toBe(true);
    await act(async () => {
      copyBtn.click();
    });
    expect(writeText).toHaveBeenCalledWith(DONATION_WALLET);
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.donation-label\s*\{[^}]*font-weight:\s*700/s);
    expect(css).toMatch(/\.donation-line\s*\{[^}]*font-size:\s*14px/s);
    expect(css).toMatch(/\.public-footer-support\s*\{[^}]*align-items:\s*flex-end/s);
    expect(css).toMatch(/\.public-footer-support\s*\{[^}]*flex-direction:\s*column/s);
    expect(css).toMatch(/\.public-footer-inner\s*\{[^}]*flex-wrap:\s*nowrap/s);
    expect(css).toMatch(/\.public-footer-inner\s*\{[^}]*align-items:\s*center/s);
    expect(css).not.toMatch(/\.public-footer \.donation-line\s*\{[^}]*flex:\s*1 1 100%/s);
    expect(css).toMatch(/\.public-footer\s*\{[^}]*padding:\s*12px 18px 14px/s);
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
    expect(el.querySelector('[data-testid="admin-brand"]')?.querySelector("h1")?.textContent).toBe(
      "Bumpkin Clash: Digging",
    );
    expect(el.querySelector('[data-testid="admin-brand"]')?.querySelector("p")?.textContent).toBe(
      "Sunflower Land Digging Tournament",
    );
    expect(el.querySelector('[data-testid="public-footer"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="public-disclaimer"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="donation-wallet"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="site-version"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="operator-farm-link"]')).toBeNull();
    expect(el.querySelector('[data-testid="created-by"]')).toBeNull();
    expect(el.querySelector('[data-testid="operator-x-link"]')).toBeNull();
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

  it("matches public and admin brand title sizes", () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    const brandH1 = css.match(/\.brand h1\s*\{[^}]+\}/);
    const brandP = css.match(/\.brand p\s*\{[^}]+\}/);
    expect(brandH1?.[0]).toMatch(/font-size:\s*22px/);
    expect(brandP?.[0]).toMatch(/font-size:\s*12px/);
    expect(brandP?.[0]).toMatch(/text-transform:\s*uppercase/);
    expect(css).not.toMatch(/\.public-topbar \.brand h1\s*\{[^}]*font-size:/s);
    expect(css).not.toMatch(/\.public-topbar \.brand p\s*\{[^}]*font-size:\s*11px/s);
    expect(css).not.toMatch(/\.public-topbar \.brand p\s*\{[^}]*text-transform:\s*none/s);
    expect(css).not.toMatch(/\.admin-topbar \.brand h1\s*\{[^}]*font-size:/s);
    expect(css).not.toMatch(/\.brand p\s*\{[^}]*display:\s*none/s);
  });

  it("puts Sign out in the admin burger and the timer in the center", () => {
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
    expect(topbar?.querySelector("h1")?.textContent).toBe("Bumpkin Clash: Digging");
    expect(topbar?.querySelector("p")?.textContent).toBe("Sunflower Land Digging Tournament");
    expect(container.querySelector('[data-testid="admin-sign-out"]')).toBeNull();
    const timer = container.querySelector('[data-testid="admin-next-refresh"]');
    expect(timer).not.toBeNull();
    expect(topbar?.contains(timer)).toBe(true);
    expect(topbar?.querySelector(".topbar-tools")?.contains(timer)).toBe(false);
    expect(container.querySelector('[data-testid="public-footer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="public-disclaimer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="donation-wallet"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="site-version"]')).not.toBeNull();
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.admin-topbar-timer\s*\{[^}]*justify-self:\s*center/s);

    act(() => {
      (container.querySelector('button[aria-label="Menu"]') as HTMLButtonElement).click();
    });
    const signOut = container.querySelector('[data-testid="admin-sign-out"]');
    expect(signOut).not.toBeNull();
    expect(signOut?.textContent).toMatch(/Sign out/);
    expect(container.querySelector('[data-testid="menu-options"]')?.contains(signOut)).toBe(true);
    expect(container.querySelector(".shell")?.contains(signOut)).toBe(false);
    const slogansItem = container.querySelector('[data-testid="admin-menu-slogans"]');
    expect(slogansItem?.textContent).toMatch(/Header slogans/);
    const identitiesItem = container.querySelector('[data-testid="admin-menu-identities"]');
    expect(identitiesItem?.textContent).toMatch(/Identified farms/);
    act(() => {
      (slogansItem as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="admin-slogans-panel"]')).not.toBeNull();
  });

  it("opens Identified farms from the admin burger as a Name/ID overlay with top-right search", async () => {
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
    expect(container.querySelector('[data-testid="identified-farms-overlay"]')).toBeNull();
    expect(container.querySelector('[data-testid="admin-identities"]')).toBeNull();
    act(() => {
      (container.querySelector('button[aria-label="Menu"]') as HTMLButtonElement).click();
    });
    act(() => {
      (
        container.querySelector('[data-testid="admin-menu-identities"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    const overlay = container.querySelector('[data-testid="identified-farms-overlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelector(".kicker")?.textContent).toBe("Identified farms");
    const table = overlay?.querySelector(
      '[data-testid="identified-farms-table"]',
    ) as HTMLTableElement;
    expect([...table.querySelectorAll("th")].map((node) => node.textContent)).toEqual([
      "Name",
      "ID",
    ]);
    const search = overlay?.querySelector(
      '[data-testid="identified-farms-search"]',
    ) as HTMLInputElement;
    const head = overlay?.querySelector(".identified-farms-head");
    expect(head?.contains(search)).toBe(true);
    expect(
      search.compareDocumentPosition(overlay!.querySelector(".kicker") as Node) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "zed");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const ids = [...table.querySelectorAll("tbody tr")].map(
      (row) => row.querySelector(".farm-id")?.textContent,
    );
    expect(ids[0]).toBe("999");
  });

  it("styles the activity popup as a small card, not a full-page loader", () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    expect(css).toMatch(/\.loading-popup\s*\{[^}]*pointer-events:\s*none/s);
    expect(css).toMatch(/\.loading-popup-card\s*\{[^}]*font-size:\s*14px/s);
    expect(css).not.toMatch(/\.loading-popup\s*\{[^}]*background:\s*rgba\(/s);
    expect(css).not.toMatch(/#e8b923/);
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
