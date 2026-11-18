import { isCivilDate, TIME_ZONE, type CivilDate } from "../time/civil-date";

/**
 * Formats a civil date ("YYYY-MM-DD") as "dd/mm/aaaa". Pure string work: no Date, no time zone.
 *
 * @example formatCivilDate("2026-11-18") // "18/11/2026"
 */
export function formatCivilDate(date: CivilDate): string {
  if (!isCivilDate(date)) {
    throw new RangeError(`formatCivilDate expects "YYYY-MM-DD", received "${date}"`);
  }
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
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
