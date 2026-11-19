import { and, eq, gte, lte, type SQL } from "drizzle-orm";
import {
  compareFixedExpenses,
  DAY_CLOSED_CODE,
  dismissFixedExpenseBlock,
  EXPENSE_PAYMENT_MEANS_LABELS,
  FIXED_EXPENSE_PAYMENT_TEXTS,
  FIXED_EXPENSE_TEXTS,
  fixedExpensesExpectedTotalCents,
  fixedExpensesOfMonthCents,
  fixedExpenseTemplateLabel,
  loanPayment,
  loanUndo,
  monthOf,
  oneOffFixedExpenseError,
  payFixedExpenseBlock,
  planMonthFixedExpenses,
  resolvePaidFromTill,
  todayCivilDate,
  undoFixedExpenseBlock,
  type AuditValues,
  type FixedExpense,
  type FixedExpenseBlock,
  type MonthFixedExpensesResponse,
  type ParsedCreateOneOffFixedExpenseInput,
  type ParsedPayFixedExpenseInput,
  type YearMonth,
} from "@color-bms/core";
import type { AppDatabase, AppTransaction } from "../../db/client";
import { expenses, fixedExpenseTemplates, months } from "../../db/schema";
import { BusinessError } from "../../http/route-helpers";
import { recordAudit } from "../audit/audit.repository";
import { monthStatus, periodStatus } from "../periods/period-status";

/**
 * FR-11: the month's fixed expenses ("contas do mês"): generating them from the templates
 * once a month, listing a month and adding one-off entries. FR-12 / FR-13: paying,
 * dismissing and undoing them, with the loan countdown. Every write and its audit row
 * (FR-18) run in one transaction.
 */

/**
 * FR-11: generates the fixed expenses of `yearMonth` if that month was not generated yet:
 * one pending entry per template that `isTemplateGenerated()`, and the automatic
 * deactivation of loans with 0 installments left (audited, with a reason). The month is then
 * marked `fixed_expenses_generated`, all in one transaction, so it never runs twice
 * (the unique index on template + month is the last line of defence).
 *
 * The generated entries get no audit row: generation is automatic, not an owner's action;
 * the month flag and each entry's `created_at` record it. A closed month (RN-14) is skipped.
 * Returns the number of entries created.
 */
export function ensureMonthFixedExpenses(db: AppDatabase, yearMonth: YearMonth, now: Date): number {
  return db.transaction((tx) => {
    const status = monthStatus(tx, yearMonth);
    if (status.fixedExpensesGenerated || status.monthClosed) return 0;

    const templates = tx.select().from(fixedExpenseTemplates).all();
    const plan = planMonthFixedExpenses(templates, yearMonth);

    const createdAt = now.toISOString();
    for (const entry of plan.entries) {
      tx.insert(expenses)
        .values({ ...entry, type: "fixed", paidFromTill: false, createdAt })
        .run();
    }

    for (const id of plan.loansToDeactivate) {
      tx.update(fixedExpenseTemplates)
        .set({ active: false })
        .where(eq(fixedExpenseTemplates.id, id))
        .run();
      recordAudit(
        tx,
        {
          entity: "fixed_expense_template",
          entityId: id,
          action: "update",
          before: { active: true },
          after: { active: false },
          reason: FIXED_EXPENSE_TEXTS.loanFinishedReason,
        },
        now,
      );
    }

    tx.insert(months)
      .values({ yearMonth, status: "open", fixedExpensesGenerated: true })
      .onConflictDoUpdate({ target: months.yearMonth, set: { fixedExpensesGenerated: true } })
      .run();
    return plan.entries.length;
  });
}

