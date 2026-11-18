import { periodLockError, saleDateError } from "../sales/sale-rules";
import type { CivilDate } from "../time/civil-date";
import { EXPENSE_TEXTS, type ExpensePaymentMeans } from "./expenses";

/**
 * FR-06 rules that decide whether a general expense can be saved. Pure functions: the server
 * passes "today" and the period status in.
 */

type PeriodStatus = { dayClosed: boolean; monthClosed: boolean };

/**
 * FR-06 "Pago com dinheiro do caixa?": only when the means is Dinheiro, and then yes by
 * default. Any other means is never paid from the till; asking for it is an error.
 */
export function resolvePaidFromTill(
  means: ExpensePaymentMeans,
  paidFromTill: boolean | undefined,
): { paidFromTill: boolean } | { error: string } {
  if (means === "cash") return { paidFromTill: paidFromTill ?? true };
  if (paidFromTill === true) return { error: EXPENSE_TEXTS.paidFromTillOnlyCash };
  return { paidFromTill: false };
}

/** RN-15: no expense with a future payment date (the same rule and text as sales). */
export function expenseDateError(paymentDate: CivilDate, today: CivilDate): string | null {
  return saleDateError(paymentDate, today);
}

/** RN-14: no expense is created with a payment date on a closed day or in a closed month. */
export function expenseLockError(date: CivilDate, status: PeriodStatus): string | null {
  return periodLockError(date, status);
}

/** RN-14 / FR-03: an expense on a closed day or month cannot be edited or deleted. */
export function expenseChangeLockError(date: CivilDate, status: PeriodStatus): string | null {
  return periodLockError(date, status, "para alterar ou excluir esta despesa.");
}
