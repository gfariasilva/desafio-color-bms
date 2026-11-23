import { EXPENSE_PAYMENT_MEANS_LABELS, type Expense } from "../expenses/expenses";
import { FIXED_EXPENSE_GROUP_LABELS } from "../fixed-expenses/fixed-expense-templates";
import {
  EXPENSE_STATUS_LABELS,
  fixedExpenseInstallmentLabel,
} from "../fixed-expenses/fixed-expenses";
import { formatInstant, formatYearMonth, formatYearMonthLong } from "../format/date";
import type {
  MonthFixedExpenseGroup,
  MonthFixedExpenseRow,
  MonthFixedExpensesReport,
} from "../reports/month-fixed-expenses";
import type {
  MonthGeneralExpensesResponse,
  MonthExpenseCategory,
} from "../reports/month-general-expenses";
import type { MonthIncomeResponse } from "../reports/month-income";
import type { MonthSummary } from "../reports/month-summary";
import type { SaleTotals } from "../sales/sales";
import {
  BLANK_ROW,
  cents,
  date,
  row,
  text,
  type SpreadsheetCell,
  type SpreadsheetModel,
  type SpreadsheetRow,
  type SpreadsheetSheet,
} from "./spreadsheet-model";

/**
 * FR-29 / spec §7.3: the layout of "Mensal AAAA-MM.xlsx".
 *
 * - "Entradas": the days × tabs grid, the totals per payment method, the Entrada mensal, the
 *   fees and the net (FR-20, RN-06).
 * - "Despesas gerais": the total per category, with the Fornecedores de materiais group, its
 *   subtotal and the total geral (FR-21, RN-08); then every entry of the month (decision #28:
 *   once the Excel is dropped this file is the owner's record).
 * - "Despesas fixas": each bill with due date, expected and paid amounts, payment date and
 *   status, and the total paid in the month (FR-22, RN-09).
 * - "Resumo": the FR-23 lines and the Saldo mensal (RN-10), and whether the file is the final
 *   version (month closed) or a partial one (month open, updated at each day closing).
 *
 * Built only from the month reports (FR-20 to FR-23, #16 and #17), so the file always matches
 * the screens. No total is recomputed here.
 */

export const MONTHLY_SHEETS = ["Entradas", "Despesas gerais", "Despesas fixas", "Resumo"] as const;
const [ENTRADAS, DESPESAS_GERAIS, DESPESAS_FIXAS, RESUMO] = MONTHLY_SHEETS;

export interface MonthlySpreadsheetInput {
  income: MonthIncomeResponse;
  generalExpenses: MonthGeneralExpensesResponse;
  fixedExpenses: MonthFixedExpensesReport;
  summary: MonthSummary;
  /**
   * The month's state when the file is written: `closedAt` is the closing instant (final
   * version) or null (open month, partial version); `generatedAt` is the time of writing.
   * Both ISO-8601 UTC.
   */
  status: { closedAt: string | null; generatedAt: string };
}

/** The first row of every sheet: its name and the month ("novembro de 2026"). */
function titleRow(name: string, yearMonth: string): SpreadsheetRow {
  return row("title", [text(name), text(formatYearMonthLong(yearMonth))]);
}

const totalCells = (totals: SaleTotals): SpreadsheetCell[] => [
  cents(totals.grossCents),
  cents(totals.feeCents),
  cents(totals.netCents),
];

/** §7.3 "Entradas" (FR-20, RN-06). */
function entradasSheet(income: MonthIncomeResponse): SpreadsheetSheet {
  const rows: SpreadsheetRow[] = [
    titleRow(ENTRADAS, income.yearMonth),
    BLANK_ROW,
    row("section", [text("Vendas por dia e aba (valor cheio)")]),
    row("header", [text("Dia"), ...income.tabs.map((tab) => text(tab.name)), text("Total do dia")]),
    // A day without sales has empty cells (the screen shows "—"), so the grid still has one
    // row per day, like the owner's Excel.
    ...income.days.map((day) =>
      row("normal", [
        date(day.date),
        ...day.cells.map((value) => (day.hasSales ? cents(value) : null)),
        day.hasSales ? cents(day.totalCents) : null,
      ]),
    ),
    // FR-20: the column sums are the tab totals; their sum is the Entrada mensal.
    row("total", [
      text("Total da aba"),
      ...income.tabs.map((tab) => cents(tab.totalCents)),
      cents(income.total.grossCents),
    ]),
    BLANK_ROW,
    row("section", [text("Totais por forma de pagamento")]),
    row("header", ["Forma", "Valor cheio", "Taxa", "Valor líquido"].map(text)),
    ...income.methods.map((method) => row("normal", [text(method.name), ...totalCells(method)])),
    row("total", [text("Total"), ...totalCells(income.total)]),
    BLANK_ROW,
    // RN-06.
    row("normal", [text("Entrada mensal (bruta)"), cents(income.total.grossCents)]),
    row("normal", [text("(−) Taxas de maquininha"), cents(income.total.feeCents)]),
    row("total", [text("Líquido do mês"), cents(income.total.netCents)]),
  ];
  return {
    name: ENTRADAS,
    // Column A also holds the payment method names and the RN-06 labels.
    columnWidths: [24, ...income.tabs.map(() => 14), 14],
    rows,
  };
}

