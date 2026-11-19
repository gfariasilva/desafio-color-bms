import { asc, eq, max } from "drizzle-orm";
import {
  CATEGORY_ORDER_STALE_MESSAGE,
  findTemplateLoanError,
  FIXED_EXPENSE_TEMPLATE_TEXTS,
  fixedExpenseTemplateNameKey,
  type AuditValues,
  type CreateFixedExpenseTemplateInput,
  type FixedExpenseTemplate,
  type UpdateFixedExpenseTemplateInput,
} from "@color-bms/core";
import type { AppDatabase, AppTransaction } from "../../db/client";
import { fixedExpenseTemplates } from "../../db/schema";
import { BusinessError } from "../../http/route-helpers";
import { recordAudit } from "../audit/audit.repository";

/**
 * FR-10: fixed-expense templates. Create, edit, deactivate/reactivate and reorder; no delete
 * (deactivating keeps the past entries in the reports).
 *
 * Every write and its audit row (FR-18) run in one transaction.
 */

type Row = typeof fixedExpenseTemplates.$inferSelect;

/** The fields the owner edits, as stored (without id, key and order). */
type TemplateFields = Pick<
  Row,
  | "name"
  | "group"
  | "subgroup"
  | "dueDay"
  | "expectedAmountCents"
  | "isLoan"
  | "installmentsTotal"
  | "installmentsRemaining"
  | "active"
>;

const EDITABLE_FIELDS = [
  "name",
  "group",
  "subgroup",
  "dueDay",
  "expectedAmountCents",
  "isLoan",
  "installmentsTotal",
  "installmentsRemaining",
  "active",
] as const satisfies readonly (keyof TemplateFields)[];

/**
 * The audit key of each field. `group` is stored as `templateGroup`, so the Auditoria screen
 * shows "Gerais"/"Taxas governo" (an expense category's `group` is "Geral"/"Fornecedores").
 */
function auditKey(field: keyof TemplateFields): string {
  return field === "group" ? "templateGroup" : field;
}

function toTemplate(row: Row): FixedExpenseTemplate {
  return {
    id: row.id,
    name: row.name,
    group: row.group,
    subgroup: row.subgroup,
    dueDay: row.dueDay,
    expectedAmountCents: row.expectedAmountCents,
    isLoan: row.isLoan,
    installmentsTotal: row.installmentsTotal,
    installmentsRemaining: row.installmentsRemaining,
    order: row.sortOrder,
    active: row.active,
  };
}

/** The record as stored in the audit log (FR-18). Money keys end in `Cents`. */
function auditSnapshot(row: Row): AuditValues {
  return {
    name: row.name,
    templateGroup: row.group,
    subgroup: row.subgroup,
    dueDay: row.dueDay,
    expectedAmountCents: row.expectedAmountCents,
    isLoan: row.isLoan,
    installmentsTotal: row.installmentsTotal,
    installmentsRemaining: row.installmentsRemaining,
    order: row.sortOrder,
    active: row.active,
  };
}

function selectAll(db: AppDatabase | AppTransaction): Row[] {
  return db
    .select()
    .from(fixedExpenseTemplates)
    .orderBy(asc(fixedExpenseTemplates.sortOrder), asc(fixedExpenseTemplates.id))
    .all();
}

function selectOne(tx: AppTransaction, id: number): Row | undefined {
  return tx.select().from(fixedExpenseTemplates).where(eq(fixedExpenseTemplates.id, id)).get();
}

/** FR-10: blocks a label (subgroup + name) already used by another template. */
function assertNameIsFree(tx: AppTransaction, nameKey: string, exceptId?: number): void {
  const other = tx
    .select({ id: fixedExpenseTemplates.id })
    .from(fixedExpenseTemplates)
    .where(eq(fixedExpenseTemplates.nameKey, nameKey))
    .get();
  if (other && other.id !== exceptId) {
    throw new BusinessError(409, FIXED_EXPENSE_TEMPLATE_TEXTS.duplicate);
  }
}

function notFound(): BusinessError {
  return new BusinessError(404, FIXED_EXPENSE_TEMPLATE_TEXTS.notFound);
}

