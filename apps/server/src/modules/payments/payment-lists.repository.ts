import { asc, count, eq, gt, max, sql } from "drizzle-orm";
import {
  canDeleteCategory,
  CATEGORY_IN_USE_CODE,
  CATEGORY_ORDER_STALE_MESSAGE,
  categoryNameKey,
  PAYMENT_LIST_TEXTS,
  type AuditValues,
  type CardMachine,
  type MachineUsage,
  type PaymentListKind,
  type PaymentMethod,
} from "@color-bms/core";
import type { AppDatabase } from "../../db/client";
import { cardFees, cardMachines, paymentMethods, sales } from "../../db/schema";
import { BusinessError } from "../../http/route-helpers";
import { recordAudit } from "../audit/audit.repository";

/**
 * FR-15: payment methods and card machines. They follow the same rules as the categories
 * (FR-14): create, rename, deactivate/reactivate, reorder, and delete only if never used.
 * Both tables share their columns, except that payment methods also have `machineUsage`
 * and `allowsInstallments`, so one set of functions serves both: `kind` picks the table.
 *
 * Every write and its audit row (FR-18) run in one transaction.
 */

type Tx = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];

const TABLES = { payment_method: paymentMethods, card_machine: cardMachines } as const;

/** Columns both tables have; payment methods add the last two. */
interface ListRow {
  id: number;
  name: string;
  nameKey: string;
  sortOrder: number;
  active: boolean;
  machineUsage?: MachineUsage;
  allowsInstallments?: boolean;
}

export type PaymentListItem<K extends PaymentListKind> = K extends "payment_method"
  ? PaymentMethod
  : CardMachine;

/** What creating an item needs: payment methods also need their two flags. */
export type CreatePaymentListInput<K extends PaymentListKind> = K extends "payment_method"
  ? { name: string; machineUsage: MachineUsage; allowsInstallments: boolean }
  : { name: string };

/** Fields the owner can change. The last two only exist for payment methods. */
export interface PaymentListChanges {
  name?: string;
  active?: boolean;
  machineUsage?: MachineUsage;
  allowsInstallments?: boolean;
}

function toItem<K extends PaymentListKind>(row: ListRow): PaymentListItem<K> {
  const base = { id: row.id, name: row.name, order: row.sortOrder, active: row.active };
  if (row.machineUsage === undefined) return base as PaymentListItem<K>;
  return {
    ...base,
    machineUsage: row.machineUsage,
    allowsInstallments: row.allowsInstallments,
  } as PaymentListItem<K>;
}

/** The record as stored in the audit log (FR-18). */
function auditSnapshot(row: ListRow): AuditValues {
  return {
    name: row.name,
    ...(row.machineUsage === undefined
      ? {}
      : { machineUsage: row.machineUsage, allowsInstallments: row.allowsInstallments }),
    order: row.sortOrder,
    active: row.active,
  };
}

// Drizzle cannot type a query on "one of two tables", so reads and writes go through these
// helpers, which only touch the shared columns or branch on `kind`.

function selectAll(db: AppDatabase | Tx, kind: PaymentListKind): ListRow[] {
  const table = TABLES[kind];
  return db.select().from(table).orderBy(asc(table.sortOrder), asc(table.id)).all() as ListRow[];
}

function selectOne(tx: Tx, kind: PaymentListKind, id: number): ListRow | undefined {
  const table = TABLES[kind];
  return tx.select().from(table).where(eq(table.id, id)).get() as ListRow | undefined;
}

function updateRow(tx: Tx, kind: PaymentListKind, id: number, set: Partial<ListRow>): void {
  if (kind === "payment_method") {
    tx.update(paymentMethods).set(set).where(eq(paymentMethods.id, id)).run();
  } else {
    const { machineUsage: _usage, allowsInstallments: _installments, ...machineSet } = set;
    tx.update(cardMachines).set(machineSet).where(eq(cardMachines.id, id)).run();
  }
}

/** After a delete, moves every later item up by one so the order stays 1..n (as FR-14). */
function closeOrderGap(tx: Tx, kind: PaymentListKind, removedOrder: number): void {
  if (kind === "payment_method") {
    tx.update(paymentMethods)
      .set({ sortOrder: sql`${paymentMethods.sortOrder} - 1` })
      .where(gt(paymentMethods.sortOrder, removedOrder))
      .run();
  } else {
    tx.update(cardMachines)
      .set({ sortOrder: sql`${cardMachines.sortOrder} - 1` })
      .where(gt(cardMachines.sortOrder, removedOrder))
      .run();
  }
}

/**
 * FR-15: how many fee rows and sales use this item. Delete is allowed only at 0.
 * A machine or method with fee rows counts as used: the owner deletes the rows first, or
 * deactivates it. Sales keep it for good (history), so then only deactivating is possible.
 */
function countUsages(tx: Tx, kind: PaymentListKind, id: number): number {
  const feeColumn = kind === "payment_method" ? cardFees.paymentMethodId : cardFees.cardMachineId;
  const saleColumn = kind === "payment_method" ? sales.paymentMethodId : sales.cardMachineId;
  const fees = tx.select({ value: count() }).from(cardFees).where(eq(feeColumn, id)).get();
  const sold = tx.select({ value: count() }).from(sales).where(eq(saleColumn, id)).get();
  return (fees?.value ?? 0) + (sold?.value ?? 0);
}

