import { z } from "zod";
import { fixedExpensesOfMonthCents } from "../fixed-expenses/fixed-expense-payment";
import { FIXED_EXPENSE_GROUPS } from "../fixed-expenses/fixed-expense-templates";
import {
  compareFixedExpenses,
  fixedExpenseSchema,
  type FixedExpense,
} from "../fixed-expenses/fixed-expenses";
import { yearMonthSchema, type YearMonth } from "../time/year-month";

/**
 * FR-22: the month's fixed expenses report ("Relatório Mês – Despesas fixas"): each bill,
 * grouped in Gerais and Taxas governo, with due date, expected amount, amount paid, payment
 * date and status; the **total paid in the month** by payment date (RN-09) and the total
 * still pending (informative, out of the balance). The monthly spreadsheet (FR-29, #28)
 * builds its "Despesas fixas" sheet from the same data.
 *
 * Which bills are listed (owner decision, #17):
 * - every bill whose **reference month** is the month (pending, paid or dismissed);
 * - plus bills of **other reference months paid in the month** (October's Luz paid on 10/11
 *   is listed in November), so the rows add up to the paid total (regime de caixa, A-06).
 */

/** One bill of the report. */
export const monthFixedExpenseRowSchema = fixedExpenseSchema.extend({
  /** RN-09: true when the bill is paid with a payment date in the report's month. */
  countsInMonth: z.boolean(),
});
export type MonthFixedExpenseRow = z.infer<typeof monthFixedExpenseRowSchema>;

/** One group (Gerais or Taxas governo) with its subtotals. */
export const monthFixedExpenseGroupSchema = z.object({
  group: z.enum(FIXED_EXPENSE_GROUPS),
  /** FR-11 order: by due date (none last), then by name. */
  rows: z.array(monthFixedExpenseRowSchema),
  /** RN-09: Σ amount paid in the month by the group's bills. */
  paidCents: z.number().int(),
  /** Informative: Σ expected amount of the group's pending bills of the month. */
  pendingCents: z.number().int(),
});
export type MonthFixedExpenseGroup = z.infer<typeof monthFixedExpenseGroupSchema>;

/** Response of GET /api/months/:yearMonth/reports/fixed-expenses (FR-22). */
export const monthFixedExpensesReportSchema = z.object({
  yearMonth: yearMonthSchema("Mês inválido."),
  /** Always both groups, Gerais first (FIXED_EXPENSE_GROUPS order). */
  groups: z.array(monthFixedExpenseGroupSchema),
  /** RN-09: Despesas fixas do mês (cash basis). The FR-23 summary line. */
  paidTotalCents: z.number().int(),
  /** FR-22: total still pending (informative, out of the balance, RN-10). */
  pendingTotalCents: z.number().int(),
  /** Pending bills without an expected amount (Q-05): they add 0 to the pending total. */
  pendingWithoutExpectedCount: z.number().int(),
});
export type MonthFixedExpensesReport = z.infer<typeof monthFixedExpensesReportSchema>;

/** RN-09: the bill is paid, with its payment date in `yearMonth`. */
function countsInMonth(expense: FixedExpense, yearMonth: YearMonth): boolean {
  return expense.status === "paid" && expense.paymentDate?.slice(0, 7) === yearMonth;
}

/** Pending bills of the reference month: what is still to pay (informative). */
function isPendingOfMonth(expense: FixedExpense, yearMonth: YearMonth): boolean {
  return expense.status === "pending" && expense.referenceMonth === yearMonth;
}

/** Σ expected amount of the pending bills of the month (no expected amount adds 0). */
function pendingCents(rows: readonly FixedExpense[], yearMonth: YearMonth): number {
  return rows
    .filter((row) => isPendingOfMonth(row, yearMonth))
    .reduce((total, row) => total + (row.expectedAmountCents ?? 0), 0);
}

/** RN-09 through the shared rule (the same one "Contas do mês" uses). */
function paidCents(rows: readonly FixedExpense[], yearMonth: YearMonth): number {
  return fixedExpensesOfMonthCents(
    rows.map((row) => ({ ...row, type: "fixed" as const })),
    yearMonth,
  );
}

/**
 * FR-22 / RN-09: builds the report from the fixed expenses the server read. `expenses` may
 * hold more than the month's bills (anything of other months not paid in it is left out).
 */
export function buildMonthFixedExpensesReport(input: {
  yearMonth: YearMonth;
  expenses: readonly FixedExpense[];
}): MonthFixedExpensesReport {
  const { yearMonth } = input;
  const listed = input.expenses
    .filter((expense) => expense.referenceMonth === yearMonth || countsInMonth(expense, yearMonth))
    .sort(compareFixedExpenses);

  const groups = FIXED_EXPENSE_GROUPS.map((group): MonthFixedExpenseGroup => {
    const rows = listed.filter((expense) => expense.group === group);
    return {
      group,
      rows: rows.map((row) => ({ ...row, countsInMonth: countsInMonth(row, yearMonth) })),
      paidCents: paidCents(rows, yearMonth),
      pendingCents: pendingCents(rows, yearMonth),
    };
  });

  return {
    yearMonth,
    groups,
    paidTotalCents: paidCents(listed, yearMonth),
    pendingTotalCents: pendingCents(listed, yearMonth),
    pendingWithoutExpectedCount: listed.filter(
      (row) => isPendingOfMonth(row, yearMonth) && row.expectedAmountCents === null,
    ).length,
  };
}
