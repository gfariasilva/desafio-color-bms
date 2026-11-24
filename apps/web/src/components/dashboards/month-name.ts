import { formatYearMonthLong } from "@color-bms/core";

/** "2026-10" → "Outubro" (capitalised, without the year), for headers and notes. */
export function monthName(yearMonth: string): string {
  const name = formatYearMonthLong(yearMonth).split(" de ")[0] ?? "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}