/** The fixed expenses of a reference month, with their template's name (renames show). */
export function selectFixedExpenses(
  db: AppDatabase | AppTransaction,
  where: SQL | undefined,
): FixedExpense[] {
  const rows = db
    .select({ expense: expenses, template: fixedExpenseTemplates })
    .from(expenses)
    .leftJoin(fixedExpenseTemplates, eq(fixedExpenseTemplates.id, expenses.fixedExpenseTemplateId))
    .where(and(eq(expenses.type, "fixed"), where))
    .all();
  return rows.map(({ expense, template }) => ({
    id: expense.id,
    referenceMonth: expense.referenceMonth ?? "",
    label: template ? fixedExpenseTemplateLabel(template) : (expense.description ?? ""),
    group: expense.fixedExpenseGroup ?? "general",
    fixedExpenseTemplateId: expense.fixedExpenseTemplateId,
    oneOff: expense.fixedExpenseTemplateId === null,
    dueDate: expense.dueDate,
    expectedAmountCents: expense.expectedAmountCents,
    status: expense.status,
    amountCents: expense.amountCents,
    paymentDate: expense.paymentDate,
    paymentMeans: expense.paymentMeans,
    paidFromTill: expense.paidFromTill,
    installmentNumber: expense.installmentNumber,
    installmentsTotal: template?.isLoan ? template.installmentsTotal : null,
    createdAt: expense.createdAt,
  }));
}

/** FR-11: the fixed expenses of a reference month, for "Contas do mês". */
export function getMonthFixedExpenses(
  db: AppDatabase,
  yearMonth: YearMonth,
  now: Date,
): MonthFixedExpensesResponse {
  const currentMonth = monthOf(todayCivilDate(now));
  const status = monthStatus(db, yearMonth);
  const list = selectFixedExpenses(db, eq(expenses.referenceMonth, yearMonth)).sort(
    compareFixedExpenses,
  );
  // RN-09: by payment date, whatever the reference month (October's bill paid in November).
  // Civil dates compare correctly as text: the whole month is "YYYY-MM-01" … "YYYY-MM-31".
  const paidInMonth = selectFixedExpenses(
    db,
    and(gte(expenses.paymentDate, `${yearMonth}-01`), lte(expenses.paymentDate, `${yearMonth}-31`)),
  );
  return {
    month: yearMonth,
    currentMonth,
    generated: status.fixedExpensesGenerated,
    lock: oneOffFixedExpenseError(yearMonth, currentMonth, status),
    expenses: list,
    expectedTotalCents: fixedExpensesExpectedTotalCents(list),
    paidTotalCents: fixedExpensesOfMonthCents(
      paidInMonth.map((expense) => ({ ...expense, type: "fixed" as const })),
      yearMonth,
    ),
  };
}

/** The one-off entry as stored in the audit log (FR-18). Money keys end in `Cents`. */
function auditSnapshot(expense: FixedExpense): AuditValues {
  return {
    expenseType: "fixed",
    referenceMonth: expense.referenceMonth,
    description: expense.label,
    templateGroup: expense.group,
    dueDate: expense.dueDate,
    expectedAmountCents: expense.expectedAmountCents,
    expenseStatus: expense.status,
  };
}

/**
 * FR-11: the owner adds a one-off fixed entry ("lançamento fixo avulso") to a month: born
 * pending, without a template. The month cannot be in the future (RN-15) nor closed (RN-14);
 * the due date may be in the future (RN-15).
 */
export function createOneOffFixedExpense(
  db: AppDatabase,
  input: ParsedCreateOneOffFixedExpenseInput,
  now: Date,
): FixedExpense {
  return db.transaction((tx) => createOneOffInTransaction(tx, input, now));
}

