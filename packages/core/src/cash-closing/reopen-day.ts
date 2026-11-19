import { z } from "zod";
import { INVALID_BODY } from "../catalog/categories";
import { formatCivilDate, formatYearMonth } from "../format/date";
import { monthOf } from "../sales/sale-rules";
import type { CivilDate } from "../time/civil-date";

/**
 * FR-09: reopening a closed day ("Reabrir dia"). The owner confirms and gives a reason; the
 * day goes back to open, the previous closing stays in the audit log (FR-18) and a new closing
 * (FR-08) is required. RN-14: only while the month is open.
 */

export const DAY_REOPEN_REASON_MAX = 200;

/** HTTP 409 code: the day's month is closed; it must be reopened first (FR-17). */
export const MONTH_CLOSED_CODE = "month_closed";

/** HTTP 409 code: the day is not closed, so there is nothing to reopen. */
export const DAY_NOT_CLOSED_CODE = "day_not_closed";

export const REOPEN_DAY_TEXTS = {
  reasonRequired: "Informe o motivo da reabertura.",
} as const;

/** Body of POST /api/days/:date/reopen. The reason is required (spec §2, FR-09). */
export const reopenDayInputSchema = z.object(
  {
    reason: z
      .string({ message: REOPEN_DAY_TEXTS.reasonRequired })
      .trim()
      .min(1, REOPEN_DAY_TEXTS.reasonRequired)
      .max(DAY_REOPEN_REASON_MAX, `O motivo pode ter até ${DAY_REOPEN_REASON_MAX} caracteres.`),
  },
  INVALID_BODY,
);
export type ReopenDayInput = z.input<typeof reopenDayInputSchema>;
export type ParsedReopenDayInput = z.output<typeof reopenDayInputSchema>;

/** Why a day cannot be reopened; the server maps `kind` to the HTTP code. */
export interface ReopenDayBlock {
  kind: "month_closed" | "not_closed";
  message: string;
}

/**
 * FR-09: can this day be reopened now? In order:
 * - RN-14: "Um dia só pode ser reaberto se o mês estiver aberto" (reopen the month, FR-17);
 * - only a closed day can be reopened.
 */
export function reopenDayBlock(
  date: CivilDate,
  status: { dayClosed: boolean; monthClosed: boolean },
): ReopenDayBlock | null {
  if (status.monthClosed) {
    return {
      kind: "month_closed",
      message: `O mês ${formatYearMonth(monthOf(date))} está fechado. Reabra o mês antes de reabrir o dia.`,
    };
  }
  if (!status.dayClosed) {
    return { kind: "not_closed", message: `O dia ${formatCivilDate(date)} não está fechado.` };
  }
  return null;
}
