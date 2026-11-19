import {
  buildDailySpreadsheet,
  summarizeDaySales,
  type CivilDate,
  type SpreadsheetModel,
} from "@color-bms/core";
import type { AppDatabase } from "../../db/client";
import { listCategories } from "../categories/categories.repository";
import { listPaymentItems } from "../payments/payment-lists.repository";
import { getDayReport } from "../reports/day-report.repository";
import { listSales } from "../sales/sales.repository";

/**
 * FR-28: the daily spreadsheet of `date`, built from the day report (FR-19, #15) and the same
 * per-tab grouping as the day screen (FR-05), so the file matches the screens.
 *
 * Returns null when there is nothing to write:
 * - the day has no movement (A-15: no file);
 * - the day is not closed (it was reopened before the export ran: the next closing queues it
 *   again, FR-09).
 */
export function getDailySpreadsheet(
  db: AppDatabase,
  date: CivilDate,
  now: Date,
): SpreadsheetModel | null {
  // better-sqlite3 is synchronous: nothing can write between these reads.
  const report = getDayReport(db, date, now);
  if (report.status !== "closed" || !report.hasMovement) return null;
  const { tabs } = summarizeDaySales({
    tabs: listCategories(db, "sale"),
    methods: listPaymentItems(db, "payment_method"),
    sales: listSales(db, date),
  });
  return buildDailySpreadsheet(report, tabs);
}
