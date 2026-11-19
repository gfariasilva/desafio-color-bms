import { and, eq, sql } from "drizzle-orm";
import {
  closeMonthBlock,
  lastDateOfMonth,
  MONTH_ALREADY_CLOSED_CODE,
  MONTH_NOT_CLOSED_CODE,
  PENDING_DAYS_CODE,
  reopenMonthBlock,
  todayCivilDate,
  type CivilDate,
  type CloseMonthBlock,
  type MonthClosingResponse,
  type ParsedReopenMonthInput,
  type YearMonth,
} from "@color-bms/core";
import type { AppDatabase, AppTransaction } from "../../db/client";
import { days, expenses, months } from "../../db/schema";
import { BusinessError } from "../../http/route-helpers";
import { recordAudit } from "../audit/audit.repository";
import { MOVEMENT_DATES_SQL } from "../cash-closing/cash-closing.repository";
import {
  compareFixedExpenses,
  selectFixedExpenses,
} from "../fixed-expenses/fixed-expenses.repository";
import { monthStatus } from "../periods/period-status";

/**
 * FR-16 / FR-17: closing and reopening a month ("Fechamento do mês"). The checks, the write
 * and its audit row (FR-18) run in one transaction. Closing only changes the `months` row:
 * RN-14 is enforced by every module through `periodStatus`.
 */

type Db = AppDatabase | AppTransaction;

/**
 * RN-14 / A-15: the days of the month with movement (sales, refunds, paid expenses, sangrias)
 * whose status is not closed, oldest first.
 */
function pendingDaysOfMonth(db: Db, yearMonth: YearMonth): CivilDate[] {
  return db
    .all<{ date: string }>(
      sql`select movement.date as date from (${MOVEMENT_DATES_SQL}) as movement
        where substr(movement.date, 1, 7) = ${yearMonth}
          and not exists (
            select 1 from ${days} where ${days.date} = movement.date and ${days.status} = 'closed'
          )
        order by movement.date`,
    )
    .map((row) => row.date);
}

/** FR-16: the fixed expenses of this reference month still pending, in the FR-11 order. */
function pendingFixedExpensesOfMonth(db: Db, yearMonth: YearMonth) {
  return selectFixedExpenses(
    db,
    and(eq(expenses.status, "pending"), eq(expenses.referenceMonth, yearMonth)),
  ).sort(compareFixedExpenses);
}

function blockOf(db: Db, yearMonth: YearMonth, now: Date): CloseMonthBlock | null {
  return closeMonthBlock(yearMonth, todayCivilDate(now), {
    monthClosed: monthStatus(db, yearMonth).monthClosed,
    pendingDays: pendingDaysOfMonth(db, yearMonth),
  });
}

/** FR-16 / FR-17: what the "Fechamento do mês" section shows for a month. */
export function getMonthClosing(db: Db, yearMonth: YearMonth, now: Date): MonthClosingResponse {
  const row = db.select().from(months).where(eq(months.yearMonth, yearMonth)).get();
  const closed = row?.status === "closed";
  return {
    yearMonth,
    status: closed ? "closed" : "open",
    closedAt: closed ? (row.closedAt ?? null) : null,
    lastDate: lastDateOfMonth(yearMonth),
    pendingDays: pendingDaysOfMonth(db, yearMonth),
    pendingFixedExpenses: pendingFixedExpensesOfMonth(db, yearMonth),
    // On a closed month the section offers "Reabrir mês" instead.
    closeBlocked: closed ? null : (blockOf(db, yearMonth, now)?.message ?? null),
  };
}

/** The HTTP answer of each reason a month cannot be closed. */
function blockError(block: CloseMonthBlock): BusinessError {
  switch (block.kind) {
    case "not_ended":
      return new BusinessError(400, block.message);
    case "closed":
      return new BusinessError(409, block.message, MONTH_ALREADY_CLOSED_CODE);
    case "pending_days":
      return new BusinessError(409, block.message, PENDING_DAYS_CODE);
  }
}

/**
 * FR-16: closes a month whose days with movement are all closed (RN-14). Pending fixed
 * expenses of the month only warn: they stay pending and count when paid (RN-09). The `months`
 * row is upserted (the current month's row already exists, from the FR-11 generation).
 */
export function closeMonth(db: AppDatabase, yearMonth: YearMonth, now: Date) {
  return db.transaction((tx) => {
    const block = blockOf(tx, yearMonth, now);
    if (block) throw blockError(block);

    const values = { status: "closed" as const, closedAt: now.toISOString() };
    tx.insert(months)
      .values({ yearMonth, ...values })
      .onConflictDoUpdate({ target: months.yearMonth, set: values })
      .run();

    recordAudit(
      tx,
      {
        entity: "month",
        entityId: yearMonth,
        action: "close",
        before: { status: "open" },
        // The FR-16 warning the owner saw, as history.
        after: {
          status: "closed",
          pendingFixedExpenses: pendingFixedExpensesOfMonth(tx, yearMonth).length,
        },
      },
      now,
    );
    return getMonthClosing(tx, yearMonth, now);
  });
}

/**
 * FR-17: reopens a closed month with the owner's reason. Its days stay closed: each one is
 * reopened by itself (FR-09), which RN-14 now allows.
 */
export function reopenMonth(
  db: AppDatabase,
  yearMonth: YearMonth,
  input: ParsedReopenMonthInput,
  now: Date,
) {
  return db.transaction((tx) => {
    const blocked = reopenMonthBlock(yearMonth, monthStatus(tx, yearMonth));
    if (blocked) throw new BusinessError(409, blocked, MONTH_NOT_CLOSED_CODE);

    tx.update(months)
      .set({ status: "open", closedAt: null })
      .where(eq(months.yearMonth, yearMonth))
      .run();
    recordAudit(
      tx,
      {
        entity: "month",
        entityId: yearMonth,
        action: "reopen",
        before: { status: "closed" },
        after: { status: "open" },
        reason: input.reason,
      },
      now,
    );
    return getMonthClosing(tx, yearMonth, now);
  });
}
