import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Layout } from "../components/Layout";
import { FarmSessionProvider } from "../lib/farmSession";

vi.mock("../auth/amplify", () => ({}));
vi.mock("aws-amplify/auth", () => ({
  signIn: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  confirmSignIn: vi.fn(),
}));
vi.mock("../auth/session", () => ({
  getAuthToken: vi.fn().mockResolvedValue(null),
}));

import { AdminPage } from "./AdminPage";

let root: Root;
let container: HTMLDivElement;

function renderAdmin() {
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
              <AdminPage />
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
});

describe("AdminPage", () => {
  it("reaches the login form after the session check without a hooks crash", async () => {
    const el = renderAdmin();
    await act(async () => {
      await Promise.resolve();
    });
    expect(el.textContent).toMatch(/Master admin/);
    expect(el.querySelector('button[type="submit"]')?.textContent).toMatch(/Sign in/);
  });
});
