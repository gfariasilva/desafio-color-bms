import { and, asc, eq, gte, lte, type SQL } from "drizzle-orm";
import {
  cashPaidFromTillCents,
  DAY_CLOSED_CODE,
  EXPENSE_PAYMENT_MEANS_LABELS,
  EXPENSE_TEXTS,
  expenseChangeLockError,
  expenseDateError,
  expensesTotalCents,
  expenseLockError,
  generalExpensesOfMonthCents,
  monthOf,
  resolvePaidFromTill,
  todayCivilDate,
  type AuditValues,
  type CivilDate,
  type DayExpensesResponse,
  type Expense,
  type ExpensePaymentMeans,
  type ParsedCreateExpenseInput,
  type ParsedUpdateExpenseInput,
  type YearMonth,
} from "@color-bms/core";
import type { AppDatabase, AppTransaction } from "../../db/client";
import { expenseCategories, expenses } from "../../db/schema";
import { BusinessError } from "../../http/route-helpers";
import { recordAudit } from "../audit/audit.repository";
import { periodStatus } from "../periods/period-status";

/**
 * FR-06: registering, editing, deleting and listing general expenses ("saídas diárias").
 * Every check, the business write and its audit row (FR-18) run in one transaction.
 * Fixed expenses (#11–#13) share the table but are never touched by these functions.
 */

type Tx = AppTransaction;

/** General expenses with the name and order of their category, filtered by `where`. */
function selectExpenses(db: AppDatabase | Tx, where: SQL | undefined): Expense[] {
  const rows = db
    .select({
      id: expenses.id,
      type: expenses.type,
      status: expenses.status,
      paymentDate: expenses.paymentDate,
      createdAt: expenses.createdAt,
      expenseCategoryId: expenses.expenseCategoryId,
      expenseCategoryName: expenseCategories.name,
      expenseCategoryOrder: expenseCategories.sortOrder,
      description: expenses.description,
      amountCents: expenses.amountCents,
      paymentMeans: expenses.paymentMeans,
      paidFromTill: expenses.paidFromTill,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.expenseCategoryId))
    .where(and(eq(expenses.type, "general"), where))
    .orderBy(asc(expenses.createdAt), asc(expenses.id))
    .all();
  // The CHECK constraint guarantees these columns on general expenses.
  return rows.map((row) => ({
    ...row,
    paymentDate: row.paymentDate!,
    expenseCategoryId: row.expenseCategoryId!,
    amountCents: row.amountCents!,
    paymentMeans: row.paymentMeans!,
  }));
}

function findExpense(db: AppDatabase | Tx, id: number): Expense | undefined {
  return selectExpenses(db, eq(expenses.id, id))[0];
}

/** RN-08: the general expenses paid in the month ("YYYY-MM"), in registration order. */
export function listGeneralExpensesOfMonth(db: AppDatabase, yearMonth: YearMonth): Expense[] {
  // Civil dates compare correctly as text: the whole month is "YYYY-MM-01" … "YYYY-MM-31".
  return selectExpenses(
    db,
    and(gte(expenses.paymentDate, `${yearMonth}-01`), lte(expenses.paymentDate, `${yearMonth}-31`)),
  );
}

/**
 * FR-06: the day's general expenses, their total, the part paid from the till (RN-07) and
 * the general expenses of the month (RN-08), plus the RN-14 lock message.
 */
export function getDayExpenses(db: AppDatabase, date: CivilDate): DayExpensesResponse {
  const yearMonth = monthOf(date);
  const monthRows = listGeneralExpensesOfMonth(db, yearMonth);
  const dayRows = monthRows.filter((expense) => expense.paymentDate === date);
  return {
    date,
    lock: expenseChangeLockError(date, periodStatus(db, date)),
    expenses: dayRows,
    totalCents: expensesTotalCents(dayRows),
    paidFromTillCents: cashPaidFromTillCents(dayRows, date),
    monthGeneralTotalCents: generalExpensesOfMonthCents(monthRows, yearMonth),
  };
}

/** The expense as stored in the audit log (FR-18): names and labels, not ids; money in cents. */
function auditSnapshot(expense: Expense): AuditValues {
  return {
    paymentDate: expense.paymentDate,
    expenseCategory: expense.expenseCategoryName,
    description: expense.description,
    amountCents: expense.amountCents,
    paymentMeans: EXPENSE_PAYMENT_MEANS_LABELS[expense.paymentMeans],
    paidFromTill: expense.paidFromTill,
  };
}

/** The fields of a general expense before they are checked. */
interface ExpenseFields {
  paymentDate: CivilDate;
  expenseCategoryId: number;
  description: string | null;
  amountCents: number;
  paymentMeans: ExpensePaymentMeans;
  paidFromTill: boolean | undefined;
}

/**
 * The FR-06 checks shared by creating and editing, in order: an active category (an edit may
 * keep its category even if deactivated since), "pago do caixa" only with Dinheiro, no future
 * date (RN-15), an open day and month (RN-14). Returns the columns to write.
 */