/** FR-15 (as FR-14): blocks a name already used by another item of the same list. */
function assertNameIsFree(tx: Tx, kind: PaymentListKind, nameKey: string, exceptId?: number) {
  const table = TABLES[kind];
  const other = tx.select({ id: table.id }).from(table).where(eq(table.nameKey, nameKey)).get();
  if (other && other.id !== exceptId) {
    throw new BusinessError(409, PAYMENT_LIST_TEXTS[kind].duplicate);
  }
}

function notFound(kind: PaymentListKind): BusinessError {
  return new BusinessError(404, PAYMENT_LIST_TEXTS[kind].notFound);
}

/** FR-15: the list in display order; `active: true` is what the sale form offers. */
export function listPaymentItems<K extends PaymentListKind>(
  db: AppDatabase,
  kind: K,
  active?: boolean,
): PaymentListItem<K>[] {
  return selectAll(db, kind)
    .filter((row) => active === undefined || row.active === active)
    .map((row) => toItem<K>(row));
}

/** FR-15: creates an active item at the end of the list. */
export function createPaymentItem<K extends PaymentListKind>(
  db: AppDatabase,
  kind: K,
  input: CreatePaymentListInput<K>,
  now: Date = new Date(),
): PaymentListItem<K> {
  return db.transaction((tx) => {
    const table = TABLES[kind];
    const nameKey = categoryNameKey(input.name);
    assertNameIsFree(tx, kind, nameKey);

    const last = tx
      .select({ value: max(table.sortOrder) })
      .from(table)
      .get();
    const values = { name: input.name, nameKey, sortOrder: (last?.value ?? 0) + 1, active: true };
    const row: ListRow =
      "machineUsage" in input
        ? tx
            .insert(paymentMethods)
            .values({
              ...values,
              machineUsage: input.machineUsage,
              allowsInstallments: input.allowsInstallments,
            })
            .returning()
            .get()
        : tx.insert(cardMachines).values(values).returning().get();

    recordAudit(
      tx,
      { entity: kind, entityId: row.id, action: "create", after: auditSnapshot(row) },
      now,
    );
    return toItem<K>(row);
  });
}

/**
 * FR-15: renames, (de)activates and, for payment methods, changes machine usage or
 * installments. Sales keep their own copy of the fee (spec §6.3), so the past never changes.
 * Only the fields that really changed go to the audit log; no change, no audit row.
 */
export function updatePaymentItem<K extends PaymentListKind>(
  db: AppDatabase,
  kind: K,
  id: number,
  changes: PaymentListChanges,
  now: Date = new Date(),
): PaymentListItem<K> {
  return db.transaction((tx) => {
    const current = selectOne(tx, kind, id);
    if (!current) throw notFound(kind);

    const set: Partial<ListRow> = {};
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
    if (kind === "payment_method") {
      if (changes.machineUsage !== undefined && changes.machineUsage !== current.machineUsage) {
        set.machineUsage = changes.machineUsage;
        before.machineUsage = current.machineUsage;
        after.machineUsage = changes.machineUsage;
      }
      if (
        changes.allowsInstallments !== undefined &&
        changes.allowsInstallments !== current.allowsInstallments
      ) {
        set.allowsInstallments = changes.allowsInstallments;
        before.allowsInstallments = current.allowsInstallments;
        after.allowsInstallments = changes.allowsInstallments;
      }
    }

    if (Object.keys(set).length === 0) return toItem<K>(current);

    updateRow(tx, kind, id, set);
    recordAudit(tx, { entity: kind, entityId: id, action: "update", before, after }, now);
    return toItem<K>({ ...current, ...set });
  });
}

/**
 * FR-15 (as FR-14): sets the display order. `ids` must list every item exactly once.
 * Each item whose position changed gets its own audit row.
 */
export function reorderPaymentItems<K extends PaymentListKind>(
  db: AppDatabase,
  kind: K,
  ids: number[],
  now: Date = new Date(),
): PaymentListItem<K>[] {
  db.transaction((tx) => {
    const rows = selectAll(tx, kind);
    const known = new Set(rows.map((row) => row.id));
    if (ids.length !== rows.length || !ids.every((id) => known.has(id))) {
      throw new BusinessError(400, CATEGORY_ORDER_STALE_MESSAGE);
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
          entity: kind,
          entityId: id,
          action: "update",
          before: { order: oldOrder },
          after: { order: newOrder },
        },
        now,
      );
    });
  });
  return listPaymentItems(db, kind);
}

/** FR-15 (as FR-14): deletes an item never used; otherwise blocks and suggests deactivating. */
export function deletePaymentItem(
  db: AppDatabase,
  kind: PaymentListKind,
  id: number,
  now: Date = new Date(),
): void {
  db.transaction((tx) => {
    const table = TABLES[kind];
    const current = selectOne(tx, kind, id);
    if (!current) throw notFound(kind);
    if (!canDeleteCategory(countUsages(tx, kind, id))) {
      throw new BusinessError(409, PAYMENT_LIST_TEXTS[kind].inUse, CATEGORY_IN_USE_CODE);
    }

    tx.delete(table).where(eq(table.id, id)).run();
    closeOrderGap(tx, kind, current.sortOrder);
    recordAudit(
      tx,
      { entity: kind, entityId: id, action: "delete", before: auditSnapshot(current) },
      now,
    );
  });
}
