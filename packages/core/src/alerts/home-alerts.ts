import { z } from "zod";
import { addDays, daysBetween, type CivilDate } from "../time/civil-date";

/**
 * FR-27: the alerts of Início. Each one links to the screen that resolves it:
 *
 * | Alerta             | Condição                                                          |
 * | Conta a vencer     | Fixed expense pending, due from today to today + N days (FR-33)   |
 * | Conta vencida      | Fixed expense pending, due before today                           |
 * | Dia não fechado    | A day before today with movement (A-15) still open                |
 * | Diferença de caixa | In the last closing, |diferença| > the configured limit (A-17)    |
 * | Backup pendente    | An export or backup failed in the queue (FR-30, §7)               |
 *
 * With none of them, Início shows "Tudo em dia".
 */

export type FixedExpenseDueAlert = "overdue" | "due_soon";

/**
 * FR-27: whether a pending fixed expense is "vencida" (due before today) or "a vencer" (due
 * from today to today + `dueSoonDays`, both included; default 3, FR-33). A bill without a due
 * date (Q-05) is neither. Only call it for **pending** bills: paid and dismissed never alert.
 */
export function fixedExpenseDueAlert(
  dueDate: CivilDate | null,
  today: CivilDate,
  dueSoonDays: number,
): FixedExpenseDueAlert | null {
  if (dueDate === null) return null;
  if (dueDate < today) return "overdue";
  if (dueDate <= addDays(today, dueSoonDays)) return "due_soon";
  return null;
}

/** FR-27: "vence hoje", "vence amanhã", "vence em 3 dias", "venceu ontem", "venceu há 2 dias". */
export function dueAlertText(dueDate: CivilDate, today: CivilDate): string {
  const days = daysBetween(today, dueDate);
  if (days === 0) return "vence hoje";
  if (days === 1) return "vence amanhã";
  if (days > 1) return `vence em ${days} dias`;
  if (days === -1) return "venceu ontem";
  return `venceu há ${-days} dias`;
}

/**
 * FR-27 "Diferença de caixa" (A-17): the last closing's |diferença| is above the configured
 * limit. With the default limit R$ 0,00, any surplus or shortage alerts.
 */
export function isCashDifferenceAlert(differenceCents: number, limitCents: number): boolean {
  return Math.abs(differenceCents) > limitCents;
}

/** A pending fixed expense in the "a vencer" or "vencida" alert. */
export const alertBillSchema = z.object({
  id: z.number().int().positive(),
  /** The template's label or the one-off bill's name. */
  label: z.string(),
  /** "YYYY-MM": the "Contas do mês" page that pays it. */
  referenceMonth: z.string(),
  dueDate: z.string(),
  expectedAmountCents: z.number().int().nullable(),
});
export type AlertBill = z.infer<typeof alertBillSchema>;

/** Response of GET /api/alerts (FR-27): the alerts read from the database. */
export const homeAlertsResponseSchema = z.object({
  /** Today in São Paulo, by the server's clock (RN-15). */
  today: z.string(),
  /** FR-33: the "a vencer" window in days. */
  dueSoonDays: z.number().int(),
  /** Conta vencida: oldest due date first. */
  overdueBills: z.array(alertBillSchema),
  /** Conta a vencer: soonest due date first. */
  dueSoonBills: z.array(alertBillSchema),
  /** Dia não fechado: oldest first. */
  unclosedDays: z.array(z.string()),
  /** Diferença de caixa: the last closing, when its |diferença| is above the limit. */
  cashDifference: z
    .object({
      date: z.string(),
      differenceCents: z.number().int(),
      limitCents: z.number().int(),
    })
    .nullable(),
});
export type HomeAlertsResponse = z.infer<typeof homeAlertsResponseSchema>;

/** Everything Início checks for FR-27. */
export interface HomeAlertSources {
  alerts: HomeAlertsResponse;
  /** Backup pendente: failed items of the export queue (FR-30, FR-31). */
  failedExports: number;
  /** #25/#20: no OneDrive folder in real use, so nothing is backed up. */
  oneDriveNotConfigured: boolean;
  /** #26: startup checks in error (e.g. the PC clock is wrong). */
  startupErrors: number;
}

/** FR-27: how many alerts are active (each failed export counts); 0 means "Tudo em dia". */
export function homeAlertCount(sources: HomeAlertSources): number {
  const { alerts } = sources;
  return (
    alerts.overdueBills.length +
    alerts.dueSoonBills.length +
    alerts.unclosedDays.length +
    (alerts.cashDifference ? 1 : 0) +
    sources.failedExports +
    (sources.oneDriveNotConfigured ? 1 : 0) +
    sources.startupErrors
  );
}
