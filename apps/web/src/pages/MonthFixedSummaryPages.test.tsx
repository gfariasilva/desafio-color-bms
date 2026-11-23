import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMonthFixedExpensesReport,
  buildMonthSummary,
  type FixedExpense,
  type MonthSummary,
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

let nextId = 1;
function bill(label: string, fields: Partial<FixedExpense> = {}): FixedExpense {
  return {
    id: nextId++,
    referenceMonth: "2026-11",
    label,
    group: "general",
    fixedExpenseTemplateId: 1,
    oneOff: false,
    dueDate: "2026-11-10",
    expectedAmountCents: 20000,
    status: "pending",
    amountCents: null,
    paymentDate: null,
    paymentMeans: null,
    paidFromTill: false,
    installmentNumber: null,
    installmentsTotal: null,
    createdAt: "2026-11-01T12:00:00.000Z",
    ...fields,
  };
}

/** November: Luz paid (FR-12 example), October's Água paid in November, Aluguel pending, … */
const fixedReport = buildMonthFixedExpensesReport({
  yearMonth: "2026-11",
  expenses: [
    bill("Luz", {
      status: "paid",
      amountCents: 18743,
      paymentDate: "2026-11-10",
      paymentMeans: "pix",
    }),
    bill("Água", {
      referenceMonth: "2026-10",
      dueDate: "2026-10-15",
      status: "paid",
      amountCents: 6000,
      paymentDate: "2026-11-12",
      paymentMeans: "cash",
    }),
    bill("Aluguel", { dueDate: "2026-11-05", expectedAmountCents: 150000 }),
    bill("Contador", { dueDate: null, expectedAmountCents: null }),
    bill("Telefonia – Vivo fixo", {
      status: "paid",
      amountCents: 9900,
      paymentDate: "2026-12-02",
      paymentMeans: "boleto",
    }),
    bill("TFE", { group: "government_fees", status: "dismissed", expectedAmountCents: 9000 }),
    bill("DAS", {
      group: "government_fees",
      dueDate: "2026-11-20",
      status: "paid",
      amountCents: 31000,
      paymentDate: "2026-11-20",
      paymentMeans: "pix",
    }),
  ],
});

