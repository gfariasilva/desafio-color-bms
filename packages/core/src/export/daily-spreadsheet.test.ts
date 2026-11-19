import { describe, expect, it } from "vitest";
import type { SaleCategory } from "../catalog/categories";
import type { Expense } from "../expenses/expenses";
import type { FixedExpense } from "../fixed-expenses/fixed-expenses";
import type { PaymentMethod } from "../payments/payment-methods";
import { buildDayMatrix, type DayReportResponse } from "../reports/day-report";
import { summarizeDaySales } from "../sales/day-summary";
import type { Sale } from "../sales/sales";
import { buildDailySpreadsheet } from "./daily-spreadsheet";
import type { SpreadsheetCell, SpreadsheetRow, SpreadsheetSheet } from "./spreadsheet-model";

const DATE = "2026-11-18";

const tabs: SaleCategory[] = [
  { id: 1, name: "Toner", order: 1, active: true },
  { id: 2, name: "Papelaria", order: 2, active: true },
  { id: 3, name: "Xerox", order: 3, active: true },
];

function method(id: number, name: string, order: number): PaymentMethod {
  return { id, name, order, active: true, machineUsage: "optional", allowsInstallments: true };
}

const methods: PaymentMethod[] = [
  method(10, "Dinheiro", 1),
  method(11, "Cartão de débito", 2),
  method(12, "Cartão de crédito", 3),
];

let nextId = 1;
function sale(overrides: Partial<Sale> & Pick<Sale, "saleCategoryId" | "paymentMethodId">): Sale {
  const grossCents = overrides.grossCents ?? 1000;
  const feeCents = overrides.feeCents ?? 0;
  return {
    id: nextId++,
    date: DATE,
    // 13:05 UTC = 10:05 in São Paulo.
    createdAt: "2026-11-18T13:05:00.000Z",
    type: "sale",
    saleCategoryName: tabs.find((tab) => tab.id === overrides.saleCategoryId)!.name,
    paymentMethodName: methods.find((m) => m.id === overrides.paymentMethodId)!.name,
    cardMachineId: null,
    cardMachineName: null,
    installments: null,
    feeRatePpm: 0,
    netCents: grossCents - feeCents,
    note: null,
    originalSaleId: null,
    originalSaleDate: null,
    reason: null,
    refundedCents: 0,
    ...overrides,
    grossCents,
    feeCents,
  };
}

// RN-03 example: R$ 150,00 at 3,79% → fee R$ 5,69, net R$ 144,31.
const sales: Sale[] = [
  sale({ saleCategoryId: 1, paymentMethodId: 10, grossCents: 2500, note: "Cartucho HP" }),
  sale({
    saleCategoryId: 1,
    paymentMethodId: 12,
    createdAt: "2026-11-18T22:03:00.000Z",
    cardMachineId: 1,
    cardMachineName: "PagSeguro",
    installments: 3,
    grossCents: 15000,
    feeRatePpm: 37900,
    feeCents: 569,
  }),
  sale({ saleCategoryId: 1, paymentMethodId: 10, grossCents: 1000 }),
  // A refund of an earlier sale (FR-04): a negative row on today's date.
  sale({
    saleCategoryId: 2,
    paymentMethodId: 11,
    type: "refund",
    grossCents: -4000,
    feeRatePpm: 19900,
    feeCents: -80,
    cardMachineId: 2,
    cardMachineName: "Mercado Pago",
    originalSaleId: 99,
    originalSaleDate: "2026-11-10",
    reason: "Produto com defeito",
  }),
];

const generalExpense: Expense = {
  id: 1,
  type: "general",
  status: "paid",
  paymentDate: DATE,
  createdAt: "2026-11-18T15:00:00.000Z",
  expenseCategoryId: 3,
  expenseCategoryName: "Alimentação",
  expenseCategoryOrder: 3,
  description: "Lanche",
  amountCents: 1850,
  paymentMeans: "cash",
  paidFromTill: true,
};

const fixedExpense: FixedExpense = {
  id: 2,
  referenceMonth: "2026-11",
  label: "Empréstimo Banco X",
  group: "general",
  fixedExpenseTemplateId: 7,
  oneOff: false,
  dueDate: "2026-11-20",
  expectedAmountCents: 50000,
  status: "paid",
  amountCents: 50000,
  paymentDate: DATE,
  paymentMeans: "bank_transfer",
  paidFromTill: false,
  installmentNumber: 4,
  installmentsTotal: 12,
  createdAt: "2026-11-01T03:00:00.000Z",
};