const yesNo = (value: boolean) => text(value ? "Sim" : "Não");

const categoryRow = (category: MonthExpenseCategory) =>
  row("normal", [text(category.name), cents(category.totalCents)]);

/** One general expense of the month (FR-21 drill-down). */
function entryRow(expense: Expense): SpreadsheetRow {
  return row("normal", [
    date(expense.paymentDate),
    text(expense.expenseCategoryName),
    text(expense.description ?? ""),
    text(EXPENSE_PAYMENT_MEANS_LABELS[expense.paymentMeans]),
    yesNo(expense.paidFromTill),
    cents(expense.amountCents),
  ]);
}

/** §7.3 "Despesas gerais" (FR-21, RN-08). */
function despesasGeraisSheet(report: MonthGeneralExpensesResponse): SpreadsheetSheet {
  const { general, suppliers } = report;
  // All entries of the month by payment date (then registration order), whatever the group.
  const entries = [...general.categories, ...suppliers.categories]
    .flatMap((category) => category.expenses)
    .sort(
      (a, b) =>
        a.paymentDate.localeCompare(b.paymentDate) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id - b.id,
    );
  const rows: SpreadsheetRow[] = [
    titleRow(DESPESAS_GERAIS, report.yearMonth),
    BLANK_ROW,
    row("section", [text("Totais por categoria (data de pagamento)")]),
    row("header", [text("Categoria"), text("Total")]),
    ...general.categories.map(categoryRow),
    row("total", [text("Subtotal Geral"), cents(general.subtotalCents)]),
    row("section", [text("Fornecedores de materiais")]),
    ...suppliers.categories.map(categoryRow),
    row("total", [text("Subtotal Fornecedores de materiais"), cents(suppliers.subtotalCents)]),
    row("total", [text("Total geral"), cents(report.totalCents)]),
    BLANK_ROW,
    row("section", [text("Lançamentos")]),
    ...(entries.length > 0
      ? [
          row("header", ["Data", "Categoria", "Descrição", "Meio", "Do caixa?", "Valor"].map(text)),
          ...entries.map(entryRow),
        ]
      : [row("normal", [text("Nenhuma despesa geral no mês.")])]),
  ];
  return { name: DESPESAS_GERAIS, columnWidths: [34, 22, 40, 28, 10, 14], rows };
}

/** The note of a bill: another reference month (ref.), or paid in a later month (RN-09). */
function fixedObservation(expense: MonthFixedExpenseRow, yearMonth: string): string {
  if (expense.referenceMonth !== yearMonth)
    return `ref. ${formatYearMonth(expense.referenceMonth)}`;
  if (expense.status === "paid" && !expense.countsInMonth && expense.paymentDate) {
    return `Paga em ${formatYearMonth(expense.paymentDate.slice(0, 7))}: fora do total do mês`;
  }
  return "";
}

/** One bill (FR-22): conta, vencimento, previsto, pago, data de pagamento, status, observação. */
function fixedRow(expense: MonthFixedExpenseRow, yearMonth: string): SpreadsheetRow {
  const installment = fixedExpenseInstallmentLabel(expense);
  return row("normal", [
    text(installment ? `${expense.label} (${installment})` : expense.label),
    expense.dueDate ? date(expense.dueDate) : text("Sem vencimento"),
    expense.expectedAmountCents === null ? null : cents(expense.expectedAmountCents),
    expense.amountCents === null ? null : cents(expense.amountCents),
    expense.paymentDate ? date(expense.paymentDate) : null,
    text(EXPENSE_STATUS_LABELS[expense.status]),
    text(fixedObservation(expense, yearMonth)),
  ]);
}

