import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMonthGeneralExpenses,
  buildMonthIncome,
  type Expense,
  type ExpenseCategory,
  type PaymentMethod,
  type SaleCategory,
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

const tabs: SaleCategory[] = [
  { id: 1, name: "Toner", order: 1, active: true },
  { id: 2, name: "Papelaria", order: 2, active: true },
];
const methods: PaymentMethod[] = [
  {
    id: 10,
    name: "Dinheiro",
    order: 1,
    active: true,
    machineUsage: "not_applicable",
    allowsInstallments: false,
  },
  {
    id: 12,
    name: "Cartão de crédito",
    order: 2,
    active: true,
    machineUsage: "required",
    allowsInstallments: true,
  },
];

/** October: Toner in cash and credit (RN-03 example, 3,79%) on the 2nd, Papelaria on the 5th. */
function income(yearMonth: string) {
  return buildMonthIncome({
    yearMonth,
    today: "2026-11-18",
    tabs,
    methods,
    rows: [
      {
        date: `${yearMonth}-02`,
        saleCategoryId: 1,
        paymentMethodId: 10,
        grossCents: 2500,
        feeCents: 0,
        netCents: 2500,
      },
      {
        date: `${yearMonth}-02`,
        saleCategoryId: 1,
        paymentMethodId: 12,
        grossCents: 15000,
        feeCents: 569,
        netCents: 14431,
      },
      {
        date: `${yearMonth}-05`,
        saleCategoryId: 2,
        paymentMethodId: 10,
        grossCents: 1000,
        feeCents: 0,
        netCents: 1000,
      },
    ],
  });
}

const categories: ExpenseCategory[] = [
  { id: 1, name: "Alimentação", order: 1, active: true, group: "general" },
  { id: 2, name: "Diversos", order: 2, active: true, group: "general" },
  { id: 9, name: "Kalunga", order: 9, active: true, group: "suppliers" },
];

function expense(id: number, categoryId: number, day: string, amountCents: number): Expense {
  const category = categories.find((c) => c.id === categoryId)!;
  return {
    id,
    type: "general",
    status: "paid",
    paymentDate: day,
    createdAt: `${day}T15:00:00.000Z`,
    expenseCategoryId: categoryId,
    expenseCategoryName: category.name,
    expenseCategoryOrder: category.order,
    description: id === 3 ? "papel A4" : null,
    amountCents,
    paymentMeans: id === 3 ? "boleto" : "cash",
    paidFromTill: id !== 3,
  };
}

