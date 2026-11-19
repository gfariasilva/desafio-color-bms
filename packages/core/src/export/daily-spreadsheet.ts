import { EXPENSE_PAYMENT_MEANS_LABELS } from "../expenses/expenses";
import { formatCivilDate, formatInstant, formatInstantTime } from "../format/date";
import type { DayReportResponse } from "../reports/day-report";
import type { DaySalesTab, Sale, SaleTotals } from "../sales/sales";
import {
  BLANK_ROW,
  cents,
  date,
  excelSheetNames,
  integer,
  rate,
  row,
  text,
  type SpreadsheetCell,
  type SpreadsheetModel,
  type SpreadsheetRow,
  type SpreadsheetSheet,
} from "./spreadsheet-model";

/**
 * FR-28 / spec §7.3: the layout of "Diária AAAA-MM-DD.xlsx".
 *
 * - One sheet per tab ("aba") with movement that day: its sales and refunds, a subtotal per
 *   payment method, and the tab total.
 * - "Saídas": the day's expenses, their total, and the sangrias.
 * - "Resumo do dia": the tab × payment method matrix, the day total, and the cash closing.
 *
 * Built only from the day report (FR-19, #15) and the day's sales grouped by tab (FR-05), so
 * every value matches the screens. All totals come from those, never recomputed here (RN-05).
 */

export const SAIDAS_SHEET = "Saídas";
export const SUMMARY_SHEET = "Resumo do dia";

const SALE_TYPE_LABELS: Record<Sale["type"], string> = { sale: "Venda", refund: "Estorno" };

const totalCells = (totals: SaleTotals): SpreadsheetCell[] => [
  cents(totals.grossCents),
  cents(totals.feeCents),
  cents(totals.netCents),
];

