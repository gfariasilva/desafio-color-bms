import { and, asc, desc, eq, lte } from "drizzle-orm";
import {
  canHaveCardFee,
  CARD_FEE_TEXTS,
  cardFeeOverlapMessage,
  findFeeInForce,
  findOverlappingFee,
  type AuditValues,
  type CardFee,
  type CardFeeInForceQuery,
  type CardFeeInput,
} from "@color-bms/core";
import type { AppDatabase } from "../../db/client";
import { cardFees, cardMachines, paymentMethods } from "../../db/schema";
import { BusinessError } from "../../http/route-helpers";
import { recordAudit } from "../audit/audit.repository";

/**
 * FR-15: the fee table. Rows can be added, edited and deleted. Sales keep their own copy of
 * the rate (spec §6.3), so none of this changes a sale already saved.
 *
 * Every write and its audit row (FR-18) run in one transaction.
 */

type Tx = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];
type FeeRow = typeof cardFees.$inferSelect;

/** The fields compared and audited, in a stable order. */
const FEE_FIELDS = [
  "installmentsFrom",
  "installmentsTo",
  "ratePpm",
  "validFrom",
] as const satisfies readonly (keyof CardFeeInput)[];

function toFee(row: FeeRow): CardFee {
  return {
    id: row.id,
    cardMachineId: row.cardMachineId,
    paymentMethodId: row.paymentMethodId,
    installmentsFrom: row.installmentsFrom,
    installmentsTo: row.installmentsTo,
    ratePpm: row.ratePpm,
    validFrom: row.validFrom,
  };
}

/** Machine and method names, so the Auditoria screen reads "PagSeguro", not an id. */
interface Names {
  cardMachine: string;
  paymentMethod: string;
}

/** The record as stored in the audit log (FR-18). */
function auditSnapshot(fee: CardFeeInput, names: Names): AuditValues {
  return {
    cardMachine: names.cardMachine,
    paymentMethod: names.paymentMethod,
    installmentsFrom: fee.installmentsFrom,
    installmentsTo: fee.installmentsTo,
    ratePpm: fee.ratePpm,
    validFrom: fee.validFrom,
  };
}

function namesOf(tx: Tx, row: Pick<FeeRow, "cardMachineId" | "paymentMethodId">): Names {
  const machine = tx
    .select({ name: cardMachines.name })
    .from(cardMachines)
    .where(eq(cardMachines.id, row.cardMachineId))
    .get();
  const method = tx
    .select({ name: paymentMethods.name })
    .from(paymentMethods)
    .where(eq(paymentMethods.id, row.paymentMethodId))
    .get();
  return { cardMachine: machine?.name ?? "?", paymentMethod: method?.name ?? "?" };
}

/**
 * FR-15: checks a row before saving it: the machine and the method exist, the method uses a
 * card machine, installments above 1x only for methods that allow them, and no overlap with
 * another row of the same machine, method and "vigente desde". Returns the names for the audit.
 */
function validate(tx: Tx, input: CardFeeInput, exceptId?: number): Names {
  const machine = tx
    .select()
    .from(cardMachines)
    .where(eq(cardMachines.id, input.cardMachineId))
    .get();
  if (!machine) throw new BusinessError(400, CARD_FEE_TEXTS.cardMachineNotFound);
  const method = tx
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.id, input.paymentMethodId))
    .get();
  if (!method) throw new BusinessError(400, CARD_FEE_TEXTS.paymentMethodNotFound);

  if (!canHaveCardFee(method)) {
    throw new BusinessError(400, CARD_FEE_TEXTS.noCardMachine(method.name));
  }
  if (!method.allowsInstallments && input.installmentsTo > 1) {
    throw new BusinessError(400, CARD_FEE_TEXTS.noInstallments(method.name));
  }

  const sameDate = tx
    .select()
    .from(cardFees)
    .where(
      and(
        eq(cardFees.cardMachineId, input.cardMachineId),
        eq(cardFees.paymentMethodId, input.paymentMethodId),
        eq(cardFees.validFrom, input.validFrom),
      ),
    )
    .all();
  const overlap = findOverlappingFee(sameDate, input, exceptId);
  if (overlap) {
    throw new BusinessError(409, cardFeeOverlapMessage(machine.name, method.name, overlap));
  }
  return { cardMachine: machine.name, paymentMethod: method.name };
}