/** FR-10: every template in display order; `active: true` is what #12 generates from. */
export function listFixedExpenseTemplates(
  db: AppDatabase,
  active?: boolean,
): FixedExpenseTemplate[] {
  return selectAll(db)
    .filter((row) => active === undefined || row.active === active)
    .map(toTemplate);
}

/** FR-10: creates an active template at the end of the list. */
export function createFixedExpenseTemplate(
  db: AppDatabase,
  input: CreateFixedExpenseTemplateInput,
  now: Date,
): FixedExpenseTemplate {
  return db.transaction((tx) => {
    const nameKey = fixedExpenseTemplateNameKey(input);
    assertNameIsFree(tx, nameKey);

    const last = tx
      .select({ value: max(fixedExpenseTemplates.sortOrder) })
      .from(fixedExpenseTemplates)
      .get();
    const row = tx
      .insert(fixedExpenseTemplates)
      .values({ ...input, nameKey, sortOrder: (last?.value ?? 0) + 1, active: true })
      .returning()
      .get();

    recordAudit(
      tx,
      {
        entity: "fixed_expense_template",
        entityId: row.id,
        action: "create",
        after: auditSnapshot(row),
      },
      now,
    );
    return toTemplate(row);
  });
}

/**
 * FR-10: edits any field and/or (de)activates. The loan rules are checked on the template
 * after the edit. Only the fields that really changed go to the audit log; no change, no row.
 */
export function updateFixedExpenseTemplate(
  db: AppDatabase,
  id: number,
  changes: UpdateFixedExpenseTemplateInput,
  now: Date,
): FixedExpenseTemplate {
  return db.transaction((tx) => {
    const current = selectOne(tx, id);
    if (!current) throw notFound();

    const merged: Row = { ...current };
    const before: AuditValues = {};
    const after: AuditValues = {};
    for (const field of EDITABLE_FIELDS) {
      const value = changes[field];
      if (value === undefined || value === current[field]) continue;
      (merged as Record<string, unknown>)[field] = value;
      before[auditKey(field)] = current[field];
      after[auditKey(field)] = value;
    }
    if (Object.keys(after).length === 0) return toTemplate(current);

    const loanError = findTemplateLoanError(merged);
    if (loanError) throw new BusinessError(400, loanError);

    // The key depends on the subgroup too; it is checked even for a rename in another case.
    merged.nameKey = fixedExpenseTemplateNameKey(merged);
    if (merged.nameKey !== current.nameKey) assertNameIsFree(tx, merged.nameKey, id);

    const { id: _id, sortOrder: _order, ...set } = merged;
    tx.update(fixedExpenseTemplates).set(set).where(eq(fixedExpenseTemplates.id, id)).run();
    recordAudit(
      tx,
      { entity: "fixed_expense_template", entityId: id, action: "update", before, after },
      now,
    );
    return toTemplate(merged);
  });
}

/**
 * FR-10: sets the display order. `ids` must list every template exactly once.
 * Each template whose position changed gets its own audit row.
 */
export function reorderFixedExpenseTemplates(
  db: AppDatabase,
  ids: number[],
  now: Date,
): FixedExpenseTemplate[] {
  db.transaction((tx) => {
    const rows = selectAll(tx);
    const known = new Set(rows.map((row) => row.id));
    if (ids.length !== rows.length || !ids.every((id) => known.has(id))) {
      throw new BusinessError(400, CATEGORY_ORDER_STALE_MESSAGE);
    }

    const orderById = new Map(rows.map((row) => [row.id, row.sortOrder]));
    ids.forEach((id, index) => {
      const oldOrder = orderById.get(id);
      const newOrder = index + 1;
      if (oldOrder === newOrder) return;
      tx.update(fixedExpenseTemplates)
        .set({ sortOrder: newOrder })
        .where(eq(fixedExpenseTemplates.id, id))
        .run();
      recordAudit(
        tx,
        {
          entity: "fixed_expense_template",
          entityId: id,
          action: "update",
          before: { order: oldOrder },
          after: { order: newOrder },
        },
        now,
      );
    });
  });
  return listFixedExpenseTemplates(db);
}
