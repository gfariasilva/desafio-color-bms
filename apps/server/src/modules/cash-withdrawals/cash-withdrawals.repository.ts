import { asc, eq, type SQL } from "drizzle-orm";
import {
  CASH_WITHDRAWAL_TEXTS,
  cashWithdrawalChangeLockError,
  cashWithdrawalDateError,
  cashWithdrawalLockError,
  cashWithdrawalsOfDayCents,
  DAY_CLOSED_CODE,
  todayCivilDate,
  type AuditValues,
  type CashWithdrawal,
  type CivilDate,
  type DayCashWithdrawalsResponse,
  type ParsedCreateCashWithdrawalInput,
  type ParsedUpdateCashWithdrawalInput,
} from "@color-bms/core";
import type { AppDatabase, AppTransaction } from "../../db/client";
import { cashWithdrawals } from "../../db/schema";
import { BusinessError } from "../../http/route-helpers";
import { recordAudit } from "../audit/audit.repository";
import { periodStatus } from "../periods/period-status";

/**
 * FR-07: registering, editing, deleting and listing sangrias (cash withdrawals). Every check,
 * the business write and its audit row (FR-18) run in one transaction.
 */

type Tx = AppTransaction;

function selectWithdrawals(db: AppDatabase | Tx, where: SQL): CashWithdrawal[] {
  return db
    .select({
      id: cashWithdrawals.id,
      date: cashWithdrawals.date,
      createdAt: cashWithdrawals.createdAt,
      amountCents: cashWithdrawals.amountCents,
      note: cashWithdrawals.note,
    })
    .from(cashWithdrawals)
    .where(where)
    .orderBy(asc(cashWithdrawals.createdAt), asc(cashWithdrawals.id))
    .all();
}

function findWithdrawal(db: AppDatabase | Tx, id: number): CashWithdrawal | undefined {
  return selectWithdrawals(db, eq(cashWithdrawals.id, id))[0];
}

/** FR-07: the day's sangrias and their total (RN-07), plus the RN-14 lock message. */
export function getDayCashWithdrawals(
  db: AppDatabase,
  date: CivilDate,
): DayCashWithdrawalsResponse {
  const withdrawals = selectWithdrawals(db, eq(cashWithdrawals.date, date));
  return {
    date,
    lock: cashWithdrawalChangeLockError(date, periodStatus(db, date)),
    withdrawals,
    totalCents: cashWithdrawalsOfDayCents(withdrawals, date),
  };
}

/** The sangria as stored in the audit log (FR-18); money in cents. */
function auditSnapshot(withdrawal: CashWithdrawal): AuditValues {
  return { date: withdrawal.date, amountCents: withdrawal.amountCents, note: withdrawal.note };
}

/**
 * The checks shared by creating and editing: no future date (RN-15), an open day and month
 * (RN-14).
 */
function checkDate(
  tx: Tx,
  date: CivilDate,
  now: Date,
  lockMessage: typeof cashWithdrawalLockError,
) {
  const dateError = cashWithdrawalDateError(date, todayCivilDate(now));
  if (dateError) throw new BusinessError(400, dateError);
  const lockError = lockMessage(date, periodStatus(tx, date));
  if (lockError) throw new BusinessError(409, lockError, DAY_CLOSED_CODE);
}

/** FR-07: registers a sangria with its audit row. */
export function createCashWithdrawal(
  db: AppDatabase,
  input: ParsedCreateCashWithdrawalInput,
  now: Date,
): CashWithdrawal {
  return db.transaction((tx) => {
    checkDate(tx, input.date, now, cashWithdrawalLockError);
    const row = tx
      .insert(cashWithdrawals)
      .values({
        date: input.date,
        amountCents: input.amountCents,
        note: input.note ?? null,
        createdAt: now.toISOString(),
      })
      .returning({ id: cashWithdrawals.id })
      .get();
    const withdrawal = findWithdrawal(tx, row.id)!;
    recordAudit(
      tx,
      {
        entity: "cash_withdrawal",
        entityId: withdrawal.id,
        action: "create",
        after: auditSnapshot(withdrawal),
      },
      now,
    );
    return withdrawal;
  });
}

/**
 * The sangria that may change: it exists and its day and month are open (RN-14). The lock is
 * checked before the new fields, so a closed day is reported first.
 */
function changeableWithdrawal(tx: Tx, id: number): CashWithdrawal {
  const withdrawal = findWithdrawal(tx, id);
  if (!withdrawal) throw new BusinessError(404, CASH_WITHDRAWAL_TEXTS.notFound);
  const lockError = cashWithdrawalChangeLockError(
    withdrawal.date,
    periodStatus(tx, withdrawal.date),
  );
  if (lockError) throw new BusinessError(409, lockError, DAY_CLOSED_CODE);
  return withdrawal;
}

/**
 * FR-07: edits a sangria on an open day. The changes are merged into the saved sangria, whose
 * (new) date is checked like a new one. The audit row holds the values before and after; an
 * edit that changes nothing writes none.
 */
export function updateCashWithdrawal(
  db: AppDatabase,
  id: number,
  input: ParsedUpdateCashWithdrawalInput,
  now: Date,
): CashWithdrawal {
  return db.transaction((tx) => {
    const before = changeableWithdrawal(tx, id);
    const changes = {
      date: input.date ?? before.date,
      amountCents: input.amountCents ?? before.amountCents,
      note: input.note === undefined ? before.note : input.note,
    };
    checkDate(tx, changes.date, now, cashWithdrawalChangeLockError);
    tx.update(cashWithdrawals).set(changes).where(eq(cashWithdrawals.id, id)).run();
    const after = findWithdrawal(tx, id)!;
    const beforeValues = auditSnapshot(before);
    const afterValues = auditSnapshot(after);
    if (JSON.stringify(beforeValues) !== JSON.stringify(afterValues)) {
      recordAudit(
        tx,
        {
          entity: "cash_withdrawal",
          entityId: id,
          action: "update",
          before: beforeValues,
          after: afterValues,
        },
        now,
      );
    }
    return after;
  });
}

/** FR-07: deletes a sangria on an open day; the audit row keeps it. */
export function deleteCashWithdrawal(db: AppDatabase, id: number, now: Date): void {
  db.transaction((tx) => {
    const found = changeableWithdrawal(tx, id);
    tx.delete(cashWithdrawals).where(eq(cashWithdrawals.id, id)).run();
    recordAudit(
      tx,
      { entity: "cash_withdrawal", entityId: id, action: "delete", before: auditSnapshot(found) },
      now,
    );
  });
}
