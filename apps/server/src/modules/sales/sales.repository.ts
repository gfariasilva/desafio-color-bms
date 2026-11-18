import { asc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  calculateRefundAmounts,
  calculateSaleAmounts,
  CARD_FEE_MISSING_CODE,
  DAY_CLOSED_CODE,
  feeInstallments,
  missingFeeMessage,
  monthOf,
  needsCardFee,
  periodLockError,
  refundChangeLockError,
  REFUND_EXCEEDS_SALE_CODE,
  REFUND_TEXTS,
  refundDateError,
  refundLimitError,
  resolveInstallments,
  saleChangeLockError,
  saleDateError,
  SALE_HAS_REFUNDS_CODE,
  saleMachineError,
  SALE_TEXTS,
  summarizeDaySales,
  todayCivilDate,
  type AuditEntity,
  type AuditValues,
  type CivilDate,
  type DaySalesResponse,
  type ParsedCreateRefundInput,
  type ParsedCreateSaleInput,
  type ParsedUpdateSaleInput,
  type Sale,
  type SaleType,
} from "@color-bms/core";
import type { AppDatabase, AppTransaction } from "../../db/client";
import { cardMachines, days, months, paymentMethods, saleCategories, sales } from "../../db/schema";
import { BusinessError } from "../../http/route-helpers";
import { recordAudit } from "../audit/audit.repository";
import { listCategories } from "../categories/categories.repository";
import { listPaymentItems } from "../payments/payment-lists.repository";
import { findCardFeeInForce } from "../payments/card-fees.repository";

/**
 * FR-01 / FR-02 / FR-03 / FR-04 / FR-05: registering, editing, deleting, refunding and listing
 * sales. The business write and its audit row (FR-18) run in one transaction, and so do all
 * the checks, so nothing can change between check and insert.
 */

type Tx = AppTransaction;

/** The refunded sale of a refund row (self-join on `original_sale_id`). */
const originalSales = alias(sales, "original_sales");

/**
 * RN-04: how much of a sale was refunded so far, as positive cents (refund rows are negative).
 * Always 0 for refund rows, which have no refunds of their own: the CASE skips the lookup
 * for them (it uses the `sales_original_sale_idx` index for sales).
 */
const refundedCentsSql = sql<number>`case when ${sales.type} = 'refund' then 0 else coalesce((
  select -sum(refund_rows.gross_cents) from sales as refund_rows
  where refund_rows.original_sale_id = ${sales.id} and refund_rows.type = 'refund'
), 0) end`.mapWith(Number);

/** FR-18: the audit entity of each kind of row in the sales table. */
const AUDIT_ENTITY_BY_TYPE: Record<SaleType, AuditEntity> = { sale: "sale", refund: "refund" };

/** Sales with the names of their tab, method and machine, filtered by `where`. */
function selectSales(db: AppDatabase | Tx, where: SQL | undefined): Sale[] {
  return db
    .select({
      id: sales.id,
      date: sales.date,
      createdAt: sales.createdAt,
      type: sales.type,
      saleCategoryId: sales.saleCategoryId,
      saleCategoryName: saleCategories.name,
      paymentMethodId: sales.paymentMethodId,
      paymentMethodName: paymentMethods.name,
      cardMachineId: sales.cardMachineId,
      cardMachineName: cardMachines.name,
      installments: sales.installments,
      grossCents: sales.grossCents,
      feeRatePpm: sales.feeRatePpm,
      feeCents: sales.feeCents,
      netCents: sales.netCents,
      note: sales.note,
      originalSaleId: sales.originalSaleId,
      originalSaleDate: originalSales.date,
      reason: sales.reason,
      refundedCents: refundedCentsSql,
    })
    .from(sales)
    .innerJoin(saleCategories, eq(saleCategories.id, sales.saleCategoryId))
    .innerJoin(paymentMethods, eq(paymentMethods.id, sales.paymentMethodId))
    .leftJoin(cardMachines, eq(cardMachines.id, sales.cardMachineId))
    .leftJoin(originalSales, eq(originalSales.id, sales.originalSaleId))
    .where(where)
    .orderBy(asc(sales.createdAt), asc(sales.id))
    .all();
}

/** The sales of one civil date, with names, in the order they were registered. */
export function listSales(db: AppDatabase | Tx, date: CivilDate): Sale[] {
  return selectSales(db, eq(sales.date, date));
}

function findSale(db: AppDatabase | Tx, id: number): Sale | undefined {
  return selectSales(db, eq(sales.id, id))[0];
}

