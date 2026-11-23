import { asc, eq } from "drizzle-orm";
import {
  CASH_WITHDRAWAL_TEXTS,
  compareFixedExpenses,
  contaBillName,
  CONTA_CONVERSION_REASON,
  MONTH_CLOSED_CODE,
  monthOf,
  periodLockError,
  type CivilDate,
  type ContaCandidatesResponse,
  type FixedExpense,
  type ParsedConvertContaInput,
} from "@color-bms/core";
import type { AppDatabase } from "../../db/client";
import { cashWithdrawals, days, expenses } from "../../db/schema";
import { BusinessError } from "../../http/route-helpers";
import { recordAudit } from "../audit/audit.repository";
import {
  closeDayInTransaction,
  reopenDayInTransaction,
} from "../cash-closing/cash-closing.repository";
import { monthStatus, periodStatus } from "../periods/period-status";
import {
  createOneOffInTransaction,
  payFixedExpenseInTransaction,
  selectFixedExpenses,
} from "./fixed-expenses.repository";

/**
 * #13: the one-off conversion of the pilot's interim records. Until fixed expenses could be
 * paid (FR-12), a bill paid with cash from the till was recorded as a sangria whose note
 * starts with "CONTA:" (#9). Each one becomes a paid fixed expense: same date and amount,
 * Dinheiro, paid from the till. The owner confirms each one on screen.
 *
 * RN-14 still applies: on a closed day the conversion reopens the day (FR-09), converts and
 * closes it again (FR-08), all in **one** transaction, so a failure leaves the day as it was.
 * RN-07 is unchanged (a till withdrawal becomes a till payment), so the re-closing keeps the
 * same opening cash, counted cash, difference and note.
 */

/** RN-14: the message for a CONTA: sangria in a closed month. */
function monthLockMessage(date: CivilDate): string {
  return periodLockError(
    date,
    { dayClosed: false, monthClosed: true },
    "para converter esta sangria.",
  )!;
}

/** GET /api/conta-conversions: the CONTA: sangrias left and the bills they can pay. */
export function listContaCandidates(db: AppDatabase): ContaCandidatesResponse {
  const withdrawals = db
    .select({
      id: cashWithdrawals.id,
      date: cashWithdrawals.date,
      amountCents: cashWithdrawals.amountCents,
      note: cashWithdrawals.note,
      dayStatus: days.status,
    })
    .from(cashWithdrawals)
    .leftJoin(days, eq(days.date, cashWithdrawals.date))
    .orderBy(asc(cashWithdrawals.date), asc(cashWithdrawals.id))
    .all()
    .flatMap(({ dayStatus, note, ...withdrawal }) => {
      const name = contaBillName(note);
      if (name === null || note === null) return [];
      // RN-14: shown with the reason, so the owner knows to reopen the month first.
      const lock = monthStatus(db, monthOf(withdrawal.date)).monthClosed
        ? monthLockMessage(withdrawal.date)
        : null;
      return [
        { ...withdrawal, note, suggestedName: name, dayClosed: dayStatus === "closed", lock },
      ];
    });

  const pendingExpenses = selectFixedExpenses(db, eq(expenses.status, "pending")).sort(
    (a, b) =>
      // Newest reference month first, then the month screen's order.
      b.referenceMonth.localeCompare(a.referenceMonth) || compareFixedExpenses(a, b),
  );
  return { withdrawals, pendingExpenses };
}

export interface ContaConversionResult {
  expense: FixedExpense;
  /** The day closed again by the conversion (run `onDayClosed`), or null. */
  reclosedDate: CivilDate | null;
}

/** POST /api/conta-conversions/:withdrawalId: converts one CONTA: sangria. */
export function convertConta(
  db: AppDatabase,
  withdrawalId: number,
  input: ParsedConvertContaInput,
  now: Date,
): ContaConversionResult {
  return db.transaction((tx) => {
    const withdrawal = tx
      .select()
      .from(cashWithdrawals)
      .where(eq(cashWithdrawals.id, withdrawalId))
      .get();
    if (!withdrawal) throw new BusinessError(404, CASH_WITHDRAWAL_TEXTS.notFound);
    if (contaBillName(withdrawal.note) === null) {
      throw new BusinessError(
        409,
        "Esta sangria não é uma conta: a observação não começa com CONTA:.",
      );
    }
    const { date } = withdrawal;

    // RN-14: a closed month must be reopened first (FR-17); a closed day is reopened here.
    const status = periodStatus(tx, date);
    if (status.monthClosed) {
      throw new BusinessError(409, monthLockMessage(date), MONTH_CLOSED_CODE);
    }
    const closedDay = status.dayClosed
      ? tx.select().from(days).where(eq(days.date, date)).get()
      : undefined;
    // The re-closing repeats the stored count; a closed day without one cannot be repeated.
    if (closedDay && (closedDay.countedCashCents === null || closedDay.openingCashCents === null)) {
      throw new BusinessError(
        409,
        "O fechamento deste dia não tem a contagem gravada. Reabra o dia, converta e feche de novo.",
      );
    }
    if (closedDay) reopenDayInTransaction(tx, date, { reason: CONTA_CONVERSION_REASON }, now);

    // The sangria goes; the audit row keeps it (FR-18).
    tx.delete(cashWithdrawals).where(eq(cashWithdrawals.id, withdrawalId)).run();
    recordAudit(
      tx,
      {
        entity: "cash_withdrawal",
        entityId: withdrawalId,
        action: "delete",
        before: { date, amountCents: withdrawal.amountCents, note: withdrawal.note },
        reason: CONTA_CONVERSION_REASON,
      },
      now,
    );

    const fixedExpenseId =
      input.target === "existing"
        ? input.fixedExpenseId
        : createOneOffInTransaction(
            tx,
            {
              referenceMonth: monthOf(date),
              description: input.name,
              group: input.group,
              dueDate: date,
              expectedAmountCents: null,
            },
            now,
            CONTA_CONVERSION_REASON,
          ).id;
    const expense = payFixedExpenseInTransaction(
      tx,
      fixedExpenseId,
      {
        amountCents: withdrawal.amountCents,
        paymentDate: date,
        paymentMeans: "cash",
        paidFromTill: true,
      },
      now,
      CONTA_CONVERSION_REASON,
    );

    if (closedDay) {
      // The same count as before. `expectedCashCents` makes the closing fail (and the whole
      // conversion roll back) if RN-07 changed, which it must not.
      closeDayInTransaction(
        tx,
        date,
        {
          openingCashCents: closedDay.openingCashCents!,
          countedCashCents: closedDay.countedCashCents!,
          expectedCashCents: closedDay.expectedCashCents ?? undefined,
          note: closedDay.note,
        },
        now,
      );
    }
    return { expense, reclosedDate: closedDay ? date : null };
  });
}
