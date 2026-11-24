import { and, between, count, eq, sql, type AnyColumn } from "drizzle-orm";
import {
  buildMonthComparison,
  comparisonPeriods,
  type CivilDate,
  type MonthComparison,
  type PeriodTotals,
} from "@color-bms/core";
import type { AppDatabase } from "../../db/client";
import { expenses, sales } from "../../db/schema";
import { getMonthSummary } from "../reports/month-reports.repository";

/**
 * FR-24 to FR-26: the dashboards. Read-only (no audit). The totals follow the same rules as
 * the month reports (RN-06, RN-08, RN-09), summed in SQL over any range of days, so a busy
 * month stays fast (NFR-04). `sales_date_idx` and `expenses_payment_date_idx` cover the ranges.
 */

/** Σ of an integer column, 0 when no row matches. */
const total = (column: AnyColumn) => sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);

/**
 * The RN-10 inputs over the civil dates `from`…`to` (both included), plus how many rows
 * counted ("movement": sales, refunds, general expenses and paid fixed expenses). Pending or
 * dismissed bills and sangrias are no movement: they never enter the balance (RN-09, RN-10).
 */
export function getPeriodTotals(
  db: AppDatabase,
  from: CivilDate,
  to: CivilDate,
): PeriodTotals & { movementCount: number } {
  // better-sqlite3 is synchronous: nothing can write between these reads.
  // Civil dates compare correctly as text.
  const income = db
    .select({
      grossCents: total(sales.grossCents),
      feeCents: total(sales.feeCents),
      rows: count(),
    })
    .from(sales)
    .where(between(sales.date, from, to))
    .get();
  const paidInRange = between(expenses.paymentDate, from, to);
  // RN-08: general expenses by payment date (always paid).
  const general = db
    .select({ cents: total(expenses.amountCents), rows: count() })
    .from(expenses)
    .where(and(eq(expenses.type, "general"), paidInRange))
    .get();
  // RN-09: fixed expenses with status paid, by payment date (cash basis).
  const fixed = db
    .select({ cents: total(expenses.amountCents), rows: count() })
    .from(expenses)
    .where(and(eq(expenses.type, "fixed"), eq(expenses.status, "paid"), paidInRange))
    .get();
  return {
    grossCents: income?.grossCents ?? 0,
    feeCents: income?.feeCents ?? 0,
    generalExpensesCents: general?.cents ?? 0,
    fixedExpensesCents: fixed?.cents ?? 0,
    movementCount: (income?.rows ?? 0) + (general?.rows ?? 0) + (fixed?.rows ?? 0),
  };
}

/**
 * FR-24: this month from day 1 to `today` against the same days of the previous month
 * (A-13), with the whole previous month as the reference. The reference is that month's
 * Resumo mensal (FR-23), so the dashboard and the report always agree.
 */
export function getMonthComparison(db: AppDatabase, today: CivilDate): MonthComparison {
  const periods = comparisonPeriods(today);
  const previousMonthDays = getPeriodTotals(
    db,
    `${periods.previousMonth}-01`,
    `${periods.previousMonth}-31`,
  );
  return buildMonthComparison({
    today,
    current: getPeriodTotals(db, periods.current.from, periods.current.to),
    previous: getPeriodTotals(db, periods.previous.from, periods.previous.to),
    previousMonth: {
      summary: getMonthSummary(db, periods.previousMonth, today),
      hasData: previousMonthDays.movementCount > 0,
    },
  });
}