/** RN-14: is the date's day or month closed? No row means open. */
function periodStatus(db: AppDatabase | Tx, date: CivilDate) {
  const day = db.select({ status: days.status }).from(days).where(eq(days.date, date)).get();
  const month = db
    .select({ status: months.status })
    .from(months)
    .where(eq(months.yearMonth, monthOf(date)))
    .get();
  return { dayClosed: day?.status === "closed", monthClosed: month?.status === "closed" };
}

/**
 * FR-05 / RN-05: the day grouped by tab, with subtotals per payment method and the totals,
 * plus the RN-14 lock message the UI shows when the day cannot change.
 */
export function getDaySales(db: AppDatabase, date: CivilDate): DaySalesResponse {
  // better-sqlite3 is synchronous: nothing can write between these reads.
  const summary = summarizeDaySales({
    tabs: listCategories(db, "sale"),
    methods: listPaymentItems(db, "payment_method"),
    sales: listSales(db, date),
  });
  const status = periodStatus(db, date);
  return {
    date,
    lock: saleChangeLockError(date, status),
    refundLock: refundChangeLockError(date, status),
    ...summary,
  };
}

/**
 * The sale or refund as stored in the audit log (FR-18): names, not ids; money in cents.
 * A refund also keeps the sale it refunds and its reason (FR-04).
 */
function auditSnapshot(sale: Sale): AuditValues {
  const refund =
    sale.type === "refund"
      ? {
          originalSaleId: sale.originalSaleId,
          originalSaleDate: sale.originalSaleDate,
          reason: sale.reason,
        }
      : {};
  return {
    ...refund,
    date: sale.date,
    saleCategory: sale.saleCategoryName,
    paymentMethod: sale.paymentMethodName,
    cardMachine: sale.cardMachineName,
    installments: sale.installments,
    grossCents: sale.grossCents,
    feeRatePpm: sale.feeRatePpm,
    feeCents: sale.feeCents,
    netCents: sale.netCents,
    note: sale.note,
  };
}

/** Everything a sale needs before its tab, method and machine are checked. */
interface SaleFields {
  date: CivilDate;
  saleCategoryId: number;
  paymentMethodId: number;
  cardMachineId: number | null;
  installments: number | null | undefined;
  grossCents: number;
  note: string | null;
}

/** The columns written for a sale, after every check passed. */
interface PricedSale {
  date: CivilDate;
  saleCategoryId: number;
  paymentMethodId: number;
  cardMachineId: number | null;
  installments: number | null;
  grossCents: number;
  feeRatePpm: number;
  feeCents: number;
  netCents: number;
  note: string | null;
}

/**
 * The FR-01 checks shared by creating (FR-01) and editing (FR-03) a sale, in order: active
 * tab, method and machine; machine and installments for the method; no future date (RN-15);
 * open day and month (RN-14); the fee in force on the sale date (RN-01). Then the rate is
 * copied and fee and net computed (RN-02, RN-03, FR-02).
 *
 * `current` is the saved sale when editing: it may keep a tab, method or machine that was
 * deactivated since; anything newly chosen must be active.
 */
