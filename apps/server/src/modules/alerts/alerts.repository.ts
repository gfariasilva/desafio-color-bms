import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import {
  addDays,
  fixedExpenseDueAlert,
  isCashDifferenceAlert,
  todayCivilDate,
  type AlertBill,
  type FixedExpense,
  type HomeAlertsResponse,
} from "@color-bms/core";
import type { AppDatabase } from "../../db/client";
import { days, expenses } from "../../db/schema";
import { listUnclosedDays } from "../cash-closing/cash-closing.repository";
import { selectFixedExpenses } from "../fixed-expenses/fixed-expenses.repository";

/** The thresholds of FR-27, from Configurações (FR-33). */
export interface AlertThresholds {
  dueSoonDays: number;
  cashDifferenceLimitCents: number;
}

function toAlertBill(expense: FixedExpense & { dueDate: string }): AlertBill {
  return {
    id: expense.id,
    label: expense.label,
    referenceMonth: expense.referenceMonth,
    dueDate: expense.dueDate,
    expectedAmountCents: expense.expectedAmountCents,
  };
}

/** By due date, then by name (the same day can have several bills). */
function byDueDate(a: AlertBill, b: AlertBill): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  return a.label.localeCompare(b.label, "pt-BR") || a.id - b.id;
}

/**
 * FR-27 "Diferença de caixa": the last closing is the closed day with the latest date (a
 * reopened day is open again, so the one before it counts). Null when it has no difference
 * above the limit.
 */
function cashDifferenceAlert(
  db: AppDatabase,
  limitCents: number,
): HomeAlertsResponse["cashDifference"] {
  const last = db
    .select({ date: days.date, differenceCents: days.differenceCents })
    .from(days)
    .where(eq(days.status, "closed"))
    .orderBy(desc(days.date))
    .limit(1)
    .get();
  if (!last || last.differenceCents === null) return null;
  if (!isCashDifferenceAlert(last.differenceCents, limitCents)) return null;
  return { date: last.date, differenceCents: last.differenceCents, limitCents };
}

/**
 * FR-27: the alerts that come from the database (Backup pendente comes from the export queue,
 * GET /api/exports/status). Read-only: no audit row.
 */
export function getHomeAlerts(
  db: AppDatabase,
  thresholds: AlertThresholds,
  now: Date,
): HomeAlertsResponse {
  const today = todayCivilDate(now);
  // Pending bills of **any** reference month due up to the end of the window: October's
  // unpaid bill still alerts in November. Paid and dismissed bills never alert.
  const candidates = selectFixedExpenses(
    db,
    and(
      eq(expenses.status, "pending"),
      isNotNull(expenses.dueDate),
      lte(expenses.dueDate, addDays(today, thresholds.dueSoonDays)),
    ),
  );
  const overdueBills: AlertBill[] = [];
  const dueSoonBills: AlertBill[] = [];
  for (const expense of candidates) {
    if (expense.dueDate === null) continue;
    const bill = toAlertBill({ ...expense, dueDate: expense.dueDate });
    const alert = fixedExpenseDueAlert(expense.dueDate, today, thresholds.dueSoonDays);
    if (alert === "overdue") overdueBills.push(bill);
    if (alert === "due_soon") dueSoonBills.push(bill);
  }

  return {
    today,
    dueSoonDays: thresholds.dueSoonDays,
    overdueBills: overdueBills.sort(byDueDate),
    dueSoonBills: dueSoonBills.sort(byDueDate),
    unclosedDays: listUnclosedDays(db, now),
    cashDifference: cashDifferenceAlert(db, thresholds.cashDifferenceLimitCents),
  };
}
