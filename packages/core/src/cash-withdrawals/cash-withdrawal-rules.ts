import { periodLockError, saleDateError } from "../sales/sale-rules";
import type { CivilDate } from "../time/civil-date";

/**
 * FR-07 rules that decide whether a sangria can be saved. Pure functions: the server passes
 * "today" and the period status in.
 */

type PeriodStatus = { dayClosed: boolean; monthClosed: boolean };

/** RN-15: no sangria with a future date (the same rule and text as sales and expenses). */
export function cashWithdrawalDateError(date: CivilDate, today: CivilDate): string | null {
  return saleDateError(date, today);
}

/** RN-14: no sangria is created on a closed day or in a closed month. */
export function cashWithdrawalLockError(date: CivilDate, status: PeriodStatus): string | null {
  return periodLockError(date, status);
}

/** RN-14: a sangria on a closed day or month cannot be edited or deleted. */
export function cashWithdrawalChangeLockError(
  date: CivilDate,
  status: PeriodStatus,
): string | null {
  return periodLockError(date, status, "para alterar ou excluir esta sangria.");
}
