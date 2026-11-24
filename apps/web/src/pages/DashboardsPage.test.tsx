import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildIncomeVsExpenses,
  buildMonthComparison,
  buildTabRanking,
  INITIAL_SALE_CATEGORIES,
  type IncomeVsExpenses,
  type MonthComparison,
  type MonthSummary,
  type SaleCategory,
  type TabRanking,
} from "@color-bms/core";
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

/** The RN-12 tabs (ids 1…9, display order). */
const tabs: SaleCategory[] = INITIAL_SALE_CATEGORIES.map((name, index) => ({
  id: index + 1,
  name,
  order: index + 1,
  active: true,
}));
const tabId = (name: string) => tabs.find((t) => t.name === name)!.id;

/** FR-25, the server test's data: November up to today against 01–18/10. */
const novemberRanking = buildTabRanking({
  yearMonth: "2026-11",
  today: "2026-11-18",
  tabs: [...tabs, { id: 10, name: "Xerox antiga", order: 10, active: false }],
  current: [
    { saleCategoryId: tabId("Toner"), grossCents: 70000 },
    { saleCategoryId: tabId("Papelaria"), grossCents: 50000 },
    { saleCategoryId: tabId("Chaveiro"), grossCents: 5000 },
  ],
  previous: [
    { saleCategoryId: tabId("Toner"), grossCents: 100000 },
    { saleCategoryId: tabId("Papelaria"), grossCents: 30000 },
    { saleCategoryId: 10, grossCents: 0 },
  ],
});

/** FR-25: October, a whole month, against an empty September. */
const octoberRanking = buildTabRanking({
  yearMonth: "2026-10",
  today: "2026-11-18",
  tabs,
  current: [
    { saleCategoryId: tabId("Toner"), grossCents: 100000 },
    { saleCategoryId: tabId("Papelaria"), grossCents: 30000 },
    { saleCategoryId: tabId("Chaveiro"), grossCents: 20000 },
  ],
  previous: [],
});

/** FR-26: the last 7 days. */
const week = buildIncomeVsExpenses({
  today: "2026-11-18",
  days: 7,
  income: [
    { date: "2026-11-12", cents: 10000 },
    { date: "2026-11-18", cents: 3000 },
  ],
  expenses: [{ date: "2026-11-15", cents: 4000 }],
});

/** FR-26: the last 30 days (the server test's data). */
const month30 = buildIncomeVsExpenses({
  today: "2026-11-18",
  days: 30,
  income: [
    { date: "2026-10-20", cents: 10000 },
    { date: "2026-11-03", cents: 25000 },
    { date: "2026-11-18", cents: 3000 },
  ],
  expenses: [
    { date: "2026-11-03", cents: 4000 },
    { date: "2026-11-10", cents: 18743 },
  ],
});

const fetched: string[] = [];

function serve(
  comparison: MonthComparison,
  options: {
    rankings?: Record<string, TabRanking>;
    charts?: Record<string, IncomeVsExpenses>;
  } = {},
) {
  const rankings = options.rankings ?? { "2026-11": novemberRanking, "2026-10": octoberRanking };
  const charts = options.charts ?? { "7": week, "30": month30 };
  fetched.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url === "/api/today") return json({ date: "2026-11-18" });
      if (url === "/api/dashboards/month-comparison") return json(comparison);
      const ranking = /^\/api\/dashboards\/tab-ranking\?month=(.+)$/.exec(url);
      if (ranking?.[1] && rankings[ranking[1]]) return json(rankings[ranking[1]]);
      const chart = /^\/api\/dashboards\/income-vs-expenses\?days=(\d+)$/.exec(url);
      if (chart?.[1] && charts[chart[1]]) return json(charts[chart[1]]);
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