function checkExpense(
  tx: Tx,
  fields: ExpenseFields,
  now: Date,
  options: { currentCategoryId?: number; lockMessage: typeof expenseLockError },
) {
  const category = tx
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.id, fields.expenseCategoryId))
    .get();
  if (!category || !(category.active || category.id === options.currentCategoryId)) {
    throw new BusinessError(400, EXPENSE_TEXTS.inactiveCategory);
  }

  const till = resolvePaidFromTill(fields.paymentMeans, fields.paidFromTill);
  if ("error" in till) throw new BusinessError(400, till.error);

  const dateError = expenseDateError(fields.paymentDate, todayCivilDate(now));
  if (dateError) throw new BusinessError(400, dateError);

  const lockError = options.lockMessage(fields.paymentDate, periodStatus(tx, fields.paymentDate));
  if (lockError) throw new BusinessError(409, lockError, DAY_CLOSED_CODE);

  return {
    paymentDate: fields.paymentDate,
    expenseCategoryId: fields.expenseCategoryId,
    description: fields.description,
    amountCents: fields.amountCents,
    paymentMeans: fields.paymentMeans,
    paidFromTill: till.paidFromTill,
  };
}

/** FR-06: registers a general expense, born `paid`, with its audit row. */
export function createExpense(
  db: AppDatabase,
  input: ParsedCreateExpenseInput,
  now: Date,
): Expense {
  return db.transaction((tx) => {
    const checked = checkExpense(
      tx,
      {
        paymentDate: input.paymentDate,
        expenseCategoryId: input.expenseCategoryId,
        description: input.description ?? null,
        amountCents: input.amountCents,
        paymentMeans: input.paymentMeans,
        paidFromTill: input.paidFromTill,
      },
      now,
      { lockMessage: expenseLockError },
    );
    const row = tx
      .insert(expenses)
      .values({ ...checked, type: "general", status: "paid", createdAt: now.toISOString() })
      .returning({ id: expenses.id })
      .get();
    const expense = findExpense(tx, row.id)!;
    recordAudit(
      tx,
      { entity: "expense", entityId: expense.id, action: "create", after: auditSnapshot(expense) },
      now,
    );
    return expense;
  });
}

/**
 * The general expense FR-06 may change, as FR-03: it exists and its day and month are open
 * (RN-14). The lock is checked before the fields, so a closed day is reported first.
 */
function changeableExpense(tx: Tx, id: number): Expense {
  const expense = findExpense(tx, id);
  if (!expense) throw new BusinessError(404, EXPENSE_TEXTS.notFound);
  const lockError = expenseChangeLockError(
    expense.paymentDate,
    periodStatus(tx, expense.paymentDate),
  );
  if (lockError) throw new BusinessError(409, lockError, DAY_CLOSED_CODE);
  return expense;
}

/**
 * FR-06 (as FR-03): edits a general expense on an open day. The changes are merged into the
 * saved expense, which is then checked like a new one. A new means drops "pago do caixa" so
 * it gets its default again (yes for Dinheiro, no for the others). The audit row holds the
 * values before and after; an edit that changes nothing writes none.
 */
export function updateExpense(
  db: AppDatabase,
  id: number,
  input: ParsedUpdateExpenseInput,
  now: Date,
): Expense {
  return db.transaction((tx) => {
    const before = changeableExpense(tx, id);
    const paymentMeans = input.paymentMeans ?? before.paymentMeans;
    const keptPaidFromTill = paymentMeans === before.paymentMeans ? before.paidFromTill : undefined;
    const checked = checkExpense(
      tx,
      {
        paymentDate: input.paymentDate ?? before.paymentDate,
        expenseCategoryId: input.expenseCategoryId ?? before.expenseCategoryId,
        description: input.description === undefined ? before.description : input.description,
        amountCents: input.amountCents ?? before.amountCents,
        paymentMeans,
        paidFromTill: input.paidFromTill ?? keptPaidFromTill,
      },
      now,
      { currentCategoryId: before.expenseCategoryId, lockMessage: expenseChangeLockError },
    );
    tx.update(expenses).set(checked).where(eq(expenses.id, id)).run();
    const after = findExpense(tx, id)!;
    const beforeValues = auditSnapshot(before);
    const afterValues = auditSnapshot(after);
    if (JSON.stringify(beforeValues) !== JSON.stringify(afterValues)) {
      recordAudit(
        tx,
        {
          entity: "expense",
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

/** FR-06 (as FR-03): deletes a general expense on an open day; the audit row keeps it. */
export function deleteExpense(db: AppDatabase, id: number, now: Date): void {
  db.transaction((tx) => {
    const found = changeableExpense(tx, id);
    tx.delete(expenses).where(eq(expenses.id, id)).run();
    recordAudit(
      tx,
      { entity: "expense", entityId: id, action: "delete", before: auditSnapshot(found) },
      now,
    );
  });
}
