import { and, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
import {
  CASH_CHANGED_CODE,
  cashDifferenceCents,
  cashPaidFromTillCents,
  cashWithdrawalsOfDayCents,
  closeDayBlock,
  DAY_CLOSED_CODE,
  DAY_NOT_CLOSED_CODE,
  expectedCashCents,
  MONTH_CLOSED_CODE,
  NO_MOVEMENT_CODE,
  reopenDayBlock,
  todayCivilDate,
  type AuditValues,
  type CashClosing,
  type CivilDate,
  type CloseDayBlock,
  type DayCashClosingResponse,
  type ParsedCloseDayInput,
  type ParsedReopenDayInput,
  type ReopenDayBlock,
} from "@color-bms/core";
import type { AppDatabase, AppTransaction } from "../../db/client";
import { cashWithdrawals, days, expenses, paymentMethods, sales } from "../../db/schema";
import { BusinessError } from "../../http/route-helpers";
import { recordAudit } from "../audit/audit.repository";
import { periodStatus } from "../periods/period-status";

/**
 * FR-08 / FR-09: the cash closing of a day ("fechamento de caixa"): the RN-07 terms read from
 * the day's records, the stored closing, closing a day and reopening it. The checks, the write
 * and its audit row (FR-18) run in one transaction.
 */

type Db = AppDatabase | AppTransaction;

/** The RN-07 terms computed from the day's records (never stored, spec §6.3). */
interface DayCashTerms {
  cashSalesCents: number;
  tillExpensesCents: number;
  withdrawalsCents: number;
}

/**
 * RN-07 terms of a date:
 * - cash sales: Σ gross of sales and refunds (already negative) in the cash method, found by
 *   its `is_cash` flag (never by name); a cash sale has no fee, so gross = net;
 * - expenses paid from the till: `cashPaidFromTillCents` (general and fixed, paid in cash);
 * - sangrias: `cashWithdrawalsOfDayCents`.
 */
function dayCashTerms(db: Db, date: CivilDate): DayCashTerms {
  const cashSales = db
    .select({ total: sql<number>`coalesce(sum(${sales.grossCents}), 0)`.mapWith(Number) })
    .from(sales)
    .innerJoin(paymentMethods, eq(paymentMethods.id, sales.paymentMethodId))
    .where(and(eq(sales.date, date), eq(paymentMethods.isCash, true)))
    .get();
  const expenseRows = db
    .select({
      type: expenses.type,
      status: expenses.status,
      amountCents: expenses.amountCents,
      paymentDate: expenses.paymentDate,
      paymentMeans: expenses.paymentMeans,
      paidFromTill: expenses.paidFromTill,
    })
    .from(expenses)
    .where(eq(expenses.paymentDate, date))
    .all();
  const withdrawalRows = db
    .select({ date: cashWithdrawals.date, amountCents: cashWithdrawals.amountCents })
    .from(cashWithdrawals)
    .where(eq(cashWithdrawals.date, date))
    .all();
  return {
    cashSalesCents: cashSales?.total ?? 0,
    tillExpensesCents: cashPaidFromTillCents(expenseRows, date),
    withdrawalsCents: cashWithdrawalsOfDayCents(withdrawalRows, date),
  };
}

/**
 * A-15: the dates with movement: any sale or refund, any **paid** expense (by payment date)
 * or any sangria. Only these days need a closing. As SQL, so callers can filter it.
 */
const MOVEMENT_DATES_SQL = sql`
  select ${sales.date} as date from ${sales}
  union select ${expenses.paymentDate} from ${expenses}
    where ${expenses.status} = 'paid' and ${expenses.paymentDate} is not null
  union select ${cashWithdrawals.date} from ${cashWithdrawals}`;

function hasMovement(db: Db, date: CivilDate): boolean {
  const row = db.get<{ found: number }>(
    sql`select exists(select 1 from (${MOVEMENT_DATES_SQL}) where date = ${date}) as found`,
  );
  return row.found === 1;
}

/**
 * A-12: the counted cash of the latest closed day before `date`; none on the first day.
 * Closed rows without a count (only test shortcuts write them) are skipped.
 */
function lastCountBefore(db: Db, date: CivilDate) {
  return db
    .select({ date: days.date, countedCashCents: days.countedCashCents })
    .from(days)
    .where(and(eq(days.status, "closed"), lt(days.date, date), isNotNull(days.countedCashCents)))
    .orderBy(desc(days.date))
    .limit(1)
    .get();
}

/** The stored closing of a closed day, or null. */
function storedClosing(db: Db, date: CivilDate): CashClosing | null {
  const row = db.select().from(days).where(eq(days.date, date)).get();
  if (row?.status !== "closed") return null;
  return {
    // Rows written before #9 (only in old tests) have no cash fields: show them as 0.
    openingCashCents: row.openingCashCents ?? 0,
    expectedCashCents: row.expectedCashCents ?? 0,
    countedCashCents: row.countedCashCents ?? 0,
    differenceCents: row.differenceCents ?? 0,
    note: row.note,
    closedAt: row.closedAt ?? "",
  };
}

function blockOf(db: Db, date: CivilDate, now: Date): CloseDayBlock | null {
  return closeDayBlock(date, todayCivilDate(now), periodStatus(db, date), hasMovement(db, date));
}

/**
 * A-12: where the opening cash of an open day comes from.
 * - A reopened day (FR-09) keeps the opening cash it was closed with: suggest it again, so the
 *   owner does not retype it (`suggestedFrom` is the day itself).
 * - Otherwise, the counted cash of the latest closing before the date; none on the first day.
 */
function openingCashSuggestion(db: Db, date: CivilDate) {
  const reopened = db
    .select({ openingCashCents: days.openingCashCents })
    .from(days)
    .where(and(eq(days.date, date), eq(days.status, "open"), isNotNull(days.openingCashCents)))
    .get();
  if (reopened) return { date, countedCashCents: reopened.openingCashCents };
  return lastCountBefore(db, date);
}

/** FR-08 / FR-09: what the closing screen shows for a date. */
export function getCashClosing(db: Db, date: CivilDate, now: Date): DayCashClosingResponse {
  // better-sqlite3 is synchronous: nothing can write between these reads.
  const closing = storedClosing(db, date);
  const lastCount = openingCashSuggestion(db, date);
  return {
    date,
    status: closing ? "closed" : "open",
    hasMovement: hasMovement(db, date),
    blocked: blockOf(db, date, now)?.message ?? null,
    // FR-09: only a closed day can be reopened; say why not before the owner types a reason.
    reopenBlocked: closing ? (reopenDayBlock(date, periodStatus(db, date))?.message ?? null) : null,
    suggestedOpeningCashCents: lastCount?.countedCashCents ?? null,
    suggestedFrom: lastCount?.date ?? null,
    ...dayCashTerms(db, date),
    closing,
  };
}

/** The HTTP answer of each reason a day cannot be closed. */
function blockError(block: CloseDayBlock): BusinessError {
  switch (block.kind) {
    case "future":
      return new BusinessError(400, block.message);
    case "no_movement":
      return new BusinessError(409, block.message, NO_MOVEMENT_CODE);
    case "month_closed":
    case "day_closed":
      return new BusinessError(409, block.message, DAY_CLOSED_CODE);
  }
}

/**
 * FR-08: closes a day. The server recomputes the RN-07 terms from the records, stores the
 * opening cash, expected cash, counted cash, difference and note, marks the day closed (which
 * locks it, RN-14) and records the audit row, all in one transaction.
 */
export function closeDay(
  db: AppDatabase,
  date: CivilDate,
  input: ParsedCloseDayInput,
  now: Date,
): DayCashClosingResponse {
  return db.transaction((tx) => closeDayInTransaction(tx, date, input, now));
}

/** `closeDay` inside the caller's transaction (e.g. the CONTA: conversion, #13). */
export function closeDayInTransaction(
  tx: AppTransaction,
  date: CivilDate,
  input: ParsedCloseDayInput,
  now: Date,
): DayCashClosingResponse {
  const block = blockOf(tx, date, now);
  if (block) throw blockError(block);

  const terms = dayCashTerms(tx, date);
  const expected = expectedCashCents({ openingCashCents: input.openingCashCents, ...terms });
  // FR-08: the difference stored must be the one the owner saw and confirmed.
  if (input.expectedCashCents !== undefined && input.expectedCashCents !== expected) {
    throw new BusinessError(
      409,
      "Os lançamentos do dia mudaram desde que a tela foi aberta. Confira os valores e feche de novo.",
      CASH_CHANGED_CODE,
    );
  }
  const values = {
    status: "closed" as const,
    closedAt: now.toISOString(),
    openingCashCents: input.openingCashCents,
    expectedCashCents: expected,
    countedCashCents: input.countedCashCents,
    differenceCents: cashDifferenceCents(input.countedCashCents, expected),
    note: input.note ?? null,
  };
  // No row means open; after a reopening (FR-09) the row exists with status "open".
  tx.insert(days)
    .values({ date, ...values })
    .onConflictDoUpdate({ target: days.date, set: values })
    .run();

  // FR-18: the closing with the terms it was computed from, as history.
  const after: AuditValues = {
    status: values.status,
    openingCashCents: values.openingCashCents,
    ...terms,
    expectedCashCents: values.expectedCashCents,
    countedCashCents: values.countedCashCents,
    differenceCents: values.differenceCents,
    note: values.note,
  };
  recordAudit(
    tx,
    { entity: "day", entityId: date, action: "close", before: { status: "open" }, after },
    now,
  );
  return getCashClosing(tx, date, now);
}

/** The HTTP answer of each reason a day cannot be reopened. */
function reopenBlockError(block: ReopenDayBlock): BusinessError {
  switch (block.kind) {
    case "month_closed":
      return new BusinessError(409, block.message, MONTH_CLOSED_CODE);
    case "not_closed":
      return new BusinessError(409, block.message, DAY_NOT_CLOSED_CODE);
  }
}

/**
 * FR-09: reopens a closed day of an open month (RN-14). The day goes back to open, which
 * unlocks its records; a new closing (FR-08) is required and recomputes the cash fields. The
 * stored cash fields stay until then, but only `status = 'closed'` counts as a closing.
 * The previous closing goes to the audit log as `before`, with the owner's reason, in the
 * same transaction.
 */
export function reopenDay(
  db: AppDatabase,
  date: CivilDate,
  input: ParsedReopenDayInput,
  now: Date,
): DayCashClosingResponse {
  return db.transaction((tx) => reopenDayInTransaction(tx, date, input, now));
}

/** `reopenDay` inside the caller's transaction (e.g. the CONTA: conversion, #13). */
export function reopenDayInTransaction(
  tx: AppTransaction,
  date: CivilDate,
  input: ParsedReopenDayInput,
  now: Date,
): DayCashClosingResponse {
  const block = reopenDayBlock(date, periodStatus(tx, date));
  if (block) throw reopenBlockError(block);

  // FR-09 "o fechamento anterior fica no log de auditoria": the same fields as the closing's
  // own audit row. The day was locked, so its RN-07 terms are still the ones it was closed with.
  const row = tx.select().from(days).where(eq(days.date, date)).get();
  const before: AuditValues = {
    status: "closed",
    openingCashCents: row?.openingCashCents ?? null,
    ...dayCashTerms(tx, date),
    expectedCashCents: row?.expectedCashCents ?? null,
    countedCashCents: row?.countedCashCents ?? null,
    differenceCents: row?.differenceCents ?? null,
    note: row?.note ?? null,
  };
  tx.update(days).set({ status: "open", closedAt: null }).where(eq(days.date, date)).run();
  recordAudit(
    tx,
    {
      entity: "day",
      entityId: date,
      action: "reopen",
      before,
      after: { status: "open" },
      reason: input.reason,
    },
    now,
  );
  return getCashClosing(tx, date, now);
}

/**
 * FR-27 "Dia não fechado" (pilot slice): the days before today with movement whose status is
 * not closed, oldest first.
 */
export function listUnclosedDays(db: AppDatabase, now: Date): CivilDate[] {
  const today = todayCivilDate(now);
  return db
    .all<{ date: string }>(
      sql`select movement.date as date from (${MOVEMENT_DATES_SQL}) as movement
        where movement.date < ${today}
          and not exists (
            select 1 from ${days} where ${days.date} = movement.date and ${days.status} = 'closed'
          )
        order by movement.date`,
    )
    .map((row) => row.date);
}