describe("FR-25: Dashboards › Quais abas vendem mais?", () => {
  it("FR-25: tabs in decreasing order of gross income, with % of total and variation (RN-11)", async () => {
    renderAt("/dashboards");
    expect(await screen.findByRole("heading", { name: "Quais abas vendem mais?" })).toBeVisible();
    // The month starts on the server's current month, without stealing the page's focus.
    expect(await screen.findByLabelText("Mês")).toHaveValue("2026-11");
    expect(screen.getByLabelText("Mês")).not.toHaveFocus();

    const table = await screen.findByRole("table", { name: "Ranking das abas" });
    const rows = rowTexts(table);
    expect(rows[0]).toBe("#AbaEntrada bruta01–18/11% do totalMês anterior01–18/10Variação");
    expect(rows.slice(1, 4)).toEqual([
      "1TonerR$ 700,0056,0%R$ 1.000,00−30,0%",
      "2PapelariaR$ 500,0040,0%R$ 300,00+66,7%",
      "3ChaveiroR$ 50,004,0%R$ 0,00—",
    ]);
    // Every active tab (9) plus the inactive one that had a row, then the total.
    expect(rows).toHaveLength(12);
    expect(rows.at(-2)).toBe("10Xerox antigaInativaR$ 0,000,0%R$ 0,00—");
    expect(rows.at(-1)).toBe("TotalR$ 1.250,00100,0%R$ 1.300,00−3,8%");
    expect(
      screen.getByText(
        /Novembro até hoje \(18\/11\/2026\), comparado com os mesmos dias de outubro/,
      ),
    ).toBeVisible();
    expect(screen.getByText(/não vendeu nada nesses dias do mês anterior/)).toBeVisible();
    expect(screen.getByText(/maior faturamento \(entrada bruta\), não lucro/)).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: "Gráfico de barras: entrada bruta por aba, novembro de 2026",
      }),
    ).toBeInTheDocument();
  });

  it("FR-25: choosing another month ranks that month, compared whole with the previous one", async () => {
    renderAt("/dashboards");
    const field = await screen.findByLabelText("Mês");
    await screen.findByRole("table", { name: "Ranking das abas" });
    fireEvent.change(field, { target: { value: "2026-10" } });

    expect(
      await screen.findByText(/Outubro completo, comparado com setembro de 2026 completo/),
    ).toBeVisible();
    const table = screen.getByRole("table", { name: "Ranking das abas" });
    expect(rowTexts(table)[0]).toBe(
      "#AbaEntrada bruta01–31/10% do totalMês anterior01–30/09Variação",
    );
    expect(rowTexts(table)[1]).toBe("1TonerR$ 1.000,0066,7%R$ 0,00—");
    expect(screen.getByText(/sem vendas no mês anterior/)).toBeVisible();
    expect(fetched).toContain("/api/dashboards/tab-ranking?month=2026-10");
  });

  it("FR-25: a link with ?mes= opens that month", async () => {
    renderAt("/dashboards?mes=2026-10");
    expect(await screen.findByLabelText("Mês")).toHaveValue("2026-10");
    expect(await screen.findByText(/Outubro completo/)).toBeVisible();
  });
});

describe("FR-26: Dashboards › Estou ganhando mais do que gasto?", () => {
  const figure = (testId: string) => screen.getByTestId(testId).textContent?.replace(/\s+/g, " ");

  it("FR-26: the last 7 days by default, with the period totals and the difference", async () => {
    renderAt("/dashboards");
    expect(
      await screen.findByRole("heading", { name: "Estou ganhando mais do que gasto?" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Período")).toHaveValue("7");
    await screen.findByTestId("period-income");
    expect(figure("period-income")).toBe("R$ 130,00");
    expect(figure("period-expenses")).toBe("R$ 40,00");
    expect(figure("period-difference")).toBe("R$ 90,00");
    expect(
      screen.getByRole("img", {
        name: "Gráfico de barras por dia: entradas brutas × despesas, 12/11 a 18/11",
      }),
    ).toBeInTheDocument();

    // The day table (accessible numbers): every day, zero days included, then the total.
    const table = screen.getByRole("table", { name: "Entradas × despesas por dia" });
    const rows = rowTexts(table);
    expect(rows).toHaveLength(1 + 7 + 1);
    expect(rows[1]).toBe("12/11/2026R$ 100,00R$ 0,00R$ 100,00");
    expect(rows[2]).toBe("13/11/2026R$ 0,00R$ 0,00R$ 0,00");
    expect(rows.at(-1)).toBe("TotalR$ 130,00R$ 40,00R$ 90,00");
  });

  it('FR-26: choosing "30 dias" shows 30 days, and the totals match the sum of the bars', async () => {
    renderAt("/dashboards");
    const select = await screen.findByLabelText("Período");
    fireEvent.change(select, { target: { value: "30" } });

    expect(
      await screen.findByRole("img", {
        name: "Gráfico de barras por dia: entradas brutas × despesas, 20/10 a 18/11",
      }),
    ).toBeInTheDocument();
    expect(figure("period-income")).toBe("R$ 380,00");
    expect(figure("period-expenses")).toBe("R$ 227,43");
    expect(figure("period-difference")).toBe("R$ 152,57");
    const rows = rowTexts(screen.getByRole("table", { name: "Entradas × despesas por dia" }));
    expect(rows).toHaveLength(1 + 30 + 1);
    expect(rows.at(-1)).toBe("TotalR$ 380,00R$ 227,43R$ 152,57");
    expect(fetched).toContain("/api/dashboards/income-vs-expenses?days=30");
  });

  it("FR-26: spending more than earning is red and labelled", async () => {
    serve(withPrevious, {
      charts: {
        "7": buildIncomeVsExpenses({
          today: "2026-11-18",
          days: 7,
          income: [{ date: "2026-11-18", cents: 1000 }],
          expenses: [{ date: "2026-11-17", cents: 5000 }],
        }),
      },
    });
    renderAt("/dashboards");
    const difference = await screen.findByTestId("period-difference");
    expect(difference).toHaveTextContent("-R$ 40,00");
    expect(difference).toHaveClass("text-destructive");
    expect(screen.getByText("Gastou mais do que entrou")).toBeVisible();
  });
});