function checkAndPrice(
  tx: Tx,
  fields: SaleFields,
  now: Date,
  options: { current?: Sale; lockMessage: typeof periodLockError },
): PricedSale {
  const { current } = options;
  const usable = (item: { id: number; active: boolean } | undefined, currentId?: number | null) =>
    item !== undefined && (item.active || item.id === currentId);

  const category = tx
    .select()
    .from(saleCategories)
    .where(eq(saleCategories.id, fields.saleCategoryId))
    .get();
  if (!usable(category, current?.saleCategoryId)) {
    throw new BusinessError(400, SALE_TEXTS.inactiveCategory);
  }

  const method = tx
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.id, fields.paymentMethodId))
    .get();
  if (!method || !usable(method, current?.paymentMethodId)) {
    throw new BusinessError(400, SALE_TEXTS.inactiveMethod);
  }

  const machineError = saleMachineError(method, fields.cardMachineId);
  if (machineError) throw new BusinessError(400, machineError);
  const machine =
    fields.cardMachineId === null
      ? undefined
      : tx.select().from(cardMachines).where(eq(cardMachines.id, fields.cardMachineId)).get();
  if (fields.cardMachineId !== null && !usable(machine, current?.cardMachineId)) {
    throw new BusinessError(400, SALE_TEXTS.inactiveMachine);
  }

  const resolved = resolveInstallments(method, fields.installments);
  if ("error" in resolved) throw new BusinessError(400, resolved.error);
  const { installments } = resolved;

  const dateError = saleDateError(fields.date, todayCivilDate(now));
  if (dateError) throw new BusinessError(400, dateError);

  const lockError = options.lockMessage(fields.date, periodStatus(tx, fields.date));
  if (lockError) throw new BusinessError(409, lockError, DAY_CLOSED_CODE);

  // RN-02: Dinheiro, Boleto and PIX without a machine have rate 0.
  let feeRatePpm = 0;
  if (machine && needsCardFee(method, machine.id)) {
    const fee = findCardFeeInForce(tx, {
      cardMachineId: machine.id,
      paymentMethodId: method.id,
      installments: feeInstallments(installments),
      date: fields.date,
    });
    if (!fee) {
      throw new BusinessError(
        409,
        missingFeeMessage(machine.name, method.name, feeInstallments(installments)),
        CARD_FEE_MISSING_CODE,
      );
    }
    feeRatePpm = fee.ratePpm;
  }
  const { feeCents, netCents } = calculateSaleAmounts(fields.grossCents, feeRatePpm);

  return {
    date: fields.date,
    saleCategoryId: fields.saleCategoryId,
    paymentMethodId: method.id,
    cardMachineId: fields.cardMachineId,
    installments,
    grossCents: fields.grossCents,
    feeRatePpm,
    feeCents,
    netCents,
    note: fields.note,
  };
}

/**
 * FR-01: registers a sale (checks in `checkAndPrice`) and saves it with its audit row, all in
 * one transaction, so nothing can change between check and insert.
 */
export function createSale(db: AppDatabase, input: ParsedCreateSaleInput, now: Date): Sale {
  return db.transaction((tx) => {
    const priced = checkAndPrice(
      tx,
      {
        date: input.date,
        saleCategoryId: input.saleCategoryId,
        paymentMethodId: input.paymentMethodId,
        cardMachineId: input.cardMachineId ?? null,
        installments: input.installments,
        grossCents: input.grossCents,
        note: input.note ?? null,
      },
      now,
      { lockMessage: periodLockError },
    );
    const row = tx
      .insert(sales)
      .values({ ...priced, createdAt: now.toISOString(), type: "sale" })
      .returning({ id: sales.id })
      .get();
    const sale = findSale(tx, row.id)!;
    recordAudit(
      tx,
      { entity: "sale", entityId: sale.id, action: "create", after: auditSnapshot(sale) },
      now,
    );
    return sale;
  });
}

/** The sale or refund with this id, or 404. */
function existingSale(tx: Tx, id: number): Sale {
  const sale = findSale(tx, id);
  if (!sale) throw new BusinessError(404, SALE_TEXTS.notFound);
  return sale;
}

/**
 * The sale FR-03 may change: a sale (refunds are never edited, FR-04) without refunds (its
 * refunds point at its values, RN-04), on an open day and month (RN-14). The lock is checked
 * before the fields, so a closed day is reported first.
 */
function changeableSale(tx: Tx, sale: Sale): Sale {
  if (sale.type !== "sale") throw new BusinessError(400, REFUND_TEXTS.notEditable);
  if (sale.refundedCents > 0) {
    throw new BusinessError(409, SALE_TEXTS.hasRefunds, SALE_HAS_REFUNDS_CODE);
  }
  const lockError = saleChangeLockError(sale.date, periodStatus(tx, sale.date));
  if (lockError) throw new BusinessError(409, lockError, DAY_CLOSED_CODE);
  return sale;
}

/**
 * The row FR-03 / FR-04 may delete: a sale as `changeableSale` says, or a refund on an open
 * day and month (RN-14), with the refund's own lock message.
 */
function deletableRow(tx: Tx, row: Sale): Sale {
  if (row.type === "sale") return changeableSale(tx, row);
  const lockError = refundChangeLockError(row.date, periodStatus(tx, row.date));
  if (lockError) throw new BusinessError(409, lockError, DAY_CLOSED_CODE);
  return row;
}

/**
 * FR-03: edits a sale on an open day. The changes are merged into the saved sale, which is
 * then checked like a new one; the fee in force on the sale date is applied again (FR-02).
 * The audit row holds the values before and after; an edit that changes nothing writes none.
 */
