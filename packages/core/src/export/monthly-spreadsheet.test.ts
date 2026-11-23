import { describe, expect, it } from "vitest";
import type { ExpenseCategory, SaleCategory } from "../catalog/categories";
import type { Expense } from "../expenses/expenses";
import type { FixedExpense } from "../fixed-expenses/fixed-expenses";
import type { PaymentMethod } from "../payments/payment-methods";
import { buildMonthFixedExpensesReport } from "../reports/month-fixed-expenses";
import { buildMonthGeneralExpenses } from "../reports/month-general-expenses";
import { buildMonthIncome, type MonthIncomeRow } from "../reports/month-income";
import { buildMonthSummary } from "../reports/month-summary";
import {
  buildMonthlySpreadsheet,
  MONTHLY_SHEETS,
  type MonthlySpreadsheetInput,
} from "./monthly-spreadsheet";
import type { SpreadsheetCell, SpreadsheetRow, SpreadsheetSheet } from "./spreadsheet-model";

const MONTH = "2026-11";
const TODAY = "2026-11-05";

const tabs: SaleCategory[] = [
  { id: 1, name: "Toner", order: 1, active: true },
  { id: 2, name: "Papelaria", order: 2, active: true },
];

function method(id: number, name: string, order: number): PaymentMethod {
  return { id, name, order, active: true, machineUsage: "optional", allowsInstallments: true };
}
const methods: PaymentMethod[] = [method(10, "Dinheiro", 1), method(12, "Cartão de crédito", 2)];

function income(
  date: string,
  saleCategoryId: number,
  paymentMethodId: number,
  grossCents: number,
  feeCents = 0,
): MonthIncomeRow {
  return {
    date,
    saleCategoryId,
    paymentMethodId,
    grossCents,
    feeCents,
    netCents: grossCents - feeCents,
  };
}

// Day 1: Toner R$ 25,00 cash + R$ 150,00 credit (RN-03: fee R$ 5,69); Papelaria R$ 10,00 cash.
// Day 2: no sales. Day 3: a Papelaria refund of R$ 40,00 on credit (fee −R$ 1,52).
const incomeRows: MonthIncomeRow[] = [
  income("2026-11-01", 1, 10, 2500),
  income("2026-11-01", 1, 12, 15000, 569),
  income("2026-11-01", 2, 10, 1000),
  income("2026-11-03", 2, 12, -4000, -152),
];

const expenseCategories: ExpenseCategory[] = [
  { id: 1, name: "Alimentação", order: 1, active: true, group: "general" },
  { id: 2, name: "Acessórios", order: 2, active: true, group: "general" },
  { id: 9, name: "Kalunga", order: 9, active: true, group: "suppliers" },
];

let nextId = 1;
function generalExpense(
  categoryId: number,
  paymentDate: string,
  amountCents: number,
  fields: Partial<Expense> = {},
): Expense {
  const category = expenseCategories.find((c) => c.id === categoryId)!;
  const id = nextId++;
  return {
    id,
    type: "general",
    status: "paid",
    paymentDate,
    createdAt: `2026-11-01T12:00:${String(id).padStart(2, "0")}.000Z`,
    expenseCategoryId: categoryId,
    expenseCategoryName: category.name,
    expenseCategoryOrder: category.order,
    description: null,
    amountCents,
    paymentMeans: "pix",
    paidFromTill: false,
    ...fields,
  };
}

const generalExpenses: Expense[] = [
  generalExpense(1, "2026-11-01", 1850, {
    description: "Lanche",
    paymentMeans: "cash",
    paidFromTill: true,
  }),
  generalExpense(9, "2026-11-03", 30000, { description: "Papel A4" }),
];

