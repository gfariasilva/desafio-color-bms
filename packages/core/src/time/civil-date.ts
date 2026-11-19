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

/**
 * Splits a civil date into [year, month, day] numbers, or throws a RangeError naming `caller`.
 *
 * @example parseCivilDate("2026-11-18", "myFn") // [2026, 11, 18]
 */
export function parseCivilDate(date: CivilDate, caller: string): [number, number, number] {
  if (!isCivilDate(date)) {
    throw new RangeError(`${caller} expects "YYYY-MM-DD", received "${date}"`);
  }
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return [year, month, day];
}

/**
 * Adds (or, with a negative `days`, subtracts) whole days to a civil date.
 * Pure calendar math in UTC, so no time zone can shift the result.
 *
 * @example addDays("2026-12-31", 1) // "2027-01-01"
 */
export function addDays(date: CivilDate, days: number): CivilDate {
  const [year, month, day] = parseCivilDate(date, "addDays");
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

// Wall-clock parts of an instant in São Paulo, used to find the UTC offset.
const wallClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

/** São Paulo's UTC offset at `instantMs`, in milliseconds (e.g. −3 h = −10 800 000). */
function saoPauloOffsetMs(instantMs: number): number {
  const parts: Record<string, number> = {};
  for (const part of wallClockFormatter.formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const wallClockAsUtc = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return wallClockAsUtc - (instantMs - (instantMs % 1000));
}

/**
 * São Paulo's UTC offset at `instant`, in minutes (−180 for UTC−03:00). Used to compare the
 * PC's time zone with São Paulo's (#26 startup checks).
 */
export function saoPauloOffsetMinutes(instant: Date): number {
  return Math.round(saoPauloOffsetMs(instant.getTime()) / 60_000);
}

/**
 * The UTC instant (ISO-8601) when a civil date starts in São Paulo (RN-15).
 * Uses the real time zone rules from Intl, so it is right even for the years when Brazil
 * had daylight saving time. Use it to filter instants (e.g. audit `at`) by business day:
 * `start(from) <= at < start(addDays(to, 1))`.
 *
 * @example civilDayStartInstant("2026-11-18") // "2026-11-18T03:00:00.000Z"
 */
export function civilDayStartInstant(date: CivilDate): string {
  const [year, month, day] = parseCivilDate(date, "civilDayStartInstant");
  const utcMidnight = Date.UTC(year, month - 1, day);
  // First guess with the offset at UTC midnight, then refine with the offset at the guess.
  const first = utcMidnight - saoPauloOffsetMs(utcMidnight);
  const refined = utcMidnight - saoPauloOffsetMs(first);
  // On a day whose midnight did not exist (clocks jumped 00:00 → 01:00 when daylight saving
  // time started), `refined` lands on the previous day; the day then starts at `first`.
  const start = toCivilDate(new Date(refined)) === date ? refined : first;
  return new Date(start).toISOString();
}
