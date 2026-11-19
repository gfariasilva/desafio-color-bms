import { z } from "zod";
import {
  FIXED_EXPENSE_GROUP_LABELS,
  FIXED_EXPENSE_GROUPS,
  type FixedExpenseGroup,
} from "../fixed-expenses/fixed-expense-templates";
import { fixedExpensesOfMonthCents } from "../fixed-expenses/fixed-expense-payment";
import {
  compareFixedExpenses,
  fixedExpenseSchema,
  type FixedExpense,
} from "../fixed-expenses/fixed-expenses";
import { yearMonthSchema, type YearMonth } from "../time/year-month";

/**
 * FR-22: the month's fixed expenses report ("Relatório Mês – Despesas fixas"). It lists:
 *
 * - every bill whose **reference month** is the month (pending, paid or dismissed), and
 * - every bill of another reference month **paid in** the month (RN-09, cash basis: October's
 *   bill paid on 05/11 counts in November), flagged with `otherReferenceMonth`.
 *
 * `countsInMonth` marks the rows that make up the total paid (RN-09), so the counted rows
 * always add up to it. A bill of the month paid in a later month is listed, but not counted.
 * The monthly summary (FR-23) and the monthly spreadsheet (FR-29, #28) use the same data.
 */

/** One bill of the report. */
export const monthFixedExpenseRowSchema = fixedExpenseSchema.extend({
  /** RN-09: paid, with its payment date in the report's month. */
  countsInMonth: z.boolean(),
  /** A bill of another reference month, listed because it was paid in this month. */
  otherReferenceMonth: z.boolean(),
});
export type MonthFixedExpenseRow = z.infer<typeof monthFixedExpenseRowSchema>;

/** One group of bills (Gerais or Taxas governo) with its total paid. */
export const monthFixedExpenseGroupSchema = z.object({
  group: z.enum(FIXED_EXPENSE_GROUPS),
  label: z.string(),
  expenses: z.array(monthFixedExpenseRowSchema),
  /** RN-09, for this group only. */
  paidTotalCents: z.number().int(),
});
export type MonthFixedExpenseGroup = z.infer<typeof monthFixedExpenseGroupSchema>;

/** Response of GET /api/months/:yearMonth/reports/fixed-expenses (FR-22). */
export const monthFixedExpensesReportSchema = z.object({
  yearMonth: yearMonthSchema("Mês inválido."),
  /** Always both groups, Gerais first. */
  groups: z.array(monthFixedExpenseGroupSchema),
  /** RN-09: "Total pago no mês", by payment date. This is the FR-23 fixed-expenses line. */
  paidTotalCents: z.number().int(),
  /** FR-22: Σ expected amount of the month's pending bills. Informative, not in the saldo. */
  pendingTotalCents: z.number().int(),
  /** Pending bills of the month with no expected amount (they add 0 to the pending total). */
  pendingWithoutExpectedCount: z.number().int(),
});
export type MonthFixedExpensesReport = z.infer<typeof monthFixedExpensesReportSchema>;

/** Whether a civil date ("YYYY-MM-DD") falls in the month. */
function inMonth(date: string | null, yearMonth: YearMonth): boolean {
  return date?.slice(0, 7) === yearMonth;
}

/** RN-09 over the rows: Σ amount paid of the paid ones with payment date in the month. */
function paidInMonthCents(rows: readonly FixedExpense[], yearMonth: YearMonth): number {
  return fixedExpensesOfMonthCents(
    rows.map((row) => ({ ...row, type: "fixed" as const })),
    yearMonth,
  );
}

/**
 * FR-22 / RN-09: builds the report from the fixed expenses of the month's reference month
 * and the ones paid in the month. The two lists may overlap: each bill is listed once.
 */
export function buildMonthFixedExpenses(input: {
  yearMonth: YearMonth;
  expenses: readonly FixedExpense[];
}): MonthFixedExpensesReport {
  const { yearMonth } = input;
  const byId = new Map<number, FixedExpense>();
  for (const expense of input.expenses) byId.set(expense.id, expense);

  const paidHere = (expense: FixedExpense) =>
    expense.status === "paid" && inMonth(expense.paymentDate, yearMonth);
  const listed = [...byId.values()]
    .filter((expense) => expense.referenceMonth === yearMonth || paidHere(expense))
    .sort(compareFixedExpenses);

  const groups = FIXED_EXPENSE_GROUPS.map((group: FixedExpenseGroup): MonthFixedExpenseGroup => {
    const rows = listed.filter((expense) => expense.group === group);
    return {
      group,
      label: FIXED_EXPENSE_GROUP_LABELS[group],
      expenses: rows.map((expense) => ({
        ...expense,
        countsInMonth: paidHere(expense),
        otherReferenceMonth: expense.referenceMonth !== yearMonth,
      })),
      paidTotalCents: paidInMonthCents(rows, yearMonth),
    };
  });

  // FR-22 "total ainda pendente": only this month's bills; a dismissed one is not pending.
  const pending = listed.filter(
    (expense) => expense.referenceMonth === yearMonth && expense.status === "pending",
  );

  return {
    yearMonth,
    groups,
    paidTotalCents: paidInMonthCents(listed, yearMonth),
    pendingTotalCents: pending.reduce(
      (total, expense) => total + (expense.expectedAmountCents ?? 0),
      0,
    ),
    pendingWithoutExpectedCount: pending.filter((expense) => expense.expectedAmountCents === null)
      .length,
  };
}