/** One group (Gerais or Taxas governo) with its subtotals: paid in column D, pending in C. */
function fixedGroupRows(group: MonthFixedExpenseGroup, yearMonth: string): SpreadsheetRow[] {
  const label = FIXED_EXPENSE_GROUP_LABELS[group.group];
  return [
    row("section", [text(label)]),
    ...(group.rows.length > 0
      ? [
          row(
            "header",
            [
              "Conta",
              "Vencimento",
              "Valor previsto",
              "Valor pago",
              "Data de pagamento",
              "Status",
              "Observação",
            ].map(text),
          ),
          ...group.rows.map((expense) => fixedRow(expense, yearMonth)),
        ]
      : [row("normal", [text("Nenhuma conta neste grupo.")])]),
    row("total", [text(`Total pago – ${label}`), null, null, cents(group.paidCents)]),
    row("normal", [
      text(`Pendente – ${label} (informativo)`),
      null,
      cents(group.pendingCents),
      null,
    ]),
  ];
}

/** §7.3 "Despesas fixas" (FR-22, RN-09). */
function despesasFixasSheet(report: MonthFixedExpensesReport): SpreadsheetSheet {
  const { yearMonth } = report;
  const withoutExpected = report.pendingWithoutExpectedCount;
  const rows: SpreadsheetRow[] = [
    titleRow(DESPESAS_FIXAS, yearMonth),
    BLANK_ROW,
    ...report.groups.flatMap((group) => [...fixedGroupRows(group, yearMonth), BLANK_ROW]),
    // RN-09: cash basis, by payment date. The pending total stays out of the saldo (RN-10).
    row("total", [text("Total pago no mês"), null, null, cents(report.paidTotalCents)]),
    row("normal", [
      text("Total pendente (informativo)"),
      null,
      cents(report.pendingTotalCents),
      null,
    ]),
  ];
  if (withoutExpected > 0) {
    rows.push(
      row("normal", [
        text(
          withoutExpected === 1
            ? "1 conta pendente sem valor previsto não entra no total pendente."
            : `${withoutExpected} contas pendentes sem valor previsto não entram no total pendente.`,
        ),
      ]),
    );
  }
  return { name: DESPESAS_FIXAS, columnWidths: [40, 14, 14, 14, 18, 12, 40], rows };
}

/** FR-29: the final version once the month is closed; a partial one while it is open. */
function statusText(status: MonthlySpreadsheetInput["status"]): string {
  if (status.closedAt) return `Versão final: mês fechado em ${formatInstant(status.closedAt)}`;
  return `Versão parcial: mês aberto, atualizada em ${formatInstant(status.generatedAt)}`;
}

/** §7.3 "Resumo" (FR-23, RN-10), in the same order as the screen. */
function resumoSheet(
  summary: MonthSummary,
  status: MonthlySpreadsheetInput["status"],
): SpreadsheetSheet {
  const rows: SpreadsheetRow[] = [
    titleRow(RESUMO, summary.yearMonth),
    BLANK_ROW,
    row("normal", [text("Entrada mensal (bruta)"), cents(summary.grossCents)]),
    row("normal", [text("(−) Taxas de maquininha"), cents(summary.feeCents)]),
    row("normal", [text("(−) Total despesas gerais"), cents(summary.generalExpensesCents)]),
    row("normal", [text("(−) Total despesas fixas"), cents(summary.fixedExpensesCents)]),
    row("total", [text("Total geral de despesas"), cents(summary.totalExpensesCents)]),
    row("total", [
      text("Saldo mensal"),
      cents(summary.balanceCents),
      ...(summary.balanceCents < 0 ? [text("Saldo negativo")] : []),
    ]),
    BLANK_ROW,
    row("normal", [text("Situação"), text(statusText(status))]),
  ];
  return { name: RESUMO, columnWidths: [30, 16, 16], rows };
}

/** FR-29: the monthly spreadsheet of a month, from its reports (FR-20 to FR-23). */
export function buildMonthlySpreadsheet(input: MonthlySpreadsheetInput): SpreadsheetModel {
  return {
    sheets: [
      entradasSheet(input.income),
      despesasGeraisSheet(input.generalExpenses),
      despesasFixasSheet(input.fixedExpenses),
      resumoSheet(input.summary, input.status),
    ],
  };
}