/** The sale's note; for a refund (FR-04), the refunded sale's date and the reason first. */
function observation(sale: Sale): string {
  if (sale.type === "sale") return sale.note ?? "";
  return [
    sale.originalSaleDate ? `Estorno da venda de ${formatCivilDate(sale.originalSaleDate)}` : null,
    sale.reason ? `Motivo: ${sale.reason}` : null,
    sale.note,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/** §7.3: one tab's sheet. Columns: hora … observação; then subtotals per method and total. */
function tabSheet(name: string, report: DayReportResponse, tab: DaySalesTab): SpreadsheetSheet {
  const rows: SpreadsheetRow[] = [
    row("title", [text(tab.name), date(report.date)]),
    BLANK_ROW,
    row(
      "header",
      [
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
      ].map(text),
    ),
    ...tab.sales.map((sale) =>
      row("normal", [
        text(formatInstantTime(sale.createdAt)),
        text(SALE_TYPE_LABELS[sale.type]),
        text(sale.paymentMethodName),
        text(sale.cardMachineName ?? ""),
        sale.installments === null ? null : integer(sale.installments),
        cents(sale.grossCents),
        rate(sale.feeRatePpm),
        cents(sale.feeCents),
        cents(sale.netCents),
        text(observation(sale)),
      ]),
    ),
    BLANK_ROW,
    row("section", [text("Subtotal por forma de pagamento")]),
    row("header", [
      text("Forma"),
      null,
      null,
      null,
      null,
      text("Valor cheio"),
      null,
      text("Taxa R$"),
      text("Valor real"),
    ]),
    // RN-05: the subtotals and the total come from FR-05's summary, the same as the screen.
    ...tab.methods.map((method) =>
      row("normal", [
        text(method.paymentMethodName),
        null,
        null,
        null,
        null,
        cents(method.grossCents),
        null,
        cents(method.feeCents),
        cents(method.netCents),
      ]),
    ),
    row("total", [
      text("Total da aba"),
      null,
      null,
      null,
      null,
      cents(tab.total.grossCents),
      null,
      cents(tab.total.feeCents),
      cents(tab.total.netCents),
    ]),
  ];
  return { name, columnWidths: [8, 9, 20, 16, 9, 14, 9, 12, 14, 48], rows };
}

const yesNo = (value: boolean) => text(value ? "Sim" : "Não");

/** §7.3 "Saídas": the day's expenses (general and fixed), their total, and the sangrias. */
function saidasSheet(report: DayReportResponse): SpreadsheetSheet {
  const expenseRows = [
    ...report.expenses.map((expense) =>
      row("normal", [
        text(expense.expenseCategoryName),
        text(expense.description ?? ""),
        text(EXPENSE_PAYMENT_MEANS_LABELS[expense.paymentMeans]),
        yesNo(expense.paidFromTill),
        cents(expense.amountCents),
      ]),
    ),
    // Fixed expenses paid this day (RN-07, RN-09), as on the day report.
    ...report.fixedExpenses.map((expense) =>
      row("normal", [
        text("Despesa fixa"),
        text(
          expense.installmentNumber !== null && expense.installmentsTotal !== null
            ? `${expense.label} (parcela ${expense.installmentNumber}/${expense.installmentsTotal})`
            : expense.label,
        ),
        text(expense.paymentMeans ? EXPENSE_PAYMENT_MEANS_LABELS[expense.paymentMeans] : ""),
        yesNo(expense.paidFromTill),
        cents(expense.amountCents ?? 0),
      ]),
    ),
  ];
  const withdrawalRows = report.withdrawals.map((withdrawal) =>
    row("normal", [
      text(formatInstantTime(withdrawal.createdAt)),
      text(withdrawal.note ?? ""),
      null,
      null,
      cents(withdrawal.amountCents),
    ]),
  );
  const rows: SpreadsheetRow[] = [
    row("title", [text(SAIDAS_SHEET), date(report.date)]),
    BLANK_ROW,
    row("section", [text("Despesas do dia")]),
    row("header", ["Categoria", "Descrição", "Meio", "Do caixa?", "Valor"].map(text)),
    ...(expenseRows.length > 0 ? expenseRows : [row("normal", [text("Nenhuma despesa no dia.")])]),
    row("total", [text("Total das despesas"), null, null, null, cents(report.expensesTotalCents)]),
    row("normal", [
      text("Pagas com dinheiro do caixa"),
      null,
      null,
      null,
      cents(report.paidFromTillCents),
    ]),
    BLANK_ROW,
    row("section", [text("Sangrias")]),
    row("header", [text("Hora"), text("Observação"), null, null, text("Valor")]),
    ...(withdrawalRows.length > 0
      ? withdrawalRows
      : [row("normal", [text("Nenhuma sangria no dia.")])]),
    row("total", [
      text("Total das sangrias"),
      null,
      null,
      null,
      cents(report.withdrawalsTotalCents),
    ]),
  ];
  return { name: SAIDAS_SHEET, columnWidths: [28, 40, 28, 10, 14], rows };
}

function differenceLabel(differenceCents: number): string {
  if (differenceCents > 0) return "Sobra";
  if (differenceCents < 0) return "Falta";
  return "Sem diferença";
}

/** §7.3 "Resumo do dia": the tab × method matrix (RN-05), the day total and the closing. */
function summarySheet(report: DayReportResponse): SpreadsheetSheet {
  const { matrix, closing, cash } = report;
  // One group of 3 columns (cheio, taxa, real) per method, then the tab total.
  const groups = [...matrix.methods.map((method) => method.name), "Total"];
  const rows: SpreadsheetRow[] = [
    row("title", [text(SUMMARY_SHEET), date(report.date)]),
    BLANK_ROW,
    row("section", [text("Vendas por aba e forma de pagamento")]),
    row("header", [text("Aba"), ...groups.flatMap((name) => [text(name), null, null])]),
    row("header", [
      null,
      ...groups.flatMap(() => [text("Valor cheio"), text("Taxa"), text("Valor real")]),
    ]),
    ...matrix.tabs.map((tab) =>
      row("normal", [text(tab.name), ...tab.cells.flatMap(totalCells), ...totalCells(tab.total)]),
    ),
    row("total", [
      text("Total do dia"),
      ...matrix.methodTotals.flatMap(totalCells),
      ...totalCells(matrix.total),
    ]),
    BLANK_ROW,
    row("section", [text("Fechamento de caixa")]),
  ];
  if (closing) {
    rows.push(
      row("normal", [text("Troco inicial"), cents(closing.openingCashCents)]),
      row("normal", [text("(+) Vendas em dinheiro"), cents(cash.cashSalesCents)]),
      row("normal", [text("(−) Despesas pagas do caixa"), cents(cash.tillExpensesCents)]),
      row("normal", [text("(−) Sangrias"), cents(cash.withdrawalsCents)]),
      row("total", [text("Dinheiro esperado"), cents(closing.expectedCashCents)]),
      row("normal", [text("Dinheiro contado"), cents(closing.countedCashCents)]),
      // RN-07: counted − expected; > 0 sobra, < 0 falta.
      row("total", [
        text("Diferença"),
        cents(closing.differenceCents),
        text(differenceLabel(closing.differenceCents)),
      ]),
      row("normal", [text("Observação"), text(closing.note ?? "")]),
      row("normal", [text("Fechado em"), text(formatInstant(closing.closedAt))]),
    );
  } else {
    rows.push(row("normal", [text("Dia não fechado.")]));
  }
  return {
    name: SUMMARY_SHEET,
    columnWidths: [28, ...groups.flatMap(() => [14, 11, 14])],
    rows,
  };
}

/**
 * FR-28: the daily spreadsheet of a day. `salesTabs` is the day's sales grouped by tab
 * (FR-05, `summarizeDaySales`); only tabs with movement get a sheet (§7.3).
 */
export function buildDailySpreadsheet(
  report: DayReportResponse,
  salesTabs: readonly DaySalesTab[],
): SpreadsheetModel {
  const tabsWithSales = salesTabs.filter((tab) => tab.sales.length > 0);
  const names = excelSheetNames(
    tabsWithSales.map((tab) => tab.name),
    [SAIDAS_SHEET, SUMMARY_SHEET],
  );
  return {
    sheets: [
      ...tabsWithSales.map((tab, index) => tabSheet(names[index] ?? tab.name, report, tab)),
      saidasSheet(report),
      summarySheet(report),
    ],
  };
}
