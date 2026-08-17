import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
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
    expect(el.textContent).toMatch(/Tournaments/);
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

  it("replaces connect with username over farm id once identified", () => {
    writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
    const el = renderAt("/");
    expect(el.querySelector('[data-testid="farm-connect"]')).toBeNull();
    const connected = el.querySelector('[data-testid="farm-connected"]');
    expect(connected).not.toBeNull();
    const name = connected?.querySelector(".farm-connected-name");
    const id = connected?.querySelector(".farm-connected-id");
    expect(name?.textContent).toBe("rmr");
    expect(id?.textContent).toBe("3666918801844311");
    expect(name!.compareDocumentPosition(id!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const timer = el.querySelector(".utc-chip");
    expect(
      connected!.compareDocumentPosition(timer!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    act(() => {
      (el.querySelector('button[aria-label="Menu"]') as HTMLButtonElement).click();
    });
    const disconnect = el.querySelector('[data-testid="disconnect-farm"]');
    expect(disconnect).not.toBeNull();
    expect(disconnect?.textContent).toMatch(/Disconnect rmr/);
  });

  it("hides connect and connected chrome on /admin", () => {
    writeFarmIdentity({ farm_id: "3666918801844311", name: "rmr" });
    const el = renderAt("/admin");
    expect(el.querySelector('[data-testid="farm-connect"]')).toBeNull();
    expect(el.querySelector('[data-testid="farm-connected"]')).toBeNull();
    expect(el.querySelector('[data-testid="farm-id-input"]')).toBeNull();
    expect(el.querySelector(".utc-chip")).not.toBeNull();
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
