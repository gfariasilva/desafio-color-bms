import { and, eq, gte, lte, or, sql } from "drizzle-orm";
import {
  buildMonthFixedExpenses,
  buildMonthGeneralExpenses,
  buildMonthIncome,
  buildMonthSummary,
  type CivilDate,
  type MonthFixedExpensesReport,
  type MonthGeneralExpensesResponse,
  type MonthIncomeResponse,
  type MonthIncomeRow,
  type MonthSummaryResponse,
  type YearMonth,
} from "@color-bms/core";
import type { AppDatabase } from "../../db/client";
import { expenses, sales } from "../../db/schema";
import { listCategories } from "../categories/categories.repository";
import { listGeneralExpensesOfMonth } from "../expenses/expenses.repository";
import { selectFixedExpenses } from "../fixed-expenses/fixed-expenses.repository";
import { listPaymentItems } from "../payments/payment-lists.repository";

/**
 * FR-20 to FR-23: the month reports. Read-only (no audit). The monthly summary (FR-23) is
 * built from the other three, and the monthly spreadsheet (FR-29, #28) should reuse them
 * too, so every screen and file agree.
 */

/**
 * RN-06: the month's sales and refunds summed per day, tab and payment method. Grouped in
 * SQL so a busy month (≈ 9,000 sales) stays fast (NFR-04); `sales_date_idx` covers the range.
 */
function monthIncomeRows(db: AppDatabase, yearMonth: YearMonth): MonthIncomeRow[] {
  return (
    db
      .select({
        date: sales.date,
        saleCategoryId: sales.saleCategoryId,
        paymentMethodId: sales.paymentMethodId,
        grossCents: sql<number>`sum(${sales.grossCents})`.mapWith(Number),
        feeCents: sql<number>`sum(${sales.feeCents})`.mapWith(Number),
        netCents: sql<number>`sum(${sales.netCents})`.mapWith(Number),
      })
      .from(sales)
      // Civil dates compare correctly as text: the whole month is "YYYY-MM-01" … "YYYY-MM-31".
      .where(and(gte(sales.date, `${yearMonth}-01`), lte(sales.date, `${yearMonth}-31`)))
      .groupBy(sales.date, sales.saleCategoryId, sales.paymentMethodId)
      .all()
  );
}

/** FR-20: Relatório Mês – Entradas. `today` ends the grid of the current month. */
export function getMonthIncome(
  db: AppDatabase,
  yearMonth: YearMonth,
  today: CivilDate,
): MonthIncomeResponse {
  // better-sqlite3 is synchronous: nothing can write between these reads.
  return buildMonthIncome({
    yearMonth,
    today,
    tabs: listCategories(db, "sale"),
    methods: listPaymentItems(db, "payment_method"),
    rows: monthIncomeRows(db, yearMonth),
  });
}

/** FR-21: Relatório Mês – Despesas gerais (RN-08). */
export function getMonthGeneralExpenses(
  db: AppDatabase,
  yearMonth: YearMonth,
): MonthGeneralExpensesResponse {
  return buildMonthGeneralExpenses({
    yearMonth,
    categories: listCategories(db, "expense"),
    expenses: listGeneralExpensesOfMonth(db, yearMonth),
  });
}

/**
 * FR-22: Relatório Mês – Despesas fixas (RN-09). The bills of the reference month, plus the
 * ones of other months paid in it (cash basis); `buildMonthFixedExpenses` lists each once.
 */
export function getMonthFixedExpensesReport(
  db: AppDatabase,
  yearMonth: YearMonth,
): MonthFixedExpensesReport {
  // Civil dates compare correctly as text: the whole month is "YYYY-MM-01" … "YYYY-MM-31".
  const rows = selectFixedExpenses(
    db,
    or(
      eq(expenses.referenceMonth, yearMonth),
      and(
        gte(expenses.paymentDate, `${yearMonth}-01`),
        lte(expenses.paymentDate, `${yearMonth}-31`),
      ),
    ),
  );
  return buildMonthFixedExpenses({ yearMonth, expenses: rows });
}

/** FR-23: Resumo mensal (RN-10), from the FR-20, FR-21 and FR-22 reports. */
export function getMonthSummary(
  db: AppDatabase,
  yearMonth: YearMonth,
  today: CivilDate,
): MonthSummaryResponse {
  return buildMonthSummary({
    income: getMonthIncome(db, yearMonth, today),
    generalExpenses: getMonthGeneralExpenses(db, yearMonth),
    fixedExpenses: getMonthFixedExpensesReport(db, yearMonth),
  });
}
