import { asc, eq } from "drizzle-orm";
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
  saleDateError,
  saleMachineError,
  SALE_TEXTS,
  todayCivilDate,
  type AuditValues,
  type CivilDate,
  type ParsedCreateSaleInput,
  type Sale,
} from "@color-bms/core";
import type { AppDatabase, AppTransaction } from "../../db/client";
import { cardMachines, days, months, paymentMethods, saleCategories, sales } from "../../db/schema";
import { BusinessError } from "../../http/route-helpers";
import { recordAudit } from "../audit/audit.repository";
import { findCardFeeInForce } from "../payments/card-fees.repository";

/**
 * FR-01 / FR-02: registering sales. The business write and its audit row (FR-18) run in one
 * transaction, and so do all the checks, so nothing can change between check and insert.
 */

type Tx = AppTransaction;

/** The sales of one civil date, with names, in the order they were registered. */
export function listSales(db: AppDatabase | Tx, date: CivilDate): Sale[] {
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
    .where(eq(sales.date, date))
    .orderBy(asc(sales.createdAt), asc(sales.id))
    .all();
}

/** RN-14: is the date's day or month closed? No row means open. */
function periodLock(tx: Tx, date: CivilDate): string | null {
  const day = tx.select({ status: days.status }).from(days).where(eq(days.date, date)).get();
  const month = tx
    .select({ status: months.status })
    .from(months)
    .where(eq(months.yearMonth, monthOf(date)))
    .get();
  return periodLockError(date, {
    dayClosed: day?.status === "closed",
    monthClosed: month?.status === "closed",
  });
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

/**
 * FR-01: registers a sale. Checks, in order: active tab, method and machine; machine and
 * installments for the method (FR-01); no future date (RN-15); open day and month (RN-14);
 * the fee in force (RN-01). Then copies the rate and computes fee and net (RN-02, RN-03,
 * FR-02), and saves the sale with its audit row.
 */
export function createSale(db: AppDatabase, input: ParsedCreateSaleInput, now: Date): Sale {
  return db.transaction((tx) => {
    const category = tx
      .select()
      .from(saleCategories)
      .where(eq(saleCategories.id, input.saleCategoryId))
      .get();
    if (!category?.active) throw new BusinessError(400, SALE_TEXTS.inactiveCategory);

    const method = tx
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.id, input.paymentMethodId))
      .get();
    if (!method?.active) throw new BusinessError(400, SALE_TEXTS.inactiveMethod);

    const cardMachineId = input.cardMachineId ?? null;
    const machineError = saleMachineError(method, cardMachineId);
    if (machineError) throw new BusinessError(400, machineError);
    const machine =
      cardMachineId === null
        ? undefined
        : tx.select().from(cardMachines).where(eq(cardMachines.id, cardMachineId)).get();
    if (cardMachineId !== null && !machine?.active) {
      throw new BusinessError(400, SALE_TEXTS.inactiveMachine);
    }

    const resolved = resolveInstallments(method, input.installments);
    if ("error" in resolved) throw new BusinessError(400, resolved.error);
    const { installments } = resolved;

    const dateError = saleDateError(input.date, todayCivilDate(now));
    if (dateError) throw new BusinessError(400, dateError);

    const lockError = periodLock(tx, input.date);
    if (lockError) throw new BusinessError(409, lockError, DAY_CLOSED_CODE);

    // RN-02: Dinheiro, Boleto and PIX without a machine have rate 0.
    let feeRatePpm = 0;
    if (machine && needsCardFee(method, machine.id)) {
      const fee = findCardFeeInForce(tx, {
        cardMachineId: machine.id,
        paymentMethodId: method.id,
        installments: feeInstallments(installments),
        date: input.date,
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
    const { feeCents, netCents } = calculateSaleAmounts(input.grossCents, feeRatePpm);

    const row = tx
      .insert(sales)
      .values({
        date: input.date,
        createdAt: now.toISOString(),
        type: "sale",
        saleCategoryId: category.id,
        paymentMethodId: method.id,
        cardMachineId,
        installments,
        grossCents: input.grossCents,
        feeRatePpm,
        feeCents,
        netCents,
        note: input.note ?? null,
      })
      .returning()
      .get();

    const sale: Sale = {
      id: row.id,
      date: row.date,
      createdAt: row.createdAt,
      type: row.type,
      saleCategoryId: row.saleCategoryId,
      saleCategoryName: category.name,
      paymentMethodId: row.paymentMethodId,
      paymentMethodName: method.name,
      cardMachineId: row.cardMachineId,
      cardMachineName: machine?.name ?? null,
      installments: row.installments,
      grossCents: row.grossCents,
      feeRatePpm: row.feeRatePpm,
      feeCents: row.feeCents,
      netCents: row.netCents,
      note: row.note,
    };
    recordAudit(
      tx,
      { entity: "sale", entityId: sale.id, action: "create", after: auditSnapshot(sale) },
      now,
    );
    return sale;
  });
}
