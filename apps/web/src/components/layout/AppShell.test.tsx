import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes, ROUTER_FUTURE } from "@/App";
import { NAV_ITEMS } from "@/config/navigation";

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const healthBody = {
  status: "ok",
  version: "0.1.0",
  serverTime: "2026-11-18T22:03:00.000Z",
  db: { sqliteVersion: "3.50.0", journalMode: "wal", settingsCount: 0 },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(healthBody), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AppShell", () => {
  it("shows the 9 main areas from spec §4 in the sidebar", () => {
    renderAt("/");
    const nav = screen.getByRole("navigation", { name: "Navegação principal" });
    for (const item of NAV_ITEMS) {
      expect(nav).toHaveTextContent(item.label);
    }
    expect(screen.getAllByRole("link")).toHaveLength(9);
  });

  it("shows the system status from /api/health on Início", async () => {
    renderAt("/");
    expect(await screen.findByText("Conectado")).toBeInTheDocument();
    expect(screen.getByText("18/11/2026 19:03")).toBeInTheDocument();
  });

  it("navigates when a sidebar link is clicked", () => {
    renderAt("/");
    fireEvent.click(screen.getByRole("link", { name: /Despesas fixas/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Despesas fixas" })).toBeInTheDocument();
  });

  it("opens Vendas with Alt+2 (NFR-05: keyboard-first)", () => {
    renderAt("/");
    fireEvent.keyDown(window, { code: "Digit2", key: "2", altKey: true });
    expect(screen.getByRole("heading", { level: 1, name: "Vendas" })).toBeInTheDocument();
    expect(screen.getByText(/Em construção/)).toBeInTheDocument();
  });

  it("ignores Ctrl+Alt+2 so browser/OS shortcuts keep working", () => {
    renderAt("/");
    fireEvent.keyDown(window, { code: "Digit2", key: "2", altKey: true, ctrlKey: true });
    expect(screen.getByRole("heading", { level: 1, name: "Início" })).toBeInTheDocument();
  });
});
