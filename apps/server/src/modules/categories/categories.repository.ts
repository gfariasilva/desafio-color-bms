import { asc, count, eq, gt, max, sql } from "drizzle-orm";
import {
  canDeleteCategory,
  CATEGORY_IN_USE_CODE,
  CATEGORY_ORDER_STALE_MESSAGE,
  CATEGORY_TEXTS,
  categoryNameKey,
  type AuditValues,
  type CategoryKind,
  type ExpenseCategory,
  type ExpenseCategoryGroup,
  type SaleCategory,
} from "@color-bms/core";
import type { AppDatabase, AppTransaction } from "../../db/client";
import { BusinessError } from "../../http/route-helpers";
import { expenseCategories, saleCategories, sales } from "../../db/schema";
import { recordAudit } from "../audit/audit.repository";

/**
 * FR-14: sale tabs and general-expense categories. Both tables have the same columns,
 * except that expense categories also have a `group`, so one set of functions serves both:
 * `kind` picks the table, the audit entity and the pt-BR messages.
 *
 * Every write and its audit row (FR-18) run in one transaction.
 */

/** A category business error (FR-14); the routes send it with its pt-BR message. */
export class CategoryError extends BusinessError {}

type Tx = AppTransaction;

const TABLES = { sale: saleCategories, expense: expenseCategories } as const;
const AUDIT_ENTITY = { sale: "sale_category", expense: "expense_category" } as const;

/** Columns both tables have; expense categories add `group`. */
interface CategoryRow {
  id: number;
  name: string;
  nameKey: string;
  sortOrder: number;
  active: boolean;
  group?: ExpenseCategoryGroup;
}

export type CategoryOf<K extends CategoryKind> = K extends "sale" ? SaleCategory : ExpenseCategory;

/** What creating a category needs: expense categories also need their group. */
export type CreateCategoryInput<K extends CategoryKind> = K extends "expense"
  ? { name: string; group: ExpenseCategoryGroup }
  : { name: string };

/** Fields the owner can change. `group` only exists for expense categories. */
export interface CategoryChanges {
  name?: string;
  active?: boolean;
  group?: ExpenseCategoryGroup;
}

function toCategory<K extends CategoryKind>(row: CategoryRow): CategoryOf<K> {
  const base = { id: row.id, name: row.name, order: row.sortOrder, active: row.active };
  return (row.group === undefined ? base : { ...base, group: row.group }) as CategoryOf<K>;
}

/** The record as stored in the audit log (FR-18). */
function auditSnapshot(row: CategoryRow): AuditValues {
  return {
    name: row.name,
    ...(row.group === undefined ? {} : { group: row.group }),
    order: row.sortOrder,
    active: row.active,
  };
}

// Drizzle cannot type a query on "one of two tables", so the reads and writes below go
// through these helpers. They only touch the columns both tables share (plus `group`).

function selectAll(db: AppDatabase | Tx, kind: CategoryKind): CategoryRow[] {
  const table = TABLES[kind];
  return db
    .select()
    .from(table)
    .orderBy(asc(table.sortOrder), asc(table.id))
    .all() as CategoryRow[];
}

function selectOne(tx: Tx, kind: CategoryKind, id: number): CategoryRow | undefined {
  const table = TABLES[kind];
  return tx.select().from(table).where(eq(table.id, id)).get() as CategoryRow | undefined;
}

/** Updates one row. Branches on `kind` so Drizzle can type the columns of each table. */
function updateRow(tx: Tx, kind: CategoryKind, id: number, set: Partial<CategoryRow>): void {
  if (kind === "expense") {
    tx.update(expenseCategories).set(set).where(eq(expenseCategories.id, id)).run();
  } else {
    const { group: _group, ...saleSet } = set;
    tx.update(saleCategories).set(saleSet).where(eq(saleCategories.id, id)).run();
  }
}

/**
 * FR-14: after a delete, moves every later category up by one so the order stays 1..n.
 * Otherwise the next reorder would renumber them all and fill the audit log with order
 * changes the owner never made. No audit rows: the delete row already explains the shift.
 */
function closeOrderGap(tx: Tx, kind: CategoryKind, removedOrder: number): void {
  if (kind === "expense") {
    tx.update(expenseCategories)
      .set({ sortOrder: sql`${expenseCategories.sortOrder} - 1` })
      .where(gt(expenseCategories.sortOrder, removedOrder))
      .run();
  } else {
    tx.update(saleCategories)
      .set({ sortOrder: sql`${saleCategories.sortOrder} - 1` })
      .where(gt(saleCategories.sortOrder, removedOrder))
      .run();
  }
}

/**
 * FR-14: how many sales or expenses use this category. Delete is allowed only at 0.
 * Sales count for tabs; the expenses table arrives in #7 and adds its count here.
 */
function countUsages(tx: Tx, kind: CategoryKind, id: number): number {
  if (kind !== "sale") return 0;
  const used = tx.select({ value: count() }).from(sales).where(eq(sales.saleCategoryId, id)).get();
  return used?.value ?? 0;
}

/** FR-14: blocks a name already used by another category of the same list. */
function assertNameIsFree(tx: Tx, kind: CategoryKind, nameKey: string, exceptId?: number): void {
  const table = TABLES[kind];
  const other = tx.select({ id: table.id }).from(table).where(eq(table.nameKey, nameKey)).get();
  if (other && other.id !== exceptId) {
    throw new CategoryError(409, CATEGORY_TEXTS[kind].duplicate);
  }
}

