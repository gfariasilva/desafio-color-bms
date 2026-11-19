import { z } from "zod";

/**
 * Months (spec §6.1 "Mês"): a month is the string "YYYY-MM", like a civil date without the
 * day (RN-15). Pure calendar math in UTC, so no time zone can shift the result.
 * `monthOf(date)` (sales/sale-rules) gives the month of a civil date.
 */

/** A calendar month in the format "YYYY-MM". */
export type YearMonth = string;

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** True when `value` is a real month in the format "YYYY-MM". */
export function isYearMonth(value: string): value is YearMonth {
  return YEAR_MONTH_PATTERN.test(value);
}

/** A Zod schema for "YYYY-MM" with a pt-BR message. */
export const yearMonthSchema = (message: string) =>
  z.string({ message }).refine(isYearMonth, { message });

function parseYearMonth(yearMonth: YearMonth, caller: string): [number, number] {
  if (!isYearMonth(yearMonth)) {
    throw new RangeError(`${caller} expects "YYYY-MM", received "${yearMonth}"`);
  }
  const [year, month] = yearMonth.split("-").map(Number) as [number, number];
  return [year, month];
}

/**
 * Adds (or, with a negative `count`, subtracts) whole months.
 *
 * @example addMonths("2026-12", 1) // "2027-01"
 */
export function addMonths(yearMonth: YearMonth, count: number): YearMonth {
  const [year, month] = parseYearMonth(yearMonth, "addMonths");
  const shifted = new Date(Date.UTC(year, month - 1 + count, 1));
  return shifted.toISOString().slice(0, 7);
}

/**
 * The number of the month's last day (28–31).
 *
 * @example lastDayOfMonth("2028-02") // 29
 */
export function lastDayOfMonth(yearMonth: YearMonth): number {
  const [year, month] = parseYearMonth(yearMonth, "lastDayOfMonth");
  // Day 0 of the next month is the last day of this month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
