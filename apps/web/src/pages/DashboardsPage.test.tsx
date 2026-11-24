import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMonthComparison, type MonthComparison, type MonthSummary } from "@color-bms/core";
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

const october: MonthSummary = {
  yearMonth: "2026-10",
  grossCents: 165000,
  feeCents: 569,
  generalExpensesCents: 27000,
  fixedExpensesCents: 27000,
  totalExpensesCents: 54000,
  balanceCents: 110431,
};

/** The server test's data: 01–18/11 against 01–18/10. */
const withPrevious = buildMonthComparison({
  today: "2026-11-18",
  current: {
    grossCents: 125000,
    feeCents: 569,
    generalExpensesCents: 4500,
    fixedExpensesCents: 18743,
  },
  previous: {
    grossCents: 115000,
    feeCents: 569,
    generalExpensesCents: 20000,
    fixedExpensesCents: 18000,
  },
  previousMonth: { summary: october, hasData: true },
});

/** First month of use: nothing in October. */
const firstMonth = buildMonthComparison({
  today: "2026-11-18",
  current: { grossCents: 120000, feeCents: 0, generalExpensesCents: 4500, fixedExpensesCents: 0 },
  previous: { grossCents: 0, feeCents: 0, generalExpensesCents: 0, fixedExpensesCents: 0 },
  previousMonth: {
    summary: {
      ...october,
      grossCents: 0,
      feeCents: 0,
      generalExpensesCents: 0,
      fixedExpensesCents: 0,
      totalExpensesCents: 0,
      balanceCents: 0,
    },
    hasData: false,
  },
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function serve(comparison: MonthComparison) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/today") return json({ date: "2026-11-18" });
      if (url === "/api/dashboards/month-comparison") return json(comparison);
      return json({ error: "not found" }, 404);
    }),
  );
}

beforeEach(() => serve(withPrevious));

afterEach(() => {
  vi.unstubAllGlobals();
});

const rowTexts = (table: HTMLElement) =>
  within(table)
    .getAllByRole("row")
    .map((row) => row.textContent?.replace(/\s+/g, " ").trim());

describe("FR-24: Dashboards › Como está este mês comparado ao anterior?", () => {
  it("FR-24: shows the four indicators, their variation (RN-11) and the full previous month", async () => {
    renderAt("/dashboards");
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboards" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Como está este mês comparado ao anterior?" }),
    ).toBeVisible();

    const table = await screen.findByRole("table", { name: "Este mês × mês anterior" });
    expect(rowTexts(table)).toEqual([
      "IndicadorEste mês01–18/11Mês anterior01–18/10VariaçãoOutubro completoreferência",
      "Entrada mensalR$ 1.250,00R$ 1.150,00+8,7%R$ 1.650,00",
      "TaxasR$ 5,69R$ 5,690,0%R$ 5,69",
      "Total de despesasR$ 232,43R$ 380,00−38,8%R$ 540,00",
      "SaldoR$ 1.011,88R$ 764,31+32,4%R$ 1.104,31",
    ]);
    expect(screen.getByText(/Mês em andamento: valores até hoje \(18\/11\/2026\)/)).toBeVisible();
    expect(screen.queryByText(/sem dados do mês anterior/)).toBeNull();
  });

  it("FR-24: draws the comparison chart (Recharts) with an accessible name", async () => {
    renderAt("/dashboards");
    expect(
      await screen.findByRole("img", {
        name: "Gráfico de barras: este mês (01–18/11) × mês anterior (01–18/10)",
      }),
    ).toBeInTheDocument();
  });

  it('FR-24: no data in the previous month → "—" with the note "sem dados do mês anterior"', async () => {
    serve(firstMonth);
    renderAt("/dashboards");
    const table = await screen.findByRole("table", { name: "Este mês × mês anterior" });
    expect(rowTexts(table).slice(1)).toEqual([
      "Entrada mensalR$ 1.200,00R$ 0,00—R$ 0,00",
      "TaxasR$ 0,00R$ 0,00—R$ 0,00",
      "Total de despesasR$ 45,00R$ 0,00—R$ 0,00",
      "SaldoR$ 1.155,00R$ 0,00—R$ 0,00",
    ]);
    expect(screen.getByText(/sem dados do mês anterior/)).toBeVisible();
  });

  it("FR-24: a negative balance is red and labelled", async () => {
    serve(
      buildMonthComparison({
        today: "2026-11-18",
        current: {
          grossCents: 10000,
          feeCents: 0,
          generalExpensesCents: 50000,
          fixedExpensesCents: 0,
        },
        previous: {
          grossCents: 20000,
          feeCents: 0,
          generalExpensesCents: 10000,
          fixedExpensesCents: 0,
        },
        previousMonth: { summary: october, hasData: true },
      }),
    );
    renderAt("/dashboards");
    const table = await screen.findByRole("table", { name: "Este mês × mês anterior" });
    const balance = within(table).getByRole("row", { name: /^Saldo/ });
    expect(balance).toHaveTextContent("-R$ 400,00");
    expect(within(balance).getByText("Saldo negativo")).toBeVisible();
  });
});