/** `createOneOffFixedExpense` inside the caller's transaction (the CONTA: conversion, #13). */
export function createOneOffInTransaction(
  tx: AppTransaction,
  input: ParsedCreateOneOffFixedExpenseInput,
  now: Date,
  reason: string | null = null,
): FixedExpense {
  const currentMonth = monthOf(todayCivilDate(now));
  const error = oneOffFixedExpenseError(
    input.referenceMonth,
    currentMonth,
    monthStatus(tx, input.referenceMonth),
  );
  if (error) {
    throw new BusinessError(input.referenceMonth > currentMonth ? 400 : 409, error);
  }

  const row = tx
    .insert(expenses)
    .values({
      type: "fixed",
      status: "pending",
      referenceMonth: input.referenceMonth,
      description: input.description,
      fixedExpenseGroup: input.group,
      dueDate: input.dueDate,
      expectedAmountCents: input.expectedAmountCents,
      paidFromTill: false,
      createdAt: now.toISOString(),
    })
    .returning({ id: expenses.id })
    .get();
  const [created] = selectFixedExpenses(tx, eq(expenses.id, row.id));
  recordAudit(
    tx,
    {
      entity: "expense",
      entityId: row.id,
      action: "create",
      after: auditSnapshot(created!),
      reason,
    },
    now,
  );
  return created!;
}

// ---------------------------------------------------------------------------------------------
// FR-12 / FR-13: pay, dismiss, undo.

function findFixedExpense(db: AppDatabase | AppTransaction, id: number): FixedExpense {
  const found = selectFixedExpenses(db, eq(expenses.id, id))[0];
  if (!found) throw new BusinessError(404, FIXED_EXPENSE_PAYMENT_TEXTS.notFound);
  return found;
}

/** The HTTP answer of each reason a fixed expense cannot change. */
function blockError(block: FixedExpenseBlock): BusinessError {
  switch (block.kind) {
    case "future":
      return new BusinessError(400, block.message);
    case "locked":
      return new BusinessError(409, block.message, DAY_CLOSED_CODE);
    case "status":
      return new BusinessError(409, block.message);
  }
}

/**
 * The status and payment of a fixed expense, as stored in the audit log (FR-18). The bill's
 * name and month are in both `before` and `after`, so the log says which bill it was.
 */
function statusSnapshot(expense: FixedExpense): AuditValues {
  return {
    description: expense.label,
    referenceMonth: expense.referenceMonth,
    expenseStatus: expense.status,
    amountCents: expense.amountCents,
    paymentDate: expense.paymentDate,
    paymentMeans: expense.paymentMeans ? EXPENSE_PAYMENT_MEANS_LABELS[expense.paymentMeans] : null,
    paidFromTill: expense.paidFromTill,
    installmentNumber: expense.installmentNumber,
  };
}

/** The template of a generated entry, or undefined for a one-off entry. */
function templateOf(tx: AppTransaction, expense: FixedExpense) {
  if (expense.fixedExpenseTemplateId === null) return undefined;
  return tx
    .select()
    .from(fixedExpenseTemplates)
    .where(eq(fixedExpenseTemplates.id, expense.fixedExpenseTemplateId))
    .get();
}

/** FR-13: writes a loan's new remaining installments and its audit row. */
function setInstallmentsRemaining(
  tx: AppTransaction,
  templateId: number,
  before: number | null,
  after: number,
  reason: string,
  now: Date,
) {
  tx.update(fixedExpenseTemplates)
    .set({ installmentsRemaining: after })
    .where(eq(fixedExpenseTemplates.id, templateId))
    .run();
  recordAudit(
    tx,
    {
      entity: "fixed_expense_template",
      entityId: templateId,
      action: "update",
      before: { installmentsRemaining: before },
      after: { installmentsRemaining: after },
      reason,
    },
    now,
  );
}

/** Records the status change of a fixed expense (FR-18) and returns it as it is now. */
function auditStatusChange(
  tx: AppTransaction,
  before: FixedExpense,
  reason: string | null,
  now: Date,
): FixedExpense {
  const after = findFixedExpense(tx, before.id);
  recordAudit(
    tx,
    {
      entity: "expense",
      entityId: before.id,
      action: "update",
      before: statusSnapshot(before),
      after: statusSnapshot(after),
      reason,
    },
    now,
  );
  return after;
}

/**
 * FR-12: pays a pending fixed expense. Checks "pago do caixa" (only with Dinheiro, FR-06),
 * no future date (RN-15) and an open payment day and month (RN-14, A-16). FR-13: a loan's
 * entry gets the installment it pays and the template counts one down.
 */
