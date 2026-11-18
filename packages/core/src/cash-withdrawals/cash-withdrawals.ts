import { z } from "zod";
import { INVALID_BODY, somethingToChange } from "../catalog/categories";
import { formatCents } from "../format/currency";
import { MAX_SALE_CENTS } from "../format/money-input";
import { civilDateSchema } from "../payments/card-fees";

/**
 * FR-07: sangrias (cash withdrawals): cash taken out of the till during the day, e.g. to the
 * bank. A sangria is **not** an expense (spec §3): it never enters the expense totals (RN-08,
 * RN-09) nor the monthly balance (RN-10); it only reduces the day's expected cash (RN-07).
 */

export const CASH_WITHDRAWAL_NOTE_MAX = 200;

/** The largest sangria: the same limit as a sale, R$ 999.999,99 (the money input's maximum). */
export const MAX_CASH_WITHDRAWAL_CENTS = MAX_SALE_CENTS;

export const CASH_WITHDRAWAL_TEXTS = {
  invalidValue: "Informe o valor da sangria, por exemplo 300,00.",
  notFound: "Sangria não encontrada.",
} as const;

const POSITIVE_MESSAGE = "Informe um valor maior que zero.";

/** The fields of a sangria the owner types (spec §6.1 "Sangria": data, valor, observação). */
const cashWithdrawalFields = {
  date: civilDateSchema("Data inválida."),
  /** Required, greater than 0, integer cents. */
  amountCents: z
    .number({ message: POSITIVE_MESSAGE })
    .int("Valor inválido.")
    .positive(POSITIVE_MESSAGE)
    .max(
      MAX_CASH_WITHDRAWAL_CENTS,
      `O valor máximo de uma sangria é ${formatCents(MAX_CASH_WITHDRAWAL_CENTS)}.`,
    ),
  /** Optional, e.g. "depósito no banco" (FR-07). */
  note: z
    .string({ message: "Observação inválida." })
    // Trimmed first, so spaces around the text never count toward the limit.
    .trim()
    .max(
      CASH_WITHDRAWAL_NOTE_MAX,
      `A observação pode ter até ${CASH_WITHDRAWAL_NOTE_MAX} caracteres.`,
    )
    .nullable()
    .optional()
    // An empty note is no note.
    .transform((text) => (text ? text : text === undefined ? undefined : null)),
};

/** Body of POST /api/cash-withdrawals. */
export const createCashWithdrawalInputSchema = z.object(cashWithdrawalFields, INVALID_BODY);
export type CreateCashWithdrawalInput = z.input<typeof createCashWithdrawalInputSchema>;
export type ParsedCreateCashWithdrawalInput = z.output<typeof createCashWithdrawalInputSchema>;

/**
 * Body of PATCH /api/cash-withdrawals/:id: any subset of the fields. The server merges it into
 * the saved sangria and checks the result like a new one.
 */
export const updateCashWithdrawalInputSchema = z
  .object(cashWithdrawalFields, INVALID_BODY)
  .partial()
  .refine(somethingToChange.check, somethingToChange.message);
export type UpdateCashWithdrawalInput = z.input<typeof updateCashWithdrawalInputSchema>;
export type ParsedUpdateCashWithdrawalInput = z.output<typeof updateCashWithdrawalInputSchema>;

/** A saved sangria. */
export const cashWithdrawalSchema = z.object({
  id: z.number().int().positive(),
  /** Civil date "YYYY-MM-DD" in São Paulo (RN-15). */
  date: z.string(),
  /** ISO-8601 UTC instant. */
  createdAt: z.string(),
  amountCents: z.number().int(),
  note: z.string().nullable(),
});
export type CashWithdrawal = z.infer<typeof cashWithdrawalSchema>;

/** Params of GET /api/days/:date/cash-withdrawals. */
export const dayCashWithdrawalsParamsSchema = z.object({ date: civilDateSchema("Data inválida.") });

/** Response of GET /api/days/:date/cash-withdrawals (FR-07). */
export const dayCashWithdrawalsResponseSchema = z.object({
  date: civilDateSchema("Data inválida."),
  /** RN-14: why the day's sangrias cannot change (closed day or month); null if open. */
  lock: z.string().nullable(),
  /** The day's sangrias, in the order they were registered. */
  withdrawals: z.array(cashWithdrawalSchema),
  /** RN-07: Σ sangrias of the day (they reduce expected cash). */
  totalCents: z.number().int(),
});
export type DayCashWithdrawalsResponse = z.infer<typeof dayCashWithdrawalsResponseSchema>;