export function updateSale(
  db: AppDatabase,
  id: number,
  input: ParsedUpdateSaleInput,
  now: Date,
): Sale {
  return db.transaction((tx) => {
    const before = changeableSale(tx, existingSale(tx, id));
    const paymentMethodId = input.paymentMethodId ?? before.paymentMethodId;
    // A new method drops the saved machine / installments it does not use (as the form does),
    // so `{ paymentMethodId }` alone can switch Crédito to Dinheiro.
    const newMethod =
      paymentMethodId === before.paymentMethodId
        ? undefined
        : tx.select().from(paymentMethods).where(eq(paymentMethods.id, paymentMethodId)).get();
    const keptMachine = newMethod?.machineUsage === "not_applicable" ? null : before.cardMachineId;
    const keptInstallments =
      newMethod && !newMethod.allowsInstallments ? null : before.installments;
    const priced = checkAndPrice(
      tx,
      {
        date: input.date ?? before.date,
        saleCategoryId: input.saleCategoryId ?? before.saleCategoryId,
        paymentMethodId,
        cardMachineId: input.cardMachineId === undefined ? keptMachine : input.cardMachineId,
        installments: input.installments === undefined ? keptInstallments : input.installments,
        grossCents: input.grossCents ?? before.grossCents,
        note: input.note === undefined ? before.note : input.note,
      },
      now,
      { current: before, lockMessage: saleChangeLockError },
    );
    tx.update(sales).set(priced).where(eq(sales.id, id)).run();
    const after = findSale(tx, id)!;
    const beforeValues = auditSnapshot(before);
    const afterValues = auditSnapshot(after);
    if (JSON.stringify(beforeValues) !== JSON.stringify(afterValues)) {
      recordAudit(
        tx,
        {
          entity: "sale",
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

/**
 * FR-03: deletes a sale on an open day. A refund can also be deleted while its day is open
 * (RN-14), which frees its amount again (RN-04). The audit row keeps the values (FR-18).
 */
export function deleteSale(db: AppDatabase, id: number, now: Date): void {
  db.transaction((tx) => {
    const found = deletableRow(tx, existingSale(tx, id));
    tx.delete(sales).where(eq(sales.id, id)).run();
    recordAudit(
      tx,
      {
        entity: AUDIT_ENTITY_BY_TYPE[found.type],
        entityId: id,
        action: "delete",
        before: auditSnapshot(found),
        reason: found.reason,
      },
      now,
    );
  });
}

/**
 * FR-04 / RN-04: refunds all or part of a sale from an earlier day. The refund is a new row
 * dated **today**, with the original's tab, method, machine, installments and rate (even if
 * one of them was deactivated since), negative amounts, the link to the sale and the reason.
 * The original sale never changes. Checks, insert and audit row run in one transaction.
 */
export function createRefund(
  db: AppDatabase,
  saleId: number,
  input: ParsedCreateRefundInput,
  now: Date,
): Sale {
  return db.transaction((tx) => {
    const original = existingSale(tx, saleId);
    if (original.type !== "sale") throw new BusinessError(400, REFUND_TEXTS.refundOfRefund);

    const today = todayCivilDate(now);
    const dateError = refundDateError(original.date, today);
    if (dateError) throw new BusinessError(400, dateError);

    // RN-14: the refund is created today, so today (and its month) must be open.
    const lockError = periodLockError(today, periodStatus(tx, today));
    if (lockError) throw new BusinessError(409, lockError, DAY_CLOSED_CODE);

    const limitError = refundLimitError(
      original.grossCents,
      original.refundedCents,
      input.refundCents,
    );
    if (limitError) throw new BusinessError(409, limitError, REFUND_EXCEEDS_SALE_CODE);

    const amounts = calculateRefundAmounts(input.refundCents, original.feeRatePpm);
    const row = tx
      .insert(sales)
      .values({
        date: today,
        createdAt: now.toISOString(),
        type: "refund",
        saleCategoryId: original.saleCategoryId,
        paymentMethodId: original.paymentMethodId,
        cardMachineId: original.cardMachineId,
        installments: original.installments,
        feeRatePpm: original.feeRatePpm,
        ...amounts,
        originalSaleId: original.id,
        reason: input.reason,
        note: null,
      })
      .returning({ id: sales.id })
      .get();
    const refund = findSale(tx, row.id)!;
    recordAudit(
      tx,
      {
        entity: "refund",
        entityId: refund.id,
        action: "create",
        after: auditSnapshot(refund),
        reason: input.reason,
      },
      now,
    );
    return refund;
  });
}