function generalExpenses(yearMonth: string) {
  return buildMonthGeneralExpenses({
    yearMonth,
    categories,
    expenses: [
      expense(1, 1, `${yearMonth}-03`, 2000),
      expense(2, 1, `${yearMonth}-04`, 1500),
      expense(3, 9, `${yearMonth}-12`, 30000),
    ],
  });
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
      const match = /^\/api\/months\/(\d{4}-\d{2})\/reports\/(income|general-expenses)$/.exec(url);
      if (match) {
        const [, yearMonth, kind] = match;
        return json(kind === "income" ? income(yearMonth!) : generalExpenses(yearMonth!));
      }
      return json({ error: "not found" }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FR-20: Relatórios › Mês – Entradas", () => {
  it("FR-20: Relatórios links to both month reports", async () => {
    renderAt("/relatorios");
    expect(await screen.findByRole("link", { name: /Mês – Entradas/ })).toHaveAttribute(
      "href",
      "/relatorios/mes/entradas",
    );
    expect(screen.getByRole("link", { name: /Mês – Despesas gerais/ })).toHaveAttribute(
      "href",
      "/relatorios/mes/despesas-gerais",
    );
  });

  it("FR-20: opens on the current month, focused, and keeps the month in the address", async () => {
    renderAt("/relatorios/mes/entradas");
    const month = await screen.findByLabelText("Mês");
    expect(month).toHaveFocus();
    await waitFor(() => expect(month).toHaveValue("2026-11"));
    await waitFor(() => expect(requested).toContain("/api/months/2026-11/reports/income"));
    expect(month).toHaveAttribute("max", "2026-11");
  });

  it("FR-20: shows the days × tabs grid, the tab totals and the monthly income (RN-06)", async () => {
    renderAt("/relatorios/mes/entradas?mes=2026-10");
    const grid = await screen.findByRole("table", { name: "Entradas por dia e aba" });
    const headers = within(grid)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual(["Dia", "Toner", "Papelaria", "Total"]);

    const rows = within(grid)
      .getAllByRole("row")
      .map((row) => row.textContent?.replace(/\s+/g, " "));
    // 31 days of October, plus the header and the footer.
    expect(rows).toHaveLength(33);
    expect(rows).toContain("02/10/2026R$ 175,00—R$ 175,00");
    expect(rows).toContain("01/10/2026———");
    expect(rows).toContain("Total do mêsR$ 175,00R$ 10,00R$ 185,00");

    expect(screen.getByTestId("month-gross")).toHaveTextContent("R$ 185,00");
    expect(screen.getByTestId("month-fee")).toHaveTextContent("R$ 5,69");
    expect(screen.getByTestId("month-net")).toHaveTextContent("R$ 179,31");
  });

  it("FR-20: shows the month totals per payment method (gross, fee, net)", async () => {
    renderAt("/relatorios/mes/entradas?mes=2026-10");
    const table = await screen.findByRole("table", { name: "Totais por forma de pagamento" });
    const rows = within(table)
      .getAllByRole("row")
      .map((row) => row.textContent?.replace(/\s+/g, " "));
    expect(rows).toEqual([
      "Forma de pagamentoBrutoTaxaLíquido",
      "DinheiroR$ 35,00R$ 0,00R$ 35,00",
      "Cartão de créditoR$ 150,00R$ 5,69R$ 144,31",
      "TotalR$ 185,00R$ 5,69R$ 179,31",
    ]);
  });

  it("FR-20: links back to Relatórios; a cleared month field says what to do", async () => {
    renderAt("/relatorios/mes/entradas?mes=2026-10");
    expect(await screen.findByRole("link", { name: "← Relatórios" })).toHaveAttribute(
      "href",
      "/relatorios",
    );
    const month = await screen.findByLabelText("Mês");
    await screen.findByTestId("month-gross");
    fireEvent.change(month, { target: { value: "" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Escolha um mês válido.");
  });

  it("FR-20: choosing another month loads it", async () => {
    renderAt("/relatorios/mes/entradas?mes=2026-10");
    const month = await screen.findByLabelText("Mês");
    fireEvent.change(month, { target: { value: "2026-09" } });
    await waitFor(() => expect(requested).toContain("/api/months/2026-09/reports/income"));
    expect(await screen.findByText("02/09/2026")).toBeInTheDocument();
  });
});

describe("FR-21: Relatórios › Mês – Despesas gerais", () => {
  it("FR-21: shows each category's total, the suppliers group with its subtotal and the total geral", async () => {
    renderAt("/relatorios/mes/despesas-gerais?mes=2026-10");
    const table = await screen.findByRole("table", { name: "Despesas gerais por categoria" });
    const rows = within(table)
      .getAllByRole("row")
      .map((row) => row.textContent?.replace(/\s+/g, " "));
    expect(rows).toEqual([
      "CategoriaLançamentosTotal",
      "Alimentação2R$ 35,00",
      "Diversos0R$ 0,00",
      "Fornecedores de materiais",
      "Kalunga1R$ 300,00",
      "Subtotal Fornecedores de materiaisR$ 300,00",
      "Total geralR$ 335,00",
    ]);
    expect(screen.getByTestId("suppliers-subtotal")).toHaveTextContent("R$ 300,00");
    expect(screen.getByTestId("general-expenses-total")).toHaveTextContent("R$ 335,00");
  });

  it("FR-21: expands a category to list its entries, and collapses it again", async () => {
    renderAt("/relatorios/mes/despesas-gerais?mes=2026-10");
    const toggle = await screen.findByRole("button", { name: "Ver lançamentos de Kalunga" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // A category without entries has nothing to open.
    expect(screen.queryByRole("button", { name: /lançamentos de Diversos/ })).toBeNull();

    fireEvent.click(toggle);
    const entries = screen.getByRole("table", { name: "Lançamentos de Kalunga" });
    const rows = within(entries)
      .getAllByRole("row")
      .map((row) => row.textContent?.replace(/\s+/g, " "));
    expect(rows).toEqual([
      "DataDescriçãoMeioDo caixaValor",
      "12/10/2026papel A4BoletoNãoR$ 300,00",
    ]);
    const hide = screen.getByRole("button", { name: "Ocultar lançamentos de Kalunga" });
    expect(hide).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(hide);
    expect(screen.queryByRole("table", { name: "Lançamentos de Kalunga" })).toBeNull();
  });
});
