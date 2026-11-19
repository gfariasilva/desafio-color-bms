import { z } from "zod";
import { INVALID_BODY } from "../catalog/categories";
import { formatCents } from "../format/currency";
import { MAX_SALE_CENTS } from "../format/money-input";
import { civilDateSchema } from "../payments/card-fees";

/**
 * FR-08: the cash closing ("fechamento de caixa") of a day: the owner counts the cash in the
 * till, the system compares it with the expected cash (RN-07) and the day is locked (RN-14).
 * Expected cash and difference are **stored** at closing time as history (spec §6.3).
 */

export const CASH_CLOSING_NOTE_MAX = 200;

/** HTTP 409 code: the day has no movement, so it does not need closing (A-15). */
export const NO_MOVEMENT_CODE = "no_movement";

export const DAY_STATUSES = ["open", "closed"] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

export const DAY_STATUS_LABELS: Record<DayStatus, string> = { open: "Aberto", closed: "Fechado" };

/** An amount of cash in the till: integer cents, from R$ 0,00 to R$ 999.999,99. */
function cashAmountSchema(requiredMessage: string) {
  return z
    .number({ message: requiredMessage })
    .int("Valor inválido.")
    .min(0, "O valor não pode ser negativo.")
    .max(MAX_SALE_CENTS, `O valor máximo é ${formatCents(MAX_SALE_CENTS)}.`);
}

/**
 * Body of POST /api/days/:date/close. The client sends only what the owner typed; the server
 * computes the expected cash and the difference itself (RN-07).
 */
export const closeDayInputSchema = z.object(
  {
    /** Troco inicial: pre-filled from the last count (A-12), required on the first day. */
    openingCashCents: cashAmountSchema("Informe o troco inicial."),
    /** Dinheiro contado. */
    countedCashCents: cashAmountSchema("Informe o dinheiro contado."),
    /** Optional, e.g. to explain a difference (FR-08). */
    note: z
      .string({ message: "Observação inválida." })
      // Trimmed first, so spaces around the text never count toward the limit.
      .trim()
      .max(CASH_CLOSING_NOTE_MAX, `A observação pode ter até ${CASH_CLOSING_NOTE_MAX} caracteres.`)
      .nullable()
      .optional()
      // An empty note is no note.
      .transform((text) => (text ? text : text === undefined ? undefined : null)),
  },
  INVALID_BODY,
);
export type CloseDayInput = z.input<typeof closeDayInputSchema>;
export type ParsedCloseDayInput = z.output<typeof closeDayInputSchema>;

/** Params of the routes under /api/days/:date. */
export const dayParamsSchema = z.object({ date: civilDateSchema("Data inválida.") });

/** The closing stored on a closed day (spec §6.1 "Dia"). */
export const cashClosingSchema = z.object({
  openingCashCents: z.number().int(),
  expectedCashCents: z.number().int(),
  countedCashCents: z.number().int(),
  /** RN-07: counted − expected (> 0 sobra, < 0 falta). */
  differenceCents: z.number().int(),
  note: z.string().nullable(),
  /** ISO-8601 UTC instant. */
  closedAt: z.string(),
});
export type CashClosing = z.infer<typeof cashClosingSchema>;

/**
 * Response of GET /api/days/:date/cash-closing and of POST /api/days/:date/close: what the
 * closing screen shows (FR-08).
 */
export const dayCashClosingResponseSchema = z.object({
  date: civilDateSchema("Data inválida."),
  status: z.enum(DAY_STATUSES),
  /** A-15: any sale, refund, paid expense or sangria on the date. */
  hasMovement: z.boolean(),
  /** Why the day cannot be closed now (pt-BR), or null. */
  blocked: z.string().nullable(),
  /** A-12: the counted cash of the latest closing before this date; null on the first day. */
  suggestedOpeningCashCents: z.number().int().nullable(),
  /** The date of that closing. */
  suggestedFrom: z.string().nullable(),
  /** RN-07 terms, computed from the day's records. */
  cashSalesCents: z.number().int(),
  tillExpensesCents: z.number().int(),
  withdrawalsCents: z.number().int(),
  /** The stored closing when the day is closed. */
  closing: cashClosingSchema.nullable(),
});
export type DayCashClosingResponse = z.infer<typeof dayCashClosingResponseSchema>;

/** Response of GET /api/days/unclosed (FR-27 "Dia não fechado"), oldest first. */
export const unclosedDaysResponseSchema = z.object({ days: z.array(z.string()) });
export type UnclosedDaysResponse = z.infer<typeof unclosedDaysResponseSchema>;
