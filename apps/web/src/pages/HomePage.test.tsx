import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes, ROUTER_FUTURE } from "@/App";

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

let unclosed: string[];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  unclosed = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/days/unclosed")) return json({ days: unclosed });
      return json({ error: "not found" }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FR-27 (pilot slice): Início warns about days left open", () => {
  it("FR-27: lists each earlier day with movement still open, with a link to close it", async () => {
    unclosed = ["2026-11-14", "2026-11-17"];
    renderAt("/");
    const alerts = await screen.findByRole("region", { name: "Alertas" });
    expect(await within(alerts).findByText("Dia 14/11/2026 não fechado")).toBeInTheDocument();
    expect(within(alerts).getByText("Dia 17/11/2026 não fechado")).toBeInTheDocument();
    expect(within(alerts).getByRole("link", { name: "Fechar o dia 14/11/2026" })).toHaveAttribute(
      "href",
      "/fechamento?data=2026-11-14",
    );
  });

  it("FR-27: no pending day", async () => {
    renderAt("/");
    const alerts = await screen.findByRole("region", { name: "Alertas" });
    expect(
      await within(alerts).findByText("Nenhum dia anterior pendente de fechamento."),
    ).toBeInTheDocument();
  });
});