/**
 * FR-15: every row, ordered for the screen: by machine order, method order, installment
 * range, then the newest "vigente desde" first.
 */
export function listCardFees(db: AppDatabase): CardFee[] {
  return db
    .select({ fee: cardFees })
    .from(cardFees)
    .innerJoin(cardMachines, eq(cardFees.cardMachineId, cardMachines.id))
    .innerJoin(paymentMethods, eq(cardFees.paymentMethodId, paymentMethods.id))
    .orderBy(
      asc(cardMachines.sortOrder),
      asc(paymentMethods.sortOrder),
      asc(cardFees.installmentsFrom),
      asc(cardFees.installmentsTo),
      desc(cardFees.validFrom),
      asc(cardFees.id),
    )
    .all()
    .map(({ fee }) => toFee(fee));
}

/** RN-01: the fee in force for a sale, or null when there is none (FR-01 then blocks it). */
export function findCardFeeInForce(db: AppDatabase, query: CardFeeInForceQuery): CardFee | null {
  // Only rows of this machine and method that already started; the core rule picks one.
  const candidates = db
    .select()
    .from(cardFees)
    .where(
      and(
        eq(cardFees.cardMachineId, query.cardMachineId),
        eq(cardFees.paymentMethodId, query.paymentMethodId),
        lte(cardFees.validFrom, query.date),
      ),
    )
    .all();
  const fee = findFeeInForce(candidates, query);
  return fee ? toFee(fee) : null;
}

/** FR-15: adds a row to the fee table. */
export function createCardFee(db: AppDatabase, input: CardFeeInput, now: Date = new Date()) {
  return db.transaction((tx) => {
    const names = validate(tx, input);
    const row = tx.insert(cardFees).values(input).returning().get();
    recordAudit(
      tx,
      {
        entity: "card_fee",
        entityId: row.id,
        action: "create",
        after: auditSnapshot(input, names),
      },
      now,
    );
    return toFee(row);
  });
}

/**
 * FR-15: replaces a row (e.g. a typo in the rate). The same checks as creating apply.
 * Only the fields that changed are audited; no change, no audit row.
 */
export function updateCardFee(
  db: AppDatabase,
  id: number,
  input: CardFeeInput,
  now: Date = new Date(),
): CardFee {
  return db.transaction((tx) => {
    const current = tx.select().from(cardFees).where(eq(cardFees.id, id)).get();
    if (!current) throw new BusinessError(404, CARD_FEE_TEXTS.notFound);
    const names = validate(tx, input, id);
    const oldNames = namesOf(tx, current);

    const before: AuditValues = {};
    const after: AuditValues = {};
    if (current.cardMachineId !== input.cardMachineId) {
      before.cardMachine = oldNames.cardMachine;
      after.cardMachine = names.cardMachine;
    }
    if (current.paymentMethodId !== input.paymentMethodId) {
      before.paymentMethod = oldNames.paymentMethod;
      after.paymentMethod = names.paymentMethod;
    }
    for (const field of FEE_FIELDS) {
      if (current[field] !== input[field]) {
        before[field] = current[field];
        after[field] = input[field];
      }
    }
    if (Object.keys(after).length === 0) return toFee(current);

    const row = tx.update(cardFees).set(input).where(eq(cardFees.id, id)).returning().get();
    recordAudit(tx, { entity: "card_fee", entityId: id, action: "update", before, after }, now);
    return toFee(row);
  });
}

/** FR-15: deletes a row. Sales already saved keep their own copy of the rate. */
export function deleteCardFee(db: AppDatabase, id: number, now: Date = new Date()): void {
  db.transaction((tx) => {
    const current = tx.select().from(cardFees).where(eq(cardFees.id, id)).get();
    if (!current) throw new BusinessError(404, CARD_FEE_TEXTS.notFound);
    tx.delete(cardFees).where(eq(cardFees.id, id)).run();
    recordAudit(
      tx,
      {
        entity: "card_fee",
        entityId: id,
        action: "delete",
        before: auditSnapshot(current, namesOf(tx, current)),
      },
      now,
    );
  });
}