function makeReport(): {
  report: DayReportResponse;
  salesTabs: ReturnType<typeof summarizeDaySales>["tabs"];
} {
  const summary = summarizeDaySales({ tabs, methods, sales });
  const report: DayReportResponse = {
    date: DATE,
    status: "closed",
    hasMovement: true,
    matrix: buildDayMatrix({ tabs, methods, sales }),
    expenses: [generalExpense],
    fixedExpenses: [fixedExpense],
    expensesTotalCents: 51850,
    paidFromTillCents: 1850,
    withdrawals: [
      {
        id: 1,
        date: DATE,
        createdAt: "2026-11-18T20:30:00.000Z",
        amountCents: 20000,
        note: "Banco",
      },
    ],
    withdrawalsTotalCents: 20000,
    cash: { cashSalesCents: 3500, tillExpensesCents: 1850, withdrawalsCents: 20000 },
    closing: {
      openingCashCents: 30000,
      expectedCashCents: 11650,
      countedCashCents: 11600,
      differenceCents: -50,
      note: "Faltou troco",
      closedAt: "2026-11-18T22:30:00.000Z",
    },
  };
  return { report, salesTabs: summary.tabs };
}

function sheet(sheets: SpreadsheetSheet[], name: string): SpreadsheetSheet {
  const found = sheets.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No sheet "${name}" in ${sheets.map((s) => s.name).join(", ")}`);
  return found;
}

/** The first row whose first cell is the text `label`. */
function row(target: SpreadsheetSheet, label: string): SpreadsheetRow {
  const found = target.rows.find((candidate) => textOf(candidate.cells[0]) === label);
  if (!found) throw new Error(`No row "${label}" in sheet "${target.name}"`);
  return found;
}

function textOf(cell: SpreadsheetCell | undefined): string | null {
  return cell && cell.kind === "text" ? cell.value : null;
}

/** The cents in a row, in column order (other cells skipped). */
function centsOf(target: SpreadsheetRow): number[] {
  return target.cells.flatMap((cell) => (cell?.kind === "cents" ? [cell.value] : []));
}

describe("FR-28: the daily spreadsheet layout (spec §7.3)", () => {
  it("FR-28: one sheet per tab with movement, then Saídas and Resumo do dia", () => {
    const { report, salesTabs } = makeReport();
    const model = buildDailySpreadsheet(report, salesTabs);
    // Xerox has no movement: no sheet.
    expect(model.sheets.map((s) => s.name)).toEqual([
      "Toner",
      "Papelaria",
      "Saídas",
      "Resumo do dia",
    ]);
  });

  it("FR-28: a tab sheet lists hora, tipo, forma, maquininha, parcelas, cheio, taxa %, taxa R$, real, observação", () => {
    const { report, salesTabs } = makeReport();
    const toner = sheet(buildDailySpreadsheet(report, salesTabs).sheets, "Toner");
    const header = toner.rows.find((r) => r.style === "header")!;
    expect(header.cells.map(textOf)).toEqual([
      "Hora",
      "Tipo",
      "Forma",
      "Maquininha",
      "Parcelas",
      "Valor cheio",
      "Taxa %",
      "Taxa R$",
      "Valor real",
      "Observação",
    ]);
    const credit = toner.rows.find((r) => textOf(r.cells[0]) === "19:03")!;
    expect(credit.cells).toEqual([
      { kind: "text", value: "19:03" },
      { kind: "text", value: "Venda" },
      { kind: "text", value: "Cartão de crédito" },
      { kind: "text", value: "PagSeguro" },
      { kind: "integer", value: 3 },
      { kind: "cents", value: 15000 },
      { kind: "rate", ppm: 37900 },
      { kind: "cents", value: 569 },
      { kind: "cents", value: 14431 },
      { kind: "text", value: "" },
    ]);
    const cash = toner.rows.find((r) => textOf(r.cells[9]) === "Cartucho HP")!;
    expect(cash.cells[0]).toEqual({ kind: "text", value: "10:05" });
    // No machine and no installments: empty cells.
    expect(cash.cells[3]).toEqual({ kind: "text", value: "" });
    expect(cash.cells[4]).toBeNull();
  });

  it("FR-28: refunds are negative rows of type Estorno, with the sale date and the reason", () => {
    const { report, salesTabs } = makeReport();
    const papelaria = sheet(buildDailySpreadsheet(report, salesTabs).sheets, "Papelaria");
    const refund = papelaria.rows.find((r) => textOf(r.cells[1]) === "Estorno")!;
    expect(centsOf(refund)).toEqual([-4000, -80, -3920]);
    expect(textOf(refund.cells[9])).toBe(
      "Estorno da venda de 10/11/2026 · Motivo: Produto com defeito",
    );
  });

  it("FR-28: a tab sheet ends with a subtotal per payment method and the tab total (RN-05)", () => {
    const { report, salesTabs } = makeReport();
    const toner = sheet(buildDailySpreadsheet(report, salesTabs).sheets, "Toner");
    expect(centsOf(row(toner, "Dinheiro"))).toEqual([3500, 0, 3500]);
    expect(centsOf(row(toner, "Cartão de crédito"))).toEqual([15000, 569, 14431]);
    const total = row(toner, "Total da aba");
    expect(total.style).toBe("total");
    expect(centsOf(total)).toEqual([18500, 569, 17931]);
  });

  it("FR-28: Saídas lists the day's general and fixed expenses, their total, and the sangrias", () => {
    const { report, salesTabs } = makeReport();
    const saidas = sheet(buildDailySpreadsheet(report, salesTabs).sheets, "Saídas");
    expect(row(saidas, "Alimentação").cells).toEqual([
      { kind: "text", value: "Alimentação" },
      { kind: "text", value: "Lanche" },
      { kind: "text", value: "Dinheiro" },
      { kind: "text", value: "Sim" },
      { kind: "cents", value: 1850 },
    ]);
    expect(row(saidas, "Despesa fixa").cells).toEqual([
      { kind: "text", value: "Despesa fixa" },
      { kind: "text", value: "Empréstimo Banco X (parcela 4/12)" },
      { kind: "text", value: "Transferência/Débito em conta" },
      { kind: "text", value: "Não" },
      { kind: "cents", value: 50000 },
    ]);
    expect(centsOf(row(saidas, "Total das despesas"))).toEqual([51850]);
    expect(centsOf(row(saidas, "Pagas com dinheiro do caixa"))).toEqual([1850]);
    const withdrawal = row(saidas, "17:30");
    expect(textOf(withdrawal.cells[1])).toBe("Banco");
    expect(centsOf(withdrawal)).toEqual([20000]);
    expect(centsOf(row(saidas, "Total das sangrias"))).toEqual([20000]);
  });

  it("FR-28: Saídas says so when the day has no expense or sangria", () => {
    const { report, salesTabs } = makeReport();
    const empty = {
      ...report,
      expenses: [],
      fixedExpenses: [],
      expensesTotalCents: 0,
      paidFromTillCents: 0,
      withdrawals: [],
      withdrawalsTotalCents: 0,
    };
    const saidas = sheet(buildDailySpreadsheet(empty, salesTabs).sheets, "Saídas");
    expect(row(saidas, "Nenhuma despesa no dia.")).toBeDefined();
    expect(row(saidas, "Nenhuma sangria no dia.")).toBeDefined();
    expect(centsOf(row(saidas, "Total das despesas"))).toEqual([0]);
  });

  it("FR-28: Resumo do dia has the tab × method matrix, the day total and the cash closing", () => {
    const { report, salesTabs } = makeReport();
    const resumo = sheet(buildDailySpreadsheet(report, salesTabs).sheets, "Resumo do dia");
    expect(resumo.rows[0]!.cells).toEqual([
      { kind: "text", value: "Resumo do dia" },
      { kind: "date", value: DATE },
    ]);
    // Header: one group of 3 columns (cheio, taxa, real) per method, then the total.
    const [methodHeader, valueHeader] = resumo.rows.filter((r) => r.style === "header");
    expect(methodHeader!.cells.map(textOf)).toEqual([
      "Aba",
      "Dinheiro",
      null,
      null,
      "Cartão de débito",
      null,
      null,
      "Cartão de crédito",
      null,
      null,
      "Total",
      null,
      null,
    ]);
    expect(valueHeader!.cells.slice(1, 4).map(textOf)).toEqual([
      "Valor cheio",
      "Taxa",
      "Valor real",
    ]);
    // Every active tab is listed, as on the screen (FR-19), even with no sales.
    expect(centsOf(row(resumo, "Xerox"))).toEqual(Array(12).fill(0));
    expect(centsOf(row(resumo, "Toner"))).toEqual([
      3500, 0, 3500, 0, 0, 0, 15000, 569, 14431, 18500, 569, 17931,
    ]);
    expect(centsOf(row(resumo, "Total do dia"))).toEqual([
      3500, 0, 3500, -4000, -80, -3920, 15000, 569, 14431, 14500, 489, 14011,
    ]);
    expect(centsOf(row(resumo, "Troco inicial"))).toEqual([30000]);
    expect(centsOf(row(resumo, "(+) Vendas em dinheiro"))).toEqual([3500]);
    expect(centsOf(row(resumo, "(−) Despesas pagas do caixa"))).toEqual([1850]);
    expect(centsOf(row(resumo, "(−) Sangrias"))).toEqual([20000]);
    expect(centsOf(row(resumo, "Dinheiro esperado"))).toEqual([11650]);
    expect(centsOf(row(resumo, "Dinheiro contado"))).toEqual([11600]);
    const difference = row(resumo, "Diferença");
    expect(centsOf(difference)).toEqual([-50]);
    expect(textOf(difference.cells[2])).toBe("Falta");
    expect(textOf(row(resumo, "Observação").cells[1])).toBe("Faltou troco");
    expect(textOf(row(resumo, "Fechado em").cells[1])).toBe("18/11/2026 19:30");
  });

  it("FR-28: a difference above zero is a Sobra, and zero is Sem diferença", () => {
    const { report, salesTabs } = makeReport();
    const differenceLabel = (differenceCents: number) => {
      const closing = { ...report.closing!, differenceCents };
      const resumo = sheet(
        buildDailySpreadsheet({ ...report, closing }, salesTabs).sheets,
        "Resumo do dia",
      );
      return textOf(row(resumo, "Diferença").cells[2]);
    };
    expect(differenceLabel(1)).toBe("Sobra");
    expect(differenceLabel(0)).toBe("Sem diferença");
  });

  it("FR-19: every total in the workbook equals the day report", () => {
    const { report, salesTabs } = makeReport();
    const model = buildDailySpreadsheet(report, salesTabs);
    const total = (t: { grossCents: number; feeCents: number; netCents: number }) => [
      t.grossCents,
      t.feeCents,
      t.netCents,
    ];
    for (const tab of report.matrix.tabs.filter((t) => t.hasSales)) {
      expect(centsOf(row(sheet(model.sheets, tab.name), "Total da aba"))).toEqual(total(tab.total));
    }
    const resumo = sheet(model.sheets, "Resumo do dia");
    expect(centsOf(row(resumo, "Total do dia")).slice(-3)).toEqual(total(report.matrix.total));
    // The sale rows of every tab sheet add up to the tab total.
    for (const tabSheet of model.sheets.slice(0, -2)) {
      const saleRows = tabSheet.rows.filter((r) => r.style === "normal" && r.cells.length === 10);
      const gross = saleRows.reduce((sum, r) => sum + (centsOf(r)[0] ?? 0), 0);
      expect(gross).toBe(centsOf(row(tabSheet, "Total da aba"))[0]);
    }
  });

  it("§7.3: sheet names fit Excel (no []:*?/\\, at most 31 characters, unique)", () => {
    const { report, salesTabs } = makeReport();
    const renamed = salesTabs.map((tab, index) =>
      index === 0
        ? { ...tab, name: "Saídas" }
        : index === 1
          ? { ...tab, name: "Cópias: A4/A3 [colorido] e preto e branco" }
          : tab,
    );
    const names = buildDailySpreadsheet(report, renamed).sheets.map((s) => s.name);
    expect(names).toEqual([
      "Saídas (2)",
      "Cópias- A4-A3 -colorido- e pret",
      "Saídas",
      "Resumo do dia",
    ]);
    for (const name of names) expect(name.length).toBeLessThanOrEqual(31);
  });
});