export function payFixedExpense(
  db: AppDatabase,
  id: number,
  input: ParsedPayFixedExpenseInput,
  now: Date,
): FixedExpense {
  return db.transaction((tx) => payFixedExpenseInTransaction(tx, id, input, now));
}

/** `payFixedExpense` inside the caller's transaction (the CONTA: conversion, #13). */
export function payFixedExpenseInTransaction(
  tx: AppTransaction,
  id: number,
  input: ParsedPayFixedExpenseInput,
  now: Date,
  reason: string | null = null,
): FixedExpense {
  const before = findFixedExpense(tx, id);
  const block = payFixedExpenseBlock(
    before,
    input.paymentDate,
    todayCivilDate(now),
    periodStatus(tx, input.paymentDate),
  );
  if (block) throw blockError(block);
  const till = resolvePaidFromTill(input.paymentMeans, input.paidFromTill);
  if ("error" in till) throw new BusinessError(400, till.error);

  const template = templateOf(tx, before);
  const loan = template ? loanPayment(template) : null;
  tx.update(expenses)
    .set({
      status: "paid",
      amountCents: input.amountCents,
      paymentDate: input.paymentDate,
      paymentMeans: input.paymentMeans,
      paidFromTill: till.paidFromTill,
      // FR-13: the installment this payment pays; no countdown (null) when nothing is left
      // or the loan's installments are still blank (Q-06).
      installmentNumber: loan?.installmentNumber ?? null,
    })
    .where(eq(expenses.id, id))
    .run();
  if (template && loan) {
    setInstallmentsRemaining(
      tx,
      template.id,
      template.installmentsRemaining,
      loan.installmentsRemaining,
      `Pagamento da parcela ${loan.installmentNumber} de ${template.installmentsTotal} (FR-13).`,
      now,
    );
  }
  return auditStatusChange(tx, before, reason, now);
}

/** FR-12: dismisses a pending entry ("não se aplica no mês"): out of every total and alert. */
export function dismissFixedExpense(
  db: AppDatabase,
  id: number,
  reason: string | null,
  now: Date,
): FixedExpense {
  return db.transaction((tx) => {
    const before = findFixedExpense(tx, id);
    const block = dismissFixedExpenseBlock(
      before,
      monthStatus(tx, before.referenceMonth).monthClosed,
    );
    if (block) throw blockError(block);
    tx.update(expenses).set({ status: "dismissed" }).where(eq(expenses.id, id)).run();
    return auditStatusChange(tx, before, reason, now);
  });
}

/**
 * FR-12 "Desfazer pagamento" / "Reativar": back to pending. A payment's fields are cleared;
 * a counted loan payment (the entry has an installment number) gives the installment back
 * (FR-13). The entry keeps its installment number as the provisional "parcela n".
 */
export function undoFixedExpense(
  db: AppDatabase,
  id: number,
  reason: string | null,
  now: Date,
): FixedExpense {
  return db.transaction((tx) => {
    const before = findFixedExpense(tx, id);
    const block = undoFixedExpenseBlock(
      before,
      before.paymentDate
        ? periodStatus(tx, before.paymentDate)
        : { dayClosed: false, monthClosed: false },
      monthStatus(tx, before.referenceMonth).monthClosed,
    );
    if (block) throw blockError(block);

    if (before.status === "paid" && before.installmentNumber !== null) {
      const template = templateOf(tx, before);
      const loan = template ? loanUndo(template) : null;
      if (template && loan) {
        setInstallmentsRemaining(
          tx,
          template.id,
          template.installmentsRemaining,
          loan.installmentsRemaining,
          `Pagamento da parcela ${before.installmentNumber} desfeito (FR-13).`,
          now,
        );
      }
    }
    tx.update(expenses)
      .set({
        status: "pending",
        amountCents: null,
        paymentDate: null,
        paymentMeans: null,
        paidFromTill: false,
      })
      .where(eq(expenses.id, id))
      .run();
    return auditStatusChange(tx, before, reason, now);
  });
}