function summary(yearMonth: string, balanceNegative = false): MonthSummary {
  return buildMonthSummary({
    income: {
      yearMonth,
      total: { grossCents: 250000, feeCents: 569, netCents: 249431 },
    },
    generalExpenses: { totalCents: 34500 },
    fixedExpenses: { paidTotalCents: balanceNegative ? 300000 : 55743 },
  });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/today") return json({ date: "2026-11-18" });
      const match = /^\/api\/months\/(\d{4}-\d{2})\/reports\/(fixed-expenses|summary)$/.exec(url);
      if (match) {
        const [, yearMonth, kind] = match;
        if (kind === "fixed-expenses") return json({ ...fixedReport, yearMonth });
        return json(summary(yearMonth!, yearMonth === "2026-09"));
      }
      return json({ error: "not found" }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const rowTexts = (table: HTMLElement) =>
  within(table)
    .getAllByRole("row")
    .map((row) => row.textContent?.replace(/\s+/g, " ").trim());

describe("FR-22 / FR-23: Relatórios hub", () => {
  it("FR-22 / FR-23: Relatórios links to the fixed expenses report and the summary", async () => {
    renderAt("/relatorios");
    expect(await screen.findByRole("link", { name: /Mês – Despesas fixas/ })).toHaveAttribute(
      "href",
      "/relatorios/mes/despesas-fixas",
    );
    expect(screen.getByRole("link", { name: /Resumo mensal/ })).toHaveAttribute(
      "href",
      "/relatorios/mes/resumo",
    );
  });
});

describe("FR-22: Relatórios › Mês – Despesas fixas", () => {
  it("FR-22: lists each bill by group with due date, expected, paid, payment date and status", async () => {
    renderAt("/relatorios/mes/despesas-fixas?mes=2026-11");
    const general = await screen.findByRole("table", { name: "Gerais" });
    expect(rowTexts(general)).toEqual([
      "ContaVencimentoValor previstoValor pagoData de pagamentoSituação",
      // A bill of another month paid in this one: marked with its reference month.
      "Águaref. 10/202615/10/2026R$ 200,00R$ 60,0012/11/2026Pago",
      "Aluguel05/11/2026R$ 1.500,00——Pendente",
      "Luz10/11/2026R$ 200,00R$ 187,4310/11/2026Pago",
      // A bill of this month paid in December: listed, but counts in December (RN-09).
      "Telefonia – Vivo fixo10/11/2026R$ 200,00R$ 99,0002/12/2026 · conta em 12/2026Pago",
      "ContadorSem vencimento———Pendente",
      "Pago no mês – GeraisR$ 247,43",
      "Pendente (informativo)R$ 1.500,00",
    ]);
    const government = screen.getByRole("table", { name: "Taxas governo" });
    expect(rowTexts(government)).toEqual([
      "ContaVencimentoValor previstoValor pagoData de pagamentoSituação",
      "TFE10/11/2026R$ 90,00——Dispensado",
      "DAS20/11/2026R$ 200,00R$ 310,0020/11/2026Pago",
      "Pago no mês – Taxas governoR$ 310,00",
      "Pendente (informativo)R$ 0,00",
    ]);
  });

  it("FR-22: shows the total paid in the month (RN-09) and the pending total apart", async () => {
    renderAt("/relatorios/mes/despesas-fixas?mes=2026-11");
    expect(await screen.findByTestId("fixed-paid-total")).toHaveTextContent("R$ 557,43");
    expect(screen.getByTestId("fixed-pending-total")).toHaveTextContent("R$ 1.500,00");
    expect(
      screen.getByText(/Informativo, fora do saldo\. 1 conta sem valor previsto\./),
    ).toBeVisible();
    expect(screen.getByLabelText("Mês")).toHaveFocus();
  });
});

describe("FR-23: Relatórios › Resumo mensal", () => {
  it("FR-23: shows the six lines of the summary (RN-10)", async () => {
    renderAt("/relatorios/mes/resumo?mes=2026-10");
    expect(await screen.findByTestId("summary-gross")).toHaveTextContent("R$ 2.500,00");
    expect(screen.getByTestId("summary-fee")).toHaveTextContent("R$ 5,69");
    expect(screen.getByTestId("summary-general")).toHaveTextContent("R$ 345,00");
    expect(screen.getByTestId("summary-fixed")).toHaveTextContent("R$ 557,43");
    expect(screen.getByTestId("summary-total-expenses")).toHaveTextContent("R$ 902,43");
    expect(screen.getByTestId("summary-balance")).toHaveTextContent("R$ 1.591,88");
    expect(screen.queryByText("Saldo negativo")).toBeNull();
    expect(screen.getByText(/As sangrias não entram no saldo/)).toBeVisible();
    // A past month is complete.
    expect(screen.queryByText(/Mês em andamento/)).toBeNull();
  });

  it("FR-23: each line links to its report, for the same month", async () => {
    renderAt("/relatorios/mes/resumo?mes=2026-10");
    expect(await screen.findByRole("link", { name: "Entrada mensal (bruta)" })).toHaveAttribute(
      "href",
      "/relatorios/mes/entradas?mes=2026-10",
    );
    expect(screen.getByRole("link", { name: "(−) Total despesas gerais" })).toHaveAttribute(
      "href",
      "/relatorios/mes/despesas-gerais?mes=2026-10",
    );
    expect(screen.getByRole("link", { name: "(−) Total despesas fixas" })).toHaveAttribute(
      "href",
      "/relatorios/mes/despesas-fixas?mes=2026-10",
    );
  });

  it("RN-10: a negative balance is red and says so in words", async () => {
    renderAt("/relatorios/mes/resumo?mes=2026-09");
    expect(await screen.findByTestId("summary-balance")).toHaveTextContent("-R$ 850,69");
    expect(screen.getByText("Saldo negativo")).toBeVisible();
  });

  it("FR-23: the current month says its values run up to today", async () => {
    renderAt("/relatorios/mes/resumo");
    await waitFor(() => expect(screen.getByLabelText("Mês")).toHaveValue("2026-11"));
    expect(await screen.findByText(/Mês em andamento: valores até hoje\./)).toBeVisible();
  });
});