function fixed(label: string, fields: Partial<FixedExpense> = {}): FixedExpense {
  return {
    id: nextId++,
    referenceMonth: MONTH,
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

const fixedExpenses: FixedExpense[] = [
  // FR-12 example: Luz paid R$ 187,43 on 03/11 by PIX.
  fixed("Luz", {
    status: "paid",
    amountCents: 18743,
    paymentDate: "2026-11-03",
    paymentMeans: "pix",
  }),
  // October's Água paid in November: listed with "ref. 10/2026" and counted (RN-09).
  fixed("Água", {
    referenceMonth: "2026-10",
    dueDate: "2026-10-20",
    status: "paid",
    amountCents: 5000,
    paymentDate: "2026-11-02",
  }),
  // A loan installment still pending.
  fixed("Empréstimo Banco X", {
    expectedAmountCents: 50000,
    installmentNumber: 4,
    installmentsTotal: 12,
  }),
  // No due date and no expected amount (Q-05).
  fixed("Internet", { dueDate: null, expectedAmountCents: null }),
  // A November bill paid in December: listed, out of the total.
  fixed("Aluguel", {
    expectedAmountCents: 150000,
    status: "paid",
    amountCents: 150000,
    paymentDate: "2026-12-01",
  }),
  fixed("Simples Nacional", { group: "government_fees", status: "dismissed" }),
];

function makeInput(
  status: MonthlySpreadsheetInput["status"] = {
    closedAt: null,
    generatedAt: "2026-11-05T22:30:00.000Z",
  },
): MonthlySpreadsheetInput {
  const monthIncome = buildMonthIncome({
    yearMonth: MONTH,
    today: TODAY,
    tabs,
    methods,
    rows: incomeRows,
  });
  const monthGeneral = buildMonthGeneralExpenses({
    yearMonth: MONTH,
    categories: expenseCategories,
    expenses: generalExpenses,
  });
  const monthFixed = buildMonthFixedExpensesReport({ yearMonth: MONTH, expenses: fixedExpenses });
  return {
    income: monthIncome,
    generalExpenses: monthGeneral,
    fixedExpenses: monthFixed,
    summary: buildMonthSummary({
      income: monthIncome,
      generalExpenses: monthGeneral,
      fixedExpenses: monthFixed,
    }),
    status,
  };
}

function sheet(name: string, input = makeInput()): SpreadsheetSheet {
  const found = buildMonthlySpreadsheet(input).sheets.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No sheet "${name}"`);
  return found;
}

function textOf(cell: SpreadsheetCell | undefined): string | null {
  return cell && cell.kind === "text" ? cell.value : null;
}

/** The first row whose first cell is the text `label`. */
function row(target: SpreadsheetSheet, label: string): SpreadsheetRow {
  const found = target.rows.find((candidate) => textOf(candidate.cells[0]) === label);
  if (!found) throw new Error(`No row "${label}" in sheet "${target.name}"`);
  return found;
}

/** The rows after the first one whose first cell is `label`, up to the next blank row. */
function block(target: SpreadsheetSheet, label: string): SpreadsheetRow[] {
  const start = target.rows.findIndex((candidate) => textOf(candidate.cells[0]) === label);
  if (start < 0) throw new Error(`No block "${label}" in sheet "${target.name}"`);
  const rows: SpreadsheetRow[] = [];
  for (const candidate of target.rows.slice(start + 1)) {
    if (candidate.style === "blank") break;
    rows.push(candidate);
  }
  return rows;
}

/** The cents in a row, in column order (other cells skipped). */
function centsOf(target: SpreadsheetRow): number[] {
  return target.cells.flatMap((cell) => (cell?.kind === "cents" ? [cell.value] : []));
}

/** The row whose first cell is the date `value`. */
function dayRow(target: SpreadsheetSheet, value: string): SpreadsheetRow {
  const found = target.rows.find(
    (candidate) => candidate.cells[0]?.kind === "date" && candidate.cells[0].value === value,
  );
  if (!found) throw new Error(`No day ${value}`);
  return found;
}

describe("FR-29: the monthly spreadsheet layout (spec §7.3)", () => {
  it("FR-29: sheets Entradas, Despesas gerais, Despesas fixas and Resumo, in that order", () => {
    expect(buildMonthlySpreadsheet(makeInput()).sheets.map((s) => s.name)).toEqual([
      "Entradas",
      "Despesas gerais",
      "Despesas fixas",
      "Resumo",
    ]);
    expect(MONTHLY_SHEETS).toEqual(["Entradas", "Despesas gerais", "Despesas fixas", "Resumo"]);
  });

  it("FR-29: every sheet starts with its title and the month", () => {
    for (const target of buildMonthlySpreadsheet(makeInput()).sheets) {
      expect(target.rows[0]!.style).toBe("title");
      expect(target.rows[0]!.cells.map(textOf)).toEqual([target.name, "novembro de 2026"]);
    }
  });
});

describe("FR-29 / FR-20: the Entradas sheet (RN-06)", () => {
  it("FR-20: a days × tabs grid with the gross of each tab and the day total", () => {
    const entradas = sheet("Entradas");
    const header = entradas.rows.find((r) => r.style === "header")!;
    expect(header.cells.map(textOf)).toEqual(["Dia", "Toner", "Papelaria", "Total do dia"]);
    // Days are Excel dates, every day of the month up to today.
    const days = entradas.rows.filter((r) => r.cells[0]?.kind === "date");
    expect(days.map((r) => (r.cells[0]?.kind === "date" ? r.cells[0].value : null))).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
    expect(dayRow(entradas, "2026-11-01").cells.slice(1)).toEqual([
      { kind: "cents", value: 17500 },
      { kind: "cents", value: 1000 },
      { kind: "cents", value: 18500 },
    ]);
    // A refund is a negative value (RN-06).
    expect(centsOf(dayRow(entradas, "2026-11-03"))).toEqual([0, -4000, -4000]);
  });

  it("FR-20: a day without sales has empty cells, like the screen's dashes", () => {
    expect(dayRow(sheet("Entradas"), "2026-11-02").cells.slice(1)).toEqual([null, null, null]);
  });

  it("FR-20: the sum of each tab's column equals the tab total, and the tabs add up to the Entrada mensal", () => {
    const entradas = sheet("Entradas");
    const days = entradas.rows.filter((r) => r.cells[0]?.kind === "date");
    const columnSum = (column: number) =>
      days.reduce((sum, r) => {
        const cell = r.cells[column];
        return sum + (cell?.kind === "cents" ? cell.value : 0);
      }, 0);
    const totals = centsOf(row(entradas, "Total da aba"));
    expect(totals).toEqual([columnSum(1), columnSum(2), columnSum(3)]);
    expect(totals).toEqual([17500, -3000, 14500]);
    expect(totals[0]! + totals[1]!).toBe(totals[2]);
  });

  it("FR-20: totals per payment method (gross, fee, net)", () => {
    const entradas = sheet("Entradas");
    const methodsBlock = block(entradas, "Totais por forma de pagamento");
    expect(methodsBlock[0]!.cells.map(textOf)).toEqual([
      "Forma",
      "Valor cheio",
      "Taxa",
      "Valor líquido",
    ]);
    expect(methodsBlock.slice(1).map((r) => [textOf(r.cells[0]), ...centsOf(r)])).toEqual([
      ["Dinheiro", 3500, 0, 3500],
      ["Cartão de crédito", 11000, 417, 10583],
      ["Total", 14500, 417, 14083],
    ]);
  });

  it("RN-06: Entrada mensal, Taxas and Líquido", () => {
    const entradas = sheet("Entradas");
    expect(centsOf(row(entradas, "Entrada mensal (bruta)"))).toEqual([14500]);
    expect(centsOf(row(entradas, "(−) Taxas de maquininha"))).toEqual([417]);
    expect(centsOf(row(entradas, "Líquido do mês"))).toEqual([14083]);
    expect(row(entradas, "Líquido do mês").style).toBe("total");
  });

  it("FR-20: a month without any tab or sale still has the totals (zero)", () => {
    const input = makeInput();
    const empty = buildMonthIncome({
      yearMonth: MONTH,
      today: TODAY,
      tabs: [],
      methods: [],
      rows: [],
    });
    const entradas = sheet("Entradas", { ...input, income: empty });
    expect(centsOf(row(entradas, "Entrada mensal (bruta)"))).toEqual([0]);
    expect(centsOf(row(entradas, "Total da aba"))).toEqual([0]);
  });
});

describe("FR-29 / FR-21: the Despesas gerais sheet (RN-08)", () => {
  it("FR-21: totals per category, the Fornecedores de materiais group with its subtotal, and the total geral", () => {
    const despesas = sheet("Despesas gerais");
    const totals = block(despesas, "Totais por categoria (data de pagamento)");
    expect(totals.map((r) => [textOf(r.cells[0]), ...centsOf(r)])).toEqual([
      ["Categoria"],
      ["Alimentação", 1850],
      ["Acessórios", 0],
      ["Subtotal Geral", 1850],
      ["Fornecedores de materiais"],
      ["Kalunga", 30000],
      ["Subtotal Fornecedores de materiais", 30000],
      ["Total geral", 31850],
    ]);
    expect(row(despesas, "Total geral").style).toBe("total");
    expect(row(despesas, "Fornecedores de materiais").style).toBe("section");
  });

  it("FR-21: every entry of the month, with date, category, description, means, till and amount", () => {
    const despesas = sheet("Despesas gerais");
    const entries = block(despesas, "Lançamentos");
    expect(entries[0]!.cells.map(textOf)).toEqual([
      "Data",
      "Categoria",
      "Descrição",
      "Meio",
      "Do caixa?",
      "Valor",
    ]);
    expect(entries.slice(1)).toEqual([
      {
        style: "normal",
        cells: [
          { kind: "date", value: "2026-11-01" },
          { kind: "text", value: "Alimentação" },
          { kind: "text", value: "Lanche" },
          { kind: "text", value: "Dinheiro" },
          { kind: "text", value: "Sim" },
          { kind: "cents", value: 1850 },
        ],
      },
      {
        style: "normal",
        cells: [
          { kind: "date", value: "2026-11-03" },
          { kind: "text", value: "Kalunga" },
          { kind: "text", value: "Papel A4" },
          { kind: "text", value: "PIX" },
          { kind: "text", value: "Não" },
          { kind: "cents", value: 30000 },
        ],
      },
    ]);
  });

  it("FR-21: a month without general expenses says so", () => {
    const input = makeInput();
    const none = buildMonthGeneralExpenses({
      yearMonth: MONTH,
      categories: expenseCategories,
      expenses: [],
    });
    const despesas = sheet("Despesas gerais", { ...input, generalExpenses: none });
    expect(block(despesas, "Lançamentos").map((r) => textOf(r.cells[0]))).toEqual([
      "Nenhuma despesa geral no mês.",
    ]);
    expect(centsOf(row(despesas, "Total geral"))).toEqual([0]);
  });
});

describe("FR-29 / FR-22: the Despesas fixas sheet (RN-09)", () => {
  it("FR-22: each bill with due date, expected, paid amount, payment date and status, grouped", () => {
    const fixas = sheet("Despesas fixas");
    const gerais = block(fixas, "Gerais");
    expect(gerais[0]!.cells.map(textOf)).toEqual([
      "Conta",
      "Vencimento",
      "Valor previsto",
      "Valor pago",
      "Data de pagamento",
      "Status",
      "Observação",
    ]);
    // FR-11 order: by due date (none last), then by name.
    expect(gerais.slice(1, -2).map((r) => textOf(r.cells[0]))).toEqual([
      "Água",
      "Aluguel",
      "Empréstimo Banco X (parcela 4 de 12)",
      "Luz",
      "Internet",
    ]);
    expect(row(fixas, "Luz").cells).toEqual([
      { kind: "text", value: "Luz" },
      { kind: "date", value: "2026-11-10" },
      { kind: "cents", value: 20000 },
      { kind: "cents", value: 18743 },
      { kind: "date", value: "2026-11-03" },
      { kind: "text", value: "Pago" },
      { kind: "text", value: "" },
    ]);
    // No due date, no expected amount, not paid.
    expect(row(fixas, "Internet").cells).toEqual([
      { kind: "text", value: "Internet" },
      { kind: "text", value: "Sem vencimento" },
      null,
      null,
      null,
      { kind: "text", value: "Pendente" },
      { kind: "text", value: "" },
    ]);
  });

  it("RN-09: a bill of another month paid in this one says ref.; one paid in a later month is out of the total", () => {
    const fixas = sheet("Despesas fixas");
    expect(textOf(row(fixas, "Água").cells[6])).toBe("ref. 10/2026");
    expect(textOf(row(fixas, "Aluguel").cells[6])).toBe("Paga em 12/2026: fora do total do mês");
  });

  it("RN-09: subtotals per group, the total paid in the month and the pending total (informative)", () => {
    const fixas = sheet("Despesas fixas");
    // Gerais: Luz 187,43 + Água 50,00 paid; pending Empréstimo 500,00 (Internet adds 0).
    expect(row(fixas, "Total pago – Gerais").cells.slice(2, 4)).toEqual([
      null,
      { kind: "cents", value: 23743 },
    ]);
    expect(row(fixas, "Pendente – Gerais (informativo)").cells.slice(2, 4)).toEqual([
      { kind: "cents", value: 50000 },
      null,
    ]);
    const taxas = block(fixas, "Taxas governo");
    expect(textOf(taxas[1]!.cells[0])).toBe("Simples Nacional");
    expect(textOf(taxas[1]!.cells[5])).toBe("Dispensado");
    expect(centsOf(row(fixas, "Total pago no mês"))).toEqual([23743]);
    expect(row(fixas, "Total pago no mês").style).toBe("total");
    expect(centsOf(row(fixas, "Total pendente (informativo)"))).toEqual([50000]);
    expect(
      textOf(
        row(fixas, "1 conta pendente sem valor previsto não entra no total pendente.").cells[0],
      ),
    ).not.toBeNull();
  });

  it("FR-22: a group without bills says so", () => {
    const input = makeInput();
    const report = buildMonthFixedExpensesReport({
      yearMonth: MONTH,
      expenses: fixedExpenses.filter((e) => e.group === "general"),
    });
    const fixas = sheet("Despesas fixas", { ...input, fixedExpenses: report });
    expect(block(fixas, "Taxas governo").map((r) => textOf(r.cells[0]))).toEqual([
      "Nenhuma conta neste grupo.",
      "Total pago – Taxas governo",
      "Pendente – Taxas governo (informativo)",
    ]);
  });
});

describe("FR-29 / FR-23: the Resumo sheet (RN-10)", () => {
  it("FR-23: each line equals the summary, which equals the other sheets' totals", () => {
    const input = makeInput();
    const resumo = sheet("Resumo", input);
    const value = (label: string) => centsOf(row(resumo, label))[0];
    expect(value("Entrada mensal (bruta)")).toBe(input.summary.grossCents);
    expect(value("(−) Taxas de maquininha")).toBe(input.summary.feeCents);
    expect(value("(−) Total despesas gerais")).toBe(input.summary.generalExpensesCents);
    expect(value("(−) Total despesas fixas")).toBe(input.summary.fixedExpensesCents);
    expect(value("Total geral de despesas")).toBe(input.summary.totalExpensesCents);
    expect(value("Saldo mensal")).toBe(input.summary.balanceCents);
    // And against the other sheets of the same file.
    expect(value("Entrada mensal (bruta)")).toBe(
      centsOf(row(sheet("Entradas"), "Entrada mensal (bruta)"))[0],
    );
    expect(value("(−) Total despesas gerais")).toBe(
      centsOf(row(sheet("Despesas gerais"), "Total geral"))[0],
    );
    expect(value("(−) Total despesas fixas")).toBe(
      centsOf(row(sheet("Despesas fixas"), "Total pago no mês"))[0],
    );
  });

  it("RN-10: saldo = entrada − taxas − despesas; a negative saldo is marked", () => {
    const resumo = sheet("Resumo");
    // 145,00 − 4,17 − (318,50 + 237,43) = −415,10.
    expect(centsOf(row(resumo, "Total geral de despesas"))).toEqual([55593]);
    expect(row(resumo, "Saldo mensal").cells).toEqual([
      { kind: "text", value: "Saldo mensal" },
      { kind: "cents", value: -41510 },
      { kind: "text", value: "Saldo negativo" },
    ]);
    expect(row(resumo, "Saldo mensal").style).toBe("total");
  });

  it("FR-29: an open month is the partial version, updated at the last closing", () => {
    expect(row(sheet("Resumo"), "Situação").cells[1]).toEqual({
      kind: "text",
      value: "Versão parcial: mês aberto, atualizada em 05/11/2026 19:30",
    });
  });

  it("FR-29: a closed month is the final version", () => {
    const resumo = sheet(
      "Resumo",
      makeInput({ closedAt: "2026-11-30T23:10:00.000Z", generatedAt: "2026-11-30T23:10:05.000Z" }),
    );
    expect(row(resumo, "Situação").cells[1]).toEqual({
      kind: "text",
      value: "Versão final: mês fechado em 30/11/2026 20:10",
    });
  });
});
