import { parseCivilDate, TIME_ZONE, type CivilDate } from "../time/civil-date";

/**
 * Formats a civil date ("YYYY-MM-DD") as "dd/mm/aaaa". Pure string work: no Date, no time zone.
 *
 * @example formatCivilDate("2026-11-18") // "18/11/2026"
 */
export function formatCivilDate(date: CivilDate): string {
  const [year, month, day] = parseCivilDate(date, "formatCivilDate");
  const pad = (value: number, length: number) => String(value).padStart(length, "0");
  return `${pad(day, 2)}/${pad(month, 2)}/${pad(year, 4)}`;
}

const instantFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Formats an instant (ISO-8601 UTC string or Date) as "dd/mm/aaaa HH:mm" in São Paulo time.
 *
 * @example formatInstant("2026-11-18T22:03:00Z") // "18/11/2026 19:03"
 */
export function formatInstant(instant: string | Date): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`formatInstant received an invalid instant: "${String(instant)}"`);
  }
  // Intl's pt-BR output is "18/11/2026, 19:03"; we drop the comma.
  return instantFormatter.format(date).replace(",", "");
}

/**
 * Formats a month ("YYYY-MM") as "mm/aaaa".
 *
 * @example formatYearMonth("2026-11") // "11/2026"
 */
export function formatYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  return `${month}/${year}`;
}

/**
 * The São Paulo wall-clock time of an instant, "HH:mm", e.g. for the list of today's sales.
 *
 * @example formatInstantTime("2026-11-18T22:03:00Z") // "19:03"
 */
export function formatInstantTime(instant: string | Date): string {
  return formatInstant(instant).slice(-5);
}

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

/**
 * Formats a month ("YYYY-MM") with its pt-BR name, e.g. for a page title.
 *
 * @example formatYearMonthLong("2026-11") // "novembro de 2026"
 */
export function formatYearMonthLong(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  const name = MONTH_NAMES[Number(month) - 1];
  if (!year || !name)
    throw new RangeError(`formatYearMonthLong expects "YYYY-MM", received "${yearMonth}"`);
  return `${name} de ${year}`;
}
