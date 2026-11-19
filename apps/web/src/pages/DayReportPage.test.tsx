import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DayReportResponse } from "@color-bms/core";
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

const zero = { grossCents: 0, feeCents: 0, netCents: 0 };

/** 18/11/2026: Toner in cash and credit (3,79% fee), a general and a fixed expense, a sangria. */
function report(date: string, closed: boolean): DayReportResponse {
  return {
    date,
    status: closed ? "closed" : "open",
    hasMovement: true,
    matrix: {
      methods: [
        { paymentMethodId: 1, name: "Dinheiro", active: true },
        { paymentMethodId: 2, name: "Cartão de crédito", active: true },
      ],
      tabs: [
        {
          saleCategoryId: 1,
          name: "Toner",
          order: 1,
          active: true,
          hasSales: true,
          cells: [
            { grossCents: 2500, feeCents: 0, netCents: 2500 },
            { grossCents: 15000, feeCents: 569, netCents: 14431 },
          ],
          total: { grossCents: 17500, feeCents: 569, netCents: 16931 },
        },
        {
          saleCategoryId: 2,
          name: "Papelaria",
          order: 2,
          active: true,
          hasSales: false,
          cells: [zero, zero],
          total: zero,
        },
      ],
      methodTotals: [
        { grossCents: 2500, feeCents: 0, netCents: 2500 },
        { grossCents: 15000, feeCents: 569, netCents: 14431 },
      ],
      total: { grossCents: 17500, feeCents: 569, netCents: 16931 },
    },
    expenses: [
      {
        id: 1,
        type: "general",
        status: "paid",
        paymentDate: date,
        createdAt: "2026-11-18T13:00:00.000Z",
        expenseCategoryId: 6,
        expenseCategoryName: "Abastecimento moto",
        expenseCategoryOrder: 6,
        description: "gasolina",
        amountCents: 4500,
        paymentMeans: "cash",
        paidFromTill: true,
      },
    ],
    fixedExpenses: [
      {
        id: 9,
        referenceMonth: "2026-11",
        label: "Luz",
        group: "general",
        fixedExpenseTemplateId: 1,
        oneOff: false,
        dueDate: "2026-11-10",
        expectedAmountCents: 20000,
        status: "paid",
        amountCents: 12000,
        paymentDate: date,
        paymentMeans: "pix",
        paidFromTill: false,
        installmentNumber: null,
        installmentsTotal: null,
        createdAt: "2026-11-01T03:00:00.000Z",
      },
    ],
    expensesTotalCents: 16500,
    paidFromTillCents: 4500,
    withdrawals: [
      {
        id: 3,
        date,
        createdAt: "2026-11-18T17:00:00.000Z",
        amountCents: 30000,
        note: "depósito no banco",
      },
    ],
    withdrawalsTotalCents: 30000,
    cash: { cashSalesCents: 2500, tillExpensesCents: 4500, withdrawalsCents: 30000 },
    closing: closed
      ? {
          openingCashCents: 50000,
          expectedCashCents: 18000,
          countedCashCents: 17500,
          differenceCents: -500,
          note: null,
          closedAt: "2026-11-18T22:00:00.000Z",
        }
      : null,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let requested: string[];

beforeEach(() => {
  requested = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url === "/api/today") return json({ date: "2026-11-18" });
      const match = /^\/api\/days\/(\d{4}-\d{2}-\d{2})\/report$/.exec(url);
      if (match) return json(report(match[1]!, match[1] === "2026-11-18"));
      return json({ error: "not found" }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FR-19: Relatórios › Dia", () => {
  it("FR-19: Relatórios links to the day report", async () => {
    renderAt("/relatorios");
    expect(await screen.findByRole("link", { name: /Relatório do dia/ })).toHaveAttribute(
      "href",
      "/relatorios/dia",
    );
  });

  it("FR-19: opens on today with the tab × method matrix (gross, fee, net) and the totals", async () => {
    renderAt("/relatorios/dia");
    const date = await screen.findByLabelText("Data");
    expect(date).toHaveFocus();
    await waitFor(() => expect(date).toHaveValue("2026-11-18"));

    const matrix = await screen.findByRole("table", { name: "Matriz aba × forma de pagamento" });
    const headers = within(matrix)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual(["Aba", "Valor", "Dinheiro", "Cartão de crédito", "Total"]);

    const toner = within(matrix).getByRole("rowheader", { name: /Toner/ });
    expect(toner).toBeInTheDocument();
    const rows = within(matrix).getAllByRole("row");
    const text = rows.map((row) => row.textContent?.replace(/\s+/g, " "));
    expect(text).toContain("TonerBrutoR$ 25,00R$ 150,00R$ 175,00");
    expect(text).toContain("TaxaR$ 0,00R$ 5,69R$ 5,69");
    expect(text).toContain("LíquidoR$ 25,00R$ 144,31R$ 169,31");
    // A tab without sales is one dimmed row.
    expect(text).toContain("PapelariaSem vendas———");
    expect(screen.getByTestId("day-total-gross")).toHaveTextContent("R$ 175,00");
    expect(screen.getByTestId("day-total-fee")).toHaveTextContent("R$ 5,69");
    expect(screen.getByTestId("day-total-net")).toHaveTextContent("R$ 169,31");
  });

  it("FR-19: lists the day's expenses, fixed ones included, and the sangrias", async () => {
    renderAt("/relatorios/dia");
    const expenses = await screen.findByRole("table", { name: "Saídas do dia" });
    expect(within(expenses).getByText("Abastecimento moto")).toBeInTheDocument();
    expect(within(expenses).getByText("gasolina")).toBeInTheDocument();
    expect(within(expenses).getByText("Despesa fixa")).toBeInTheDocument();
    expect(within(expenses).getByText("Luz")).toBeInTheDocument();
    expect(screen.getByTestId("expenses-total")).toHaveTextContent("R$ 165,00");
    expect(screen.getByTestId("expenses-from-till")).toHaveTextContent("R$ 45,00");

    const withdrawals = screen.getByRole("table", { name: "Sangrias do dia" });
    expect(within(withdrawals).getByText("depósito no banco")).toBeInTheDocument();
    expect(screen.getByTestId("withdrawals-total")).toHaveTextContent("R$ 300,00");
  });

  it("FR-19: a closed day shows its cash closing (RN-07)", async () => {
    renderAt("/relatorios/dia");
    expect(await screen.findByText("Dia fechado")).toBeInTheDocument();
    expect(screen.getByTestId("opening-cash")).toHaveTextContent("R$ 500,00");
    expect(screen.getByTestId("expected-cash")).toHaveTextContent("R$ 180,00");
    expect(screen.getByTestId("counted-cash")).toHaveTextContent("R$ 175,00");
    expect(screen.getByTestId("difference")).toHaveTextContent("Falta de R$ 5,00");
  });

  it("FR-19: another date from the link; an open day has no closing yet", async () => {
    renderAt("/relatorios/dia?data=2026-11-17");
    expect(await screen.findByText("Dia aberto")).toBeInTheDocument();
    expect(screen.getByLabelText("Data")).toHaveValue("2026-11-17");
    expect(requested).toContain("/api/days/2026-11-17/report");
    expect(screen.getByRole("link", { name: "Fechar o dia 17/11/2026" })).toHaveAttribute(
      "href",
      "/fechamento?data=2026-11-17",
    );
    expect(screen.queryByTestId("counted-cash")).not.toBeInTheDocument();

    // Typing another date loads it.
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-11-18" } });
    expect(await screen.findByText("Dia fechado")).toBeInTheDocument();
  });
});
