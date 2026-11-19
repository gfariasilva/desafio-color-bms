import { and, gte, lte, sql } from "drizzle-orm";
import {
  buildMonthGeneralExpenses,
  buildMonthIncome,
  type CivilDate,
  type MonthGeneralExpensesResponse,
  type MonthIncomeResponse,
  type MonthIncomeRow,
  type YearMonth,
} from "@color-bms/core";
import type { AppDatabase } from "../../db/client";
import { sales } from "../../db/schema";
import { listCategories } from "../categories/categories.repository";
import { listGeneralExpensesOfMonth } from "../expenses/expenses.repository";
import { listPaymentItems } from "../payments/payment-lists.repository";

/**
 * FR-20 / FR-21: the month reports. Read-only (no audit). The monthly summary (FR-23, #17)
 * and the monthly spreadsheet (FR-29, #28) reuse these, so every screen and file agree.
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
