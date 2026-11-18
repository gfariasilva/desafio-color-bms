import type { CivilDate } from "../time/civil-date";
import type { ExpensePaymentMeans, ExpenseStatus, ExpenseType } from "./expenses";

/**
 * Expense totals. Never stored (spec §6.3): always computed from the rows. Integer cents.
 */

/** The fields of an expense these totals read (general or fixed). */
export interface ExpenseTotalsRow {
  type: ExpenseType;
  status: ExpenseStatus;
  amountCents: number | null;
  paymentDate: CivilDate | null;
  paymentMeans: ExpensePaymentMeans | null;
  paidFromTill: boolean;
}

/**
 * RN-08: general expenses of the month = Σ amount of the `general` expenses whose **payment
 * date** falls in the month ("YYYY-MM"). Fixed expenses are RN-09.
 */
export function generalExpensesOfMonthCents(
  rows: readonly ExpenseTotalsRow[],
  yearMonth: string,
): number {
  return rows
    .filter((row) => row.type === "general" && row.paymentDate?.slice(0, 7) === yearMonth)
    .reduce((total, row) => total + (row.amountCents ?? 0), 0);
}

/**
 * RN-07 (the expense term of expected cash): Σ expenses (general and fixed) **paid** in
 * Dinheiro with "pago do caixa = sim" on the date. PIX, card, etc. never touch the till.
 */
export function cashPaidFromTillCents(rows: readonly ExpenseTotalsRow[], date: CivilDate): number {
  return rows
    .filter(
      (row) =>
        row.status === "paid" &&
        row.paymentDate === date &&
        row.paymentMeans === "cash" &&
        row.paidFromTill,
    )
    .reduce((total, row) => total + (row.amountCents ?? 0), 0);
}
