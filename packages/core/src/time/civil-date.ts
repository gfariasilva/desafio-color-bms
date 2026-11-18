/**
 * Civil dates (RN-15): the business "day" is the calendar day in America/Sao_Paulo.
 *
 * - A civil date is a string "YYYY-MM-DD". It is NOT a moment in time, so we never turn it
 *   into a JS Date with `new Date("YYYY-MM-DD")` (that parses as UTC midnight, which is the
 *   previous day in São Paulo).
 * - An instant (e.g. `created_at`) is a moment in time, stored as an ISO-8601 UTC string.
 */

export const TIME_ZONE = "America/Sao_Paulo";

/** A calendar date in the format "YYYY-MM-DD". */
export type CivilDate = string;

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `value` is a real calendar date in the format "YYYY-MM-DD". */
export function isCivilDate(value: string): value is CivilDate {
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  // Day 0 of the next month is the last day of this month. Date.UTC avoids any time zone.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

// "en-CA" formats dates as YYYY-MM-DD, which is exactly the civil-date format.
const civilDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The civil date of an instant, as seen in São Paulo. */
export function toCivilDate(instant: Date): CivilDate {
  return civilDateFormatter.format(instant);
}

/** Today's civil date in São Paulo. Pass `now` in tests to make them deterministic. */
export function todayCivilDate(now: Date = new Date()): CivilDate {
  return toCivilDate(now);
}
