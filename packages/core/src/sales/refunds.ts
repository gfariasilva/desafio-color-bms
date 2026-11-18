import { z } from "zod";
import { formatCents } from "../format/currency";
import { INVALID_BODY } from "../catalog/categories";
import type { CivilDate } from "../time/civil-date";
import { calculateSaleAmounts } from "./sale-amounts";
import { periodLockError } from "./sale-rules";
import { saleAmountCentsSchema } from "./sales";

/**
 * FR-04 / RN-04: refunds ("estornos"). A refund is a row of the sales table with
 * `type: "refund"`, dated **today**, linked to the original sale, with negative amounts and
 * the same tab, method, machine, installments and rate as the original. The original sale
 * never changes.
 */

export const REFUND_REASON_MAX = 200;

/** HTTP 409 code: the refunds of a sale would add up to more than its gross value (RN-04). */
export const REFUND_EXCEEDS_SALE_CODE = "refund_exceeds_sale";

export const REFUND_TEXTS = {
  reasonRequired: "Informe o motivo do estorno.",
  refundOfRefund: "Um estorno não pode ser estornado.",
  saleFromToday: "Venda de hoje: edite ou exclua a venda em vez de estornar.",
  fullyRefunded: "Esta venda já foi estornada por inteiro.",
  notEditable: "Estornos não podem ser editados. Exclua o estorno e registre outro.",
} as const;

/** The three amounts stored on a refund row, all ≤ 0. */
export interface RefundAmounts {
  grossCents: number;
  feeCents: number;
  netCents: number;
}

/**
 * RN-04: gross = −refunded value; fee = −round(refunded × original rate ÷ 100; 2), rounded on
 * the **absolute** value (half-up), then negated; net = gross − fee.
 * `refundCents` is the positive value being refunded.
 */
export function calculateRefundAmounts(refundCents: number, ratePpm: number): RefundAmounts {
  if (!Number.isSafeInteger(refundCents) || refundCents <= 0) {
    throw new RangeError(`calculateRefundAmounts expects positive cents, received ${refundCents}`);
  }
  // Round the positive value, then negate: never round a negative number (backlog #6).
  const { feeCents } = calculateSaleAmounts(refundCents, ratePpm);
  const grossCents = -refundCents;
  const refundFeeCents = feeCents === 0 ? 0 : -feeCents; // never −0
  return { grossCents, feeCents: refundFeeCents, netCents: grossCents - refundFeeCents };
}

/**
 * RN-14: a refund on a closed day or in a closed month cannot be deleted. Unlike a sale's
 * lock message (FR-03), it never suggests a refund: a refund cannot be refunded.
 */
export function refundChangeLockError(
  date: CivilDate,
  status: { dayClosed: boolean; monthClosed: boolean },
): string | null {
  return periodLockError(date, status, "para excluir este estorno.");
}

/** RN-04: how much of a sale can still be refunded. `refundedCents` is positive. */
export function refundableCents(originalGrossCents: number, refundedCents: number): number {
  return Math.max(0, originalGrossCents - refundedCents);
}

/** RN-04: the sum of the refunds of a sale cannot pass its gross value. */
export function refundLimitError(
  originalGrossCents: number,
  refundedCents: number,
  refundCents: number,
): string | null {
  const left = refundableCents(originalGrossCents, refundedCents);
  if (refundCents <= left) return null;
  if (left === 0) return REFUND_TEXTS.fullyRefunded;
  return `O estorno passa do valor da venda: restam ${formatCents(left)} para estornar.`;
}

/**
 * FR-04 / glossary "Estorno": only a sale from an **earlier day** is refunded. A sale from
 * today is corrected with edit or delete (FR-03).
 */
export function refundDateError(saleDate: CivilDate, today: CivilDate): string | null {
  return saleDate >= today ? REFUND_TEXTS.saleFromToday : null;
}

/** Body of POST /api/sales/:id/refunds (FR-04). The reason is required. */
export const createRefundInputSchema = z.object(
  {
    refundCents: saleAmountCentsSchema,
    reason: z
      .string({ message: REFUND_TEXTS.reasonRequired })
      .trim()
      .min(1, REFUND_TEXTS.reasonRequired)
      .max(REFUND_REASON_MAX, `O motivo pode ter até ${REFUND_REASON_MAX} caracteres.`),
  },
  INVALID_BODY,
);
export type CreateRefundInput = z.input<typeof createRefundInputSchema>;
export type ParsedCreateRefundInput = z.output<typeof createRefundInputSchema>;
