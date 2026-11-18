import type { CivilDate } from "../time/civil-date";

/**
 * RN-07 (the sangrias term of expected cash): Σ sangrias of the date. Never stored (spec §6.3).
 * Sangrias are internal cash movements: no expense total and no monthly balance reads them
 * (RN-08, RN-09, RN-10).
 */
export function cashWithdrawalsOfDayCents(
  rows: readonly { date: CivilDate; amountCents: number }[],
  date: CivilDate,
): number {
  return rows.filter((row) => row.date === date).reduce((total, row) => total + row.amountCents, 0);
}
