import { isCivilDate, parseCivilDate, type CivilDate } from "../time/civil-date";
import { isYearMonth, type YearMonth } from "../time/year-month";

/**
 * Spec §7.2: where the spreadsheets go inside the OneDrive folder.
 *
 * ```
 * <pasta configurada>/2026/11 - Novembro/Diária 2026-11-18.xlsx
 * <pasta configurada>/2026/11 - Novembro/Mensal 2026-11.xlsx
 * ```
 */

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

/**
 * §7.2: the month's folder: "11 - Novembro".
 *
 * @example monthFolderName("2026-03") // "03 - Março"
 */
export function monthFolderName(yearMonth: YearMonth): string {
  if (!isYearMonth(yearMonth)) {
    throw new RangeError(`monthFolderName expects "YYYY-MM", received "${yearMonth}"`);
  }
  const month = yearMonth.slice(5, 7);
  return `${month} - ${MONTH_NAMES[Number(month) - 1]}`;
}

/** FR-28: "Diária 2026-11-18.xlsx". */
export function dailySpreadsheetFileName(date: CivilDate): string {
  if (!isCivilDate(date)) {
    throw new RangeError(`dailySpreadsheetFileName expects "YYYY-MM-DD", received "${date}"`);
  }
  return `Diária ${date}.xlsx`;
}

/**
 * FR-28 / §7.2: the daily spreadsheet's path inside the OneDrive folder, as path segments
 * (the server joins them with the right separator): year, month folder, file name.
 */
export function dailySpreadsheetPath(date: CivilDate): [string, string, string] {
  const fileName = dailySpreadsheetFileName(date);
  return [date.slice(0, 4), monthFolderName(date.slice(0, 7)), fileName];
}

/** FR-29: "Mensal 2026-11.xlsx". */
export function monthlySpreadsheetFileName(yearMonth: YearMonth): string {
  if (!isYearMonth(yearMonth)) {
    throw new RangeError(`monthlySpreadsheetFileName expects "YYYY-MM", received "${yearMonth}"`);
  }
  return `Mensal ${yearMonth}.xlsx`;
}

/**
 * FR-29 / §7.2: the monthly spreadsheet's path inside the OneDrive folder, as path segments:
 * year, month folder, file name (next to the month's daily files).
 */
export function monthlySpreadsheetPath(yearMonth: YearMonth): [string, string, string] {
  const fileName = monthlySpreadsheetFileName(yearMonth);
  return [yearMonth.slice(0, 4), monthFolderName(yearMonth), fileName];
}

const MS_PER_DAY = 86_400_000;
/** Excel's day 0 (its 1900 calendar wrongly has 29/02/1900, so day 0 is 30/12/1899). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * §7.3: a civil date as Excel's date number (shown as dd/mm/aaaa with the date format), so the
 * owner can sort and filter by date. Pure calendar math in UTC: no time zone can shift it.
 * Valid from 01/03/1900, far before any shop date.
 *
 * @example excelDateSerial("2026-11-18") // 46344
 */
export function excelDateSerial(date: CivilDate): number {
  const [year, month, day] = parseCivilDate(date, "excelDateSerial");
  return (Date.UTC(year, month - 1, day) - EXCEL_EPOCH_MS) / MS_PER_DAY;
}
