import { and, asc, eq, type SQL } from "drizzle-orm";
import {
  calculateSaleAmounts,
  CARD_FEE_MISSING_CODE,
  DAY_CLOSED_CODE,
  feeInstallments,
  missingFeeMessage,
  monthOf,
  needsCardFee,
  periodLockError,
  resolveInstallments,
  saleChangeLockError,
  saleDateError,
  SALE_HAS_REFUNDS_CODE,
  saleMachineError,
  SALE_TEXTS,
  summarizeDaySales,
  todayCivilDate,
  type AuditValues,
  type CivilDate,
  type DaySalesResponse,
  type ParsedCreateSaleInput,
  type ParsedUpdateSaleInput,
  type Sale,
} from "@color-bms/core";
import type { AppDatabase, AppTransaction } from "../../db/client";
import { cardMachines, days, months, paymentMethods, saleCategories, sales } from "../../db/schema";
import { BusinessError } from "../../http/route-helpers";
import { recordAudit } from "../audit/audit.repository";
import { listCategories } from "../categories/categories.repository";
import { listPaymentItems } from "../payments/payment-lists.repository";
import { findCardFeeInForce } from "../payments/card-fees.repository";

/**
 * FR-01 / FR-02 / FR-03 / FR-05: registering, editing, deleting and listing sales. The business write and its audit row (FR-18) run in one
 * transaction, and so do all the checks, so nothing can change between check and insert.
 */

type Tx = AppTransaction;

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
    })
    .from(sales)
    .innerJoin(saleCategories, eq(saleCategories.id, sales.saleCategoryId))
    .innerJoin(paymentMethods, eq(paymentMethods.id, sales.paymentMethodId))
    .leftJoin(cardMachines, eq(cardMachines.id, sales.cardMachineId))
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
  return { date, lock: saleChangeLockError(date, periodStatus(db, date)), ...summary };
}

/** The sale as stored in the audit log (FR-18): names, not ids; money in cents. */
function auditSnapshot(sale: Sale): AuditValues {
  return {
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

/**
 * The sale FR-03 may change: it exists, is not a refund (#6), has no refunds, and its day and
 * month are open (RN-14). The lock is checked before the fields, so a closed day is reported
 * first.
 */
function changeableSale(tx: Tx, id: number): Sale {
  const sale = findSale(tx, id);
  if (!sale) throw new BusinessError(404, SALE_TEXTS.notFound);
  if (sale.type !== "sale") throw new BusinessError(400, SALE_TEXTS.refundNotEditable);
  const refund = tx
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.originalSaleId, id), eq(sales.type, "refund")))
    .get();
  if (refund) throw new BusinessError(409, SALE_TEXTS.hasRefunds, SALE_HAS_REFUNDS_CODE);
  const lockError = saleChangeLockError(sale.date, periodStatus(tx, sale.date));
  if (lockError) throw new BusinessError(409, lockError, DAY_CLOSED_CODE);
  return sale;
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
    const before = changeableSale(tx, id);
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

/** FR-03: deletes a sale on an open day; the audit row keeps its values (FR-18). */
export function deleteSale(db: AppDatabase, id: number, now: Date): void {
  db.transaction((tx) => {
    const before = changeableSale(tx, id);
    tx.delete(sales).where(eq(sales.id, id)).run();
    recordAudit(
      tx,
      { entity: "sale", entityId: id, action: "delete", before: auditSnapshot(before) },
      now,
    );
  });
}