/**
 * FR-14: the list in display order. `active: true` is what sale/expense forms offer,
 * `active: false` only the deactivated ones, and undefined everything.
 */
export function listCategories<K extends CategoryKind>(
  db: AppDatabase,
  kind: K,
  active?: boolean,
): CategoryOf<K>[] {
  return selectAll(db, kind)
    .filter((row) => active === undefined || row.active === active)
    .map((row) => toCategory<K>(row));
}

/** FR-14: creates an active category at the end of the list. */
export function createCategory<K extends CategoryKind>(
  db: AppDatabase,
  kind: K,
  input: CreateCategoryInput<K>,
  now: Date = new Date(),
): CategoryOf<K> {
  return db.transaction((tx) => {
    const table = TABLES[kind];
    const nameKey = categoryNameKey(input.name);
    assertNameIsFree(tx, kind, nameKey);

    const last = tx
      .select({ value: max(table.sortOrder) })
      .from(table)
      .get();
    const values = { name: input.name, nameKey, sortOrder: (last?.value ?? 0) + 1, active: true };
    const row: CategoryRow =
      "group" in input
        ? tx
            .insert(expenseCategories)
            .values({ ...values, group: input.group })
            .returning()
            .get()
        : tx.insert(saleCategories).values(values).returning().get();

    recordAudit(
      tx,
      { entity: AUDIT_ENTITY[kind], entityId: row.id, action: "create", after: auditSnapshot(row) },
      now,
    );
    return toCategory<K>(row);
  });
}

/**
 * FR-14: renames, deactivates/reactivates and (expense categories) changes the group.
 * The id never changes, so sales and expenses keep pointing at this category (spec §6.3).
 * Only the fields that really changed go to the audit log; no change, no audit row.
 */
export function updateCategory<K extends CategoryKind>(
  db: AppDatabase,
  kind: K,
  id: number,
  changes: CategoryChanges,
  now: Date = new Date(),
): CategoryOf<K> {
  return db.transaction((tx) => {
    const current = selectOne(tx, kind, id);
    if (!current) throw new CategoryError(404, CATEGORY_TEXTS[kind].notFound);

    const set: Partial<CategoryRow> = {};
    const before: AuditValues = {};
    const after: AuditValues = {};

    if (changes.name !== undefined && changes.name !== current.name) {
      const nameKey = categoryNameKey(changes.name);
      assertNameIsFree(tx, kind, nameKey, id);
      set.name = changes.name;
      set.nameKey = nameKey;
      before.name = current.name;
      after.name = changes.name;
    }
    if (changes.active !== undefined && changes.active !== current.active) {
      set.active = changes.active;
      before.active = current.active;
      after.active = changes.active;
    }
    if (kind === "expense" && changes.group !== undefined && changes.group !== current.group) {
      set.group = changes.group;
      before.group = current.group;
      after.group = changes.group;
    }

    if (Object.keys(set).length === 0) return toCategory<K>(current);

    updateRow(tx, kind, id, set);
    recordAudit(
      tx,
      { entity: AUDIT_ENTITY[kind], entityId: id, action: "update", before, after },
      now,
    );
    return toCategory<K>({ ...current, ...set });
  });
}

/**
 * FR-14: sets the display order. `ids` must list every category exactly once; otherwise the
 * list changed since the page loaded and we refuse instead of guessing.
 * Each category whose position changed gets its own audit row.
 */
export function reorderCategories<K extends CategoryKind>(
  db: AppDatabase,
  kind: K,
  ids: number[],
  now: Date = new Date(),
): CategoryOf<K>[] {
  db.transaction((tx) => {
    const rows = selectAll(tx, kind);
    const known = new Set(rows.map((row) => row.id));
    if (ids.length !== rows.length || !ids.every((id) => known.has(id))) {
      throw new CategoryError(400, CATEGORY_ORDER_STALE_MESSAGE);
    }

    const orderById = new Map(rows.map((row) => [row.id, row.sortOrder]));
    ids.forEach((id, index) => {
      const oldOrder = orderById.get(id);
      const newOrder = index + 1;
      if (oldOrder === newOrder) return;
      updateRow(tx, kind, id, { sortOrder: newOrder });
      recordAudit(
        tx,
        {
          entity: AUDIT_ENTITY[kind],
          entityId: id,
          action: "update",
          before: { order: oldOrder },
          after: { order: newOrder },
        },
        now,
      );
    });
  });
  return listCategories(db, kind);
}

/** FR-14: deletes a category that was never used; otherwise blocks and suggests deactivating. */
export function deleteCategory(
  db: AppDatabase,
  kind: CategoryKind,
  id: number,
  now: Date = new Date(),
): void {
  db.transaction((tx) => {
    const table = TABLES[kind];
    const current = selectOne(tx, kind, id);
    if (!current) throw new CategoryError(404, CATEGORY_TEXTS[kind].notFound);
    if (!canDeleteCategory(countUsages(tx, kind, id))) {
      throw new CategoryError(409, CATEGORY_TEXTS[kind].inUse, CATEGORY_IN_USE_CODE);
    }

    tx.delete(table).where(eq(table.id, id)).run();
    closeOrderGap(tx, kind, current.sortOrder);
    recordAudit(
      tx,
      {
        entity: AUDIT_ENTITY[kind],
        entityId: id,
        action: "delete",
        before: auditSnapshot(current),
      },
      now,
    );
  });
}
