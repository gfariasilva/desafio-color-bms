import { z } from "zod";
import { INVALID_BODY } from "../catalog/categories";
import { formatCivilDate, formatYearMonth } from "../format/date";
import { fixedExpenseSchema } from "../fixed-expenses/fixed-expenses";
import type { CivilDate } from "../time/civil-date";
import { lastDayOfMonth, yearMonthSchema, type YearMonth } from "../time/year-month";
import { DAY_STATUSES } from "./cash-closing";

/**
 * FR-16 / FR-17: closing a month ("Fechar mês") locks every day, sale and expense of it
 * (RN-14); reopening it ("Reabrir mês") needs a confirmation and a reason, and leaves its days
 * closed. RN-14: "O mês só pode ser fechado se todos os dias com movimento estiverem fechados."
 */

export const MONTH_REOPEN_REASON_MAX = 200;

/** HTTP 409 code: some days with movement (A-15) of the month are still open (FR-16). */
export const PENDING_DAYS_CODE = "pending_days";

/** HTTP 409 code: the month is not closed, so there is nothing to reopen (FR-17). */
export const MONTH_NOT_CLOSED_CODE = "month_not_closed";

/** HTTP 409 code: the month is already closed. */
export const MONTH_ALREADY_CLOSED_CODE = "month_already_closed";

export const REOPEN_MONTH_TEXTS = {
  reasonRequired: "Informe o motivo da reabertura.",
} as const;

/** Params of the routes under /api/months/:yearMonth. */
export const monthParamsSchema = z.object({ yearMonth: yearMonthSchema("Mês inválido.") });

/** Body of POST /api/months/:yearMonth/reopen. The reason is required (spec §2, FR-17). */
export const reopenMonthInputSchema = z.object(
  {
    reason: z
      .string({ message: REOPEN_MONTH_TEXTS.reasonRequired })
      .trim()
      .min(1, REOPEN_MONTH_TEXTS.reasonRequired)
      .max(MONTH_REOPEN_REASON_MAX, `O motivo pode ter até ${MONTH_REOPEN_REASON_MAX} caracteres.`),
  },
  INVALID_BODY,
);
export type ReopenMonthInput = z.input<typeof reopenMonthInputSchema>;
export type ParsedReopenMonthInput = z.output<typeof reopenMonthInputSchema>;

/** The last civil date of a month, e.g. "2026-11" → "2026-11-30". */
export function lastDateOfMonth(yearMonth: YearMonth): CivilDate {
  return `${yearMonth}-${String(lastDayOfMonth(yearMonth)).padStart(2, "0")}`;
}

/** Why a month cannot be closed; the server maps `kind` to the HTTP code. */
export interface CloseMonthBlock {
  kind: "closed" | "not_ended" | "pending_days";
  message: string;
}

/**
 * FR-16: can this month be closed now? In order:
 * - it is already closed;
 * - decision (#14): only from its last day on, so closing never locks days still to come;
 * - RN-14: every day with movement (A-15) must be closed; the pending days are listed.
 * Pending fixed expenses never block (FR-16: "o sistema avisa, mas permite fechar").
 */
export function closeMonthBlock(
  yearMonth: YearMonth,
  today: CivilDate,
  status: { monthClosed: boolean; pendingDays: readonly CivilDate[] },
): CloseMonthBlock | null {
  const month = formatYearMonth(yearMonth);
  if (status.monthClosed) {
    return { kind: "closed", message: `O mês ${month} já está fechado.` };
  }
  const lastDate = lastDateOfMonth(yearMonth);
  if (today < lastDate) {
    return {
      kind: "not_ended",
      message: `O mês ${month} ainda não terminou. Ele pode ser fechado a partir de ${formatCivilDate(lastDate)}.`,
    };
  }
  if (status.pendingDays.length > 0) {
    const list = status.pendingDays.map(formatCivilDate).join(", ");
    const plural = status.pendingDays.length > 1;
    return {
      kind: "pending_days",
      message: `Feche ${plural ? "os dias com movimento ainda abertos" : "o dia com movimento ainda aberto"} antes de fechar o mês ${month}: ${list}.`,
    };
  }
  return null;
}

/** FR-17: only a closed month can be reopened. Returns the pt-BR message, or null. */
export function reopenMonthBlock(yearMonth: YearMonth, status: { monthClosed: boolean }) {
  return status.monthClosed ? null : `O mês ${formatYearMonth(yearMonth)} não está fechado.`;
}

/**
 * Response of GET /api/months/:yearMonth/closing and of closing / reopening it: what the
 * "Fechamento do mês" section shows (FR-16, FR-17).
 */
export const monthClosingResponseSchema = z.object({
  yearMonth: z.string(),
  status: z.enum(DAY_STATUSES),
  /** ISO-8601 UTC instant of the closing; null while open. */
  closedAt: z.string().nullable(),
  /** The month's last date: the first day it can be closed on. */
  lastDate: z.string(),
  /** RN-14: the days with movement (A-15) still open, oldest first. */
  pendingDays: z.array(z.string()),
  /** FR-16: fixed expenses of this reference month still pending (a warning, not a block). */
  pendingFixedExpenses: z.array(fixedExpenseSchema),
  /** Why the month cannot be closed now (pt-BR), or null. Null on a closed month. */
  closeBlocked: z.string().nullable(),
});
export type MonthClosingResponse = z.infer<typeof monthClosingResponseSchema>;
