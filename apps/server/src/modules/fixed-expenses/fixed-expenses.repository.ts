import { and, eq } from "drizzle-orm";
import {
  FIXED_EXPENSE_GROUPS,
  FIXED_EXPENSE_TEXTS,
  fixedExpensesExpectedTotalCents,
  fixedExpenseTemplateLabel,
  monthOf,
  oneOffFixedExpenseError,
  planMonthFixedExpenses,
  todayCivilDate,
  type AuditValues,
  type FixedExpense,
  type MonthFixedExpensesResponse,
  type ParsedCreateOneOffFixedExpenseInput,
  type YearMonth,
} from "@color-bms/core";
import type { AppDatabase, AppTransaction } from "../../db/client";
import { expenses, fixedExpenseTemplates, months } from "../../db/schema";
import { BusinessError } from "../../http/route-helpers";
import { recordAudit } from "../audit/audit.repository";
import { monthStatus } from "../periods/period-status";

/**
 * FR-11: the month's fixed expenses ("contas do mês"): generating them from the templates
 * once a month, listing a month and adding one-off entries. Every write and its audit row
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
function selectFixedExpenses(
  db: AppDatabase | AppTransaction,
  where: ReturnType<typeof and>,
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

/** FR-11 list order: Gerais, then Taxas governo; by due date (none last); then by name. */
function compareFixedExpenses(a: FixedExpense, b: FixedExpense): number {
  const group = FIXED_EXPENSE_GROUPS.indexOf(a.group) - FIXED_EXPENSE_GROUPS.indexOf(b.group);
  if (group !== 0) return group;
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.label.localeCompare(b.label, "pt-BR") || a.id - b.id;
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
  return {
    month: yearMonth,
    currentMonth,
    generated: status.fixedExpensesGenerated,
    lock: oneOffFixedExpenseError(yearMonth, currentMonth, status),
    expenses: list,
    expectedTotalCents: fixedExpensesExpectedTotalCents(list),
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
  return db.transaction((tx) => {
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
      { entity: "expense", entityId: row.id, action: "create", after: auditSnapshot(created!) },
      now,
    );
    return created!;
  });
}
