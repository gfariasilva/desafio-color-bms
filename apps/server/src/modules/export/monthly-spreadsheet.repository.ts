import { eq } from "drizzle-orm";
import {
  buildMonthlySpreadsheet,
  buildMonthSummary,
  todayCivilDate,
  type SpreadsheetModel,
  type YearMonth,
} from "@color-bms/core";
import type { AppDatabase } from "../../db/client";
import { months } from "../../db/schema";
import {
  getMonthFixedExpensesReport,
  getMonthGeneralExpenses,
  getMonthIncome,
} from "../reports/month-reports.repository";

/**
 * FR-29: the monthly spreadsheet of `yearMonth`, built from the month reports (FR-20 to FR-23,
 * #16 and #17), so the file matches the screens. Always written (decision #28): a month
 * always has something to show, at least its fixed expenses (FR-11).
 *
 * The month's status decides the version (FR-29): final when the month is closed, partial
 * (updated at each day closing) while it is open. `now` is the time of writing.
 */
export function getMonthlySpreadsheet(
  db: AppDatabase,
  yearMonth: YearMonth,
  now: Date,
): SpreadsheetModel {
  // better-sqlite3 is synchronous: nothing can write between these reads.
  const income = getMonthIncome(db, yearMonth, todayCivilDate(now));
  const generalExpenses = getMonthGeneralExpenses(db, yearMonth);
  const fixedExpenses = getMonthFixedExpensesReport(db, yearMonth);
  const month = db.select().from(months).where(eq(months.yearMonth, yearMonth)).get();
  return buildMonthlySpreadsheet({
    income,
    generalExpenses,
    fixedExpenses,
    // The same builder as GET …/reports/summary (FR-23), from the reports read above.
    summary: buildMonthSummary({ income, generalExpenses, fixedExpenses }),
    status: {
      closedAt: month?.status === "closed" ? (month.closedAt ?? null) : null,
      generatedAt: now.toISOString(),
    },
  });
}
