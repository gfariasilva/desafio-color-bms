import { formatCivilDate, formatYearMonth } from "../format/date";
import { canHaveCardFee, type MachineUsage } from "../payments/payment-methods";
import type { CivilDate } from "../time/civil-date";

/**
 * FR-01 rules that decide whether a sale can be saved: the date (RN-15), the lock of closed
 * days and months (RN-14), the card machine and the installments. Pure functions: the server
 * passes "today" and the period status in.
 */

/** The fields of a payment method these rules read. */
interface MethodRule {
  name: string;
  machineUsage: MachineUsage;
  allowsInstallments: boolean;
}

/** RN-15: no entry with a future date. Civil dates "YYYY-MM-DD" compare correctly as text. */
export function saleDateError(date: CivilDate, today: CivilDate): string | null {
  return date > today ? "Não é possível registrar lançamentos com data futura." : null;
}

/** The month ("YYYY-MM") a civil date belongs to (spec §6.1 "Mês"). */
export function monthOf(date: CivilDate): string {
  return date.slice(0, 7);
}

/**
 * RN-14: nothing is created, edited or deleted on a closed day or in a closed month.
 * A closed month is reported first: the day can only be reopened after the month (RN-14).
 * `suffix` says what the owner can do once the period is reopened.
 */
export function periodLockError(
  date: CivilDate,
  status: { dayClosed: boolean; monthClosed: boolean },
  suffix = "para registrar ou alterar lançamentos nessa data.",
): string | null {
  if (status.monthClosed) {
    return `O mês ${formatYearMonth(monthOf(date))} está fechado. Reabra o mês e o dia ${suffix}`;
  }
  if (status.dayClosed) {
    return `O dia ${formatCivilDate(date)} está fechado. Reabra o dia ${suffix}`;
  }
  return null;
}

/**
 * RN-14 / FR-03: a sale on a closed day or in a closed month cannot be edited or deleted; the
 * message suggests reopening (FR-09) or registering a refund (FR-04) instead.
 */
export function saleChangeLockError(
  date: CivilDate,
  status: { dayClosed: boolean; monthClosed: boolean },
): string | null {
  return periodLockError(date, status, "para alterar esta venda ou registre um estorno.");
}

/**
 * FR-01 "Maquininha": required for Débito and Crédito, optional for PIX, not applicable to
 * Dinheiro and Boleto. Read from the method's `machineUsage`, never from its name.
 */
export function saleMachineError(method: MethodRule, cardMachineId: number | null): string | null {
  if (method.machineUsage === "required" && cardMachineId === null) {
    return "Escolha a maquininha.";
  }
  if (method.machineUsage === "not_applicable" && cardMachineId !== null) {
    return `${method.name} não usa maquininha.`;
  }
  return null;
}

/**
 * FR-01 "Parcelas": only for methods that allow installments (Crédito), 1 by default.
 * Other methods store no installments; sending 1 for them is harmless.
 */
export function resolveInstallments(
  method: MethodRule,
  installments: number | null | undefined,
): { installments: number | null } | { error: string } {
  if (method.allowsInstallments) return { installments: installments ?? 1 };
  if (installments === null || installments === undefined || installments === 1) {
    return { installments: null };
  }
  return { error: `${method.name} não permite parcelas.` };
}

/** RN-01: a sale without installments is looked up in the fee table as 1x. */
export function feeInstallments(installments: number | null): number {
  return installments ?? 1;
}

/**
 * RN-02: only a sale paid through a card machine has a fee. Dinheiro, Boleto and PIX without
 * a machine have rate 0 and fee 0.
 */
export function needsCardFee(
  method: Pick<MethodRule, "machineUsage">,
  cardMachineId: number | null,
): boolean {
  return canHaveCardFee(method) && cardMachineId !== null;
}

/** FR-01: the text shown when RN-01 finds no fee (verbatim from the spec). */
export function missingFeeMessage(
  cardMachineName: string,
  paymentMethodName: string,
  installments: number,
): string {
  return `Cadastre a taxa de ${cardMachineName} / ${paymentMethodName} / ${installments}x antes de registrar esta venda`;
}
