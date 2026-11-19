import { and, eq } from "drizzle-orm";
import {
  buildDayMatrix,
  expensesTotalCents,
  type CivilDate,
  type DayReportResponse,
} from "@color-bms/core";
import type { AppDatabase } from "../../db/client";
import { expenses } from "../../db/schema";
import { getCashClosing } from "../cash-closing/cash-closing.repository";
import { getDayCashWithdrawals } from "../cash-withdrawals/cash-withdrawals.repository";
import { listCategories } from "../categories/categories.repository";
import { getDayExpenses } from "../expenses/expenses.repository";
import { selectFixedExpenses } from "../fixed-expenses/fixed-expenses.repository";
import { listPaymentItems } from "../payments/payment-lists.repository";
import { listSales } from "../sales/sales.repository";

/**
 * FR-19: everything about one day, for the "Relatórios › Dia" screen. Read-only (no audit).
 * It reuses the queries of the day screens (FR-05, FR-06, FR-07, FR-08), so the report always
 * shows the same values as them. The daily spreadsheet export (FR-28, #21) reuses this too.
 */
export function getDayReport(db: AppDatabase, date: CivilDate, now: Date): DayReportResponse {
  // better-sqlite3 is synchronous: nothing can write between these reads.
  const matrix = buildDayMatrix({
    tabs: listCategories(db, "sale"),
    methods: listPaymentItems(db, "payment_method"),
    sales: listSales(db, date),
  });
  const general = getDayExpenses(db, date);
  // Fixed expenses paid on this date, whatever their reference month (RN-07, RN-09). The time
  // of payment is not stored, so they are listed by name (then id): a stable order that the
  // daily spreadsheet (#21) repeats.
  const fixed = selectFixedExpenses(
    db,
    and(eq(expenses.paymentDate, date), eq(expenses.status, "paid")),
  ).sort((a, b) => a.label.localeCompare(b.label, "pt-BR") || a.id - b.id);
  const withdrawals = getDayCashWithdrawals(db, date);
  const cashClosing = getCashClosing(db, date, now);

  return {
    date,
    status: cashClosing.status,
    hasMovement: cashClosing.hasMovement,
    matrix,
    expenses: general.expenses,
    fixedExpenses: fixed,
    expensesTotalCents: general.totalCents + expensesTotalCents(fixed),
    // RN-07: general and fixed expenses paid in cash from the till (the closing's own term).
    paidFromTillCents: cashClosing.tillExpensesCents,
    withdrawals: withdrawals.withdrawals,
    withdrawalsTotalCents: withdrawals.totalCents,
    cash: {
      cashSalesCents: cashClosing.cashSalesCents,
      tillExpensesCents: cashClosing.tillExpensesCents,
      withdrawalsCents: cashClosing.withdrawalsCents,
    },
    closing: cashClosing.closing,
  };
}
