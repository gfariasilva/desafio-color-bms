import { eq } from "drizzle-orm";
import { monthOf, type CivilDate } from "@color-bms/core";
import type { AppDatabase, AppTransaction } from "../../db/client";
import { days, months } from "../../db/schema";

/**
 * RN-14: is the date's day or month closed? No row means open. Shared by every module that
 * writes dated records (sales, refunds, expenses, …).
 */
export function periodStatus(db: AppDatabase | AppTransaction, date: CivilDate) {
  const day = db.select({ status: days.status }).from(days).where(eq(days.date, date)).get();
  const month = db
    .select({ status: months.status })
    .from(months)
    .where(eq(months.yearMonth, monthOf(date)))
    .get();
  return { dayClosed: day?.status === "closed", monthClosed: month?.status === "closed" };
}

/** RN-14: is the month ("YYYY-MM") closed? No row means open. */
export function monthStatus(db: AppDatabase | AppTransaction, yearMonth: string) {
  const month = db
    .select({ status: months.status, fixedExpensesGenerated: months.fixedExpensesGenerated })
    .from(months)
    .where(eq(months.yearMonth, yearMonth))
    .get();
  return {
    monthClosed: month?.status === "closed",
    fixedExpensesGenerated: month?.fixedExpensesGenerated ?? false,
  };
}
