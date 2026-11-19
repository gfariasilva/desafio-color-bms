import { formatCents } from "../format/currency";
import { formatCivilDate, formatYearMonth } from "../format/date";
import { monthOf } from "../sales/sale-rules";
import type { CivilDate } from "../time/civil-date";

/**
 * FR-08 / RN-07: the cash closing ("fechamento de caixa"). Pure functions on integer cents:
 * the server passes in the day's totals, "today" and the period status.
 */

/** The terms of RN-07, all in integer cents. */
export interface ExpectedCashTerms {
  /** Troco inicial: cash already in the till when the day started (A-12). */
  openingCashCents: number;
  /** Σ sales in Dinheiro of the day; cash refunds are already negative. */
  cashSalesCents: number;
  /** Σ expenses (general and fixed) paid in Dinheiro with "pago do caixa = sim" on the day. */
  tillExpensesCents: number;
  /** Σ sangrias of the day. */
  withdrawalsCents: number;
}

/**
 * RN-07: Dinheiro esperado = Troco inicial + Σ vendas em Dinheiro − Σ despesas pagas do
 * caixa − Σ sangrias. It may be negative (more cash out than in); it is never clamped.
 */
export function expectedCashCents(terms: ExpectedCashTerms): number {
  return (
    terms.openingCashCents + terms.cashSalesCents - terms.tillExpensesCents - terms.withdrawalsCents
  );
}

/** RN-07: Diferença = Dinheiro contado − Dinheiro esperado (> 0 sobra, < 0 falta). */
export function cashDifferenceCents(countedCents: number, expectedCents: number): number {
  return countedCents - expectedCents;
}

/** FR-08: the difference in words: "Sobra de R$ 1,00", "Falta de R$ 5,00" or "Sem diferença". */
export function cashDifferenceLabel(differenceCents: number): string {
  if (differenceCents > 0) return `Sobra de ${formatCents(differenceCents)}`;
  if (differenceCents < 0) return `Falta de ${formatCents(-differenceCents)}`;
  return "Sem diferença";
}

/** Why a day cannot be closed; the server maps `kind` to the HTTP status. */
export interface CloseDayBlock {
  kind: "future" | "month_closed" | "day_closed" | "no_movement";
  message: string;
}

/**
 * FR-08: can this day be closed now? In order:
 * - RN-15: not a future day (today can be closed at the end of the day);
 * - RN-14: not in a closed month (reported first, as it must be reopened first);
 * - RN-14: not already closed;
 * - A-15: only days with movement need closing.
 */
export function closeDayBlock(
  date: CivilDate,
  today: CivilDate,
  status: { dayClosed: boolean; monthClosed: boolean },
  hasMovement: boolean,
): CloseDayBlock | null {
  if (date > today) return { kind: "future", message: "Não é possível fechar um dia futuro." };
  if (status.monthClosed) {
    return {
      kind: "month_closed",
      message: `O mês ${formatYearMonth(monthOf(date))} está fechado. Reabra o mês antes.`,
    };
  }
  if (status.dayClosed) {
    return { kind: "day_closed", message: `O dia ${formatCivilDate(date)} já está fechado.` };
  }
  if (!hasMovement) {
    return {
      kind: "no_movement",
      message: "Este dia não tem movimento e não precisa ser fechado.",
    };
  }
  return null;
}
