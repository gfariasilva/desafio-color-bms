import { z } from "zod";
import { formatCivilDate } from "../format/date";
import { isCivilDate, type CivilDate } from "../time/civil-date";
import { INVALID_BODY } from "../catalog/categories";
import { ratePercentSchema } from "./rate";

/**
 * FR-15: the fee table ("tabela de taxas"). One row per card machine × payment method ×
 * installment range, with a rate and the civil date it is valid from ("vigente desde").
 *
 * A new rate never edits the old row: the owner adds a row with a later "vigente desde",
 * and RN-01 picks the right one for each sale date. Sales keep a copy of the rate they used
 * (spec §6.3), so the table can change without touching the past.
 */

/** FR-01: credit sales go from 1 to 12 installments. */
export const MAX_INSTALLMENTS = 12;

/** The fields of a fee row that the rules below need. */
export interface CardFeeRule {
  id: number;
  cardMachineId: number;
  paymentMethodId: number;
  /** First installment count of the range, 1..12. */
  installmentsFrom: number;
  /** Last installment count of the range, inclusive, installmentsFrom..12. */
  installmentsTo: number;
  /** Percent × 10,000 (3,79% → 37900), see rate.ts. */
  ratePpm: number;
  validFrom: CivilDate;
}

type InstallmentRange = Pick<CardFeeRule, "installmentsFrom" | "installmentsTo">;

export interface FeeLookup {
  cardMachineId: number;
  paymentMethodId: number;
  installments: number;
  /** The sale date (civil date in São Paulo, RN-15). */
  date: CivilDate;
}

/**
 * RN-01: the fee in force for a sale. Among the rows with the same card machine and payment
 * method whose installment range contains the sale's installments, the one with the
 * **latest "vigente desde" on or before the sale date**. Undefined means there is no fee,
 * and FR-01 blocks the sale.
 *
 * Civil dates "YYYY-MM-DD" compare correctly as text.
 */
export function findFeeInForce<T extends CardFeeRule>(
  fees: readonly T[],
  lookup: FeeLookup,
): T | undefined {
  let best: T | undefined;
  for (const fee of fees) {
    if (fee.cardMachineId !== lookup.cardMachineId) continue;
    if (fee.paymentMethodId !== lookup.paymentMethodId) continue;
    if (lookup.installments < fee.installmentsFrom || lookup.installments > fee.installmentsTo) {
      continue;
    }
    if (fee.validFrom > lookup.date) continue;
    // The overlap check makes ties impossible; the higher id breaks one anyway, so the
    // result never depends on the order of the list.
    if (
      !best ||
      fee.validFrom > best.validFrom ||
      (fee.validFrom === best.validFrom && fee.id > best.id)
    ) {
      best = fee;
    }
  }
  return best;
}

/** FR-15: two installment ranges overlap when they share at least one installment count. */
export function rangesOverlap(a: InstallmentRange, b: InstallmentRange): boolean {
  return a.installmentsFrom <= b.installmentsTo && b.installmentsFrom <= a.installmentsTo;
}

/**
 * FR-15: another row with the same card machine, payment method and "vigente desde" whose
 * range overlaps the candidate's. Saving the candidate must be blocked. Rows with another
 * date are versions of each other, not overlaps. `exceptId` is the row being edited.
 */
export function findOverlappingFee<T extends CardFeeRule>(
  fees: readonly T[],
  candidate: Omit<CardFeeRule, "id" | "ratePpm">,
  exceptId?: number,
): T | undefined {
  return fees.find(
    (fee) =>
      fee.id !== exceptId &&
      fee.cardMachineId === candidate.cardMachineId &&
      fee.paymentMethodId === candidate.paymentMethodId &&
      fee.validFrom === candidate.validFrom &&
      rangesOverlap(fee, candidate),
  );
}

/** `unused`: the machine or method is inactive, or the method no longer uses a machine. */
export const FEE_STATUSES = ["current", "future", "superseded", "unused"] as const;
export type FeeStatus = (typeof FEE_STATUSES)[number];

export const FEE_STATUS_LABELS: Record<FeeStatus, string> = {
  current: "Em vigor",
  future: "Futura",
  superseded: "Substituída",
  unused: "Sem uso",
};

/**
 * FR-15: where a row stands today, for the fee table screen:
 * - `future`: its "vigente desde" is after today;
 * - `current`: RN-01 picks it today for at least one installment count of its range;
 * - `superseded`: newer rows replaced it for every installment count of its range.
 */
export function feeStatus(
  fees: readonly CardFeeRule[],
  fee: CardFeeRule,
  today: CivilDate,
): FeeStatus {
  if (fee.validFrom > today) return "future";
  for (
    let installments = fee.installmentsFrom;
    installments <= fee.installmentsTo;
    installments++
  ) {
    const inForce = findFeeInForce(fees, {
      cardMachineId: fee.cardMachineId,
      paymentMethodId: fee.paymentMethodId,
      installments,
      date: today,
    });
    if (inForce?.id === fee.id) return "current";
  }
  return "superseded";
}

/** FR-15: an installment range for display: "1x" or "2–6x". */
export function formatInstallmentRange(from: number, to: number): string {
  return from === to ? `${from}x` : `${from}–${to}x`;
}

/** FR-15: pt-BR message when saving would overlap `other` (FR-15 acceptance criterion 2). */
export function cardFeeOverlapMessage(
  cardMachineName: string,
  paymentMethodName: string,
  other: InstallmentRange & { validFrom: CivilDate },
): string {
  const range = formatInstallmentRange(other.installmentsFrom, other.installmentsTo);
  return (
    `Já existe uma taxa para ${cardMachineName} / ${paymentMethodName} / ${range} ` +
    `vigente desde ${formatCivilDate(other.validFrom)}. As faixas de parcelas não podem se sobrepor.`
  );
}

export const CARD_FEE_TEXTS = {
  notFound: "Taxa não encontrada.",
  cardMachineNotFound: "Maquininha não encontrada.",
  paymentMethodNotFound: "Forma de pagamento não encontrada.",
  noCardMachine: (method: string) => `${method} não usa maquininha, então não tem taxa.`,
  noInstallments: (method: string) => `${method} não permite parcelas: use a faixa 1x.`,
} as const;

// ---------------------------------------------------------------------------------------
// Zod schemas, shared by the server and the web app.
// ---------------------------------------------------------------------------------------

const INSTALLMENTS_MESSAGE = `As parcelas vão de 1 a ${MAX_INSTALLMENTS}.`;

/** FR-01 / FR-15: an installment count, 1..12. Shared by the fee table and sales. */
export const installmentsSchema = z
  .number({ message: INSTALLMENTS_MESSAGE })
  .int(INSTALLMENTS_MESSAGE)
  .min(1, INSTALLMENTS_MESSAGE)
  .max(MAX_INSTALLMENTS, INSTALLMENTS_MESSAGE);

/** A civil date "YYYY-MM-DD" (RN-15) with a pt-BR message. */
export const civilDateSchema = (message: string) =>
  z.string({ message }).refine(isCivilDate, { message });

export const cardFeeSchema = z.object({
  id: z.number().int().positive(),
  cardMachineId: z.number().int().positive(),
  paymentMethodId: z.number().int().positive(),
  installmentsFrom: z.number().int(),
  installmentsTo: z.number().int(),
  ratePpm: z.number().int(),
  validFrom: z.string(),
});
export type CardFee = z.infer<typeof cardFeeSchema>;

/** Response of GET /api/card-fees. */
export const cardFeeListResponseSchema = z.object({ fees: z.array(cardFeeSchema) });
export type CardFeeListResponse = z.infer<typeof cardFeeListResponseSchema>;

/** Response of GET /api/card-fees/in-force: null when no fee applies (RN-01). */
export const cardFeeInForceResponseSchema = z.object({ fee: cardFeeSchema.nullable() });
export type CardFeeInForceResponse = z.infer<typeof cardFeeInForceResponseSchema>;

/** Body of POST /api/card-fees and PUT /api/card-fees/:id (the whole row). */
export const cardFeeInputSchema = z
  .object(
    {
      cardMachineId: z
        .number({ message: "Escolha a maquininha." })
        .int("Escolha a maquininha.")
        .positive("Escolha a maquininha."),
      paymentMethodId: z
        .number({ message: "Escolha a forma de pagamento." })
        .int("Escolha a forma de pagamento.")
        .positive("Escolha a forma de pagamento."),
      installmentsFrom: installmentsSchema,
      installmentsTo: installmentsSchema,
      ratePpm: ratePercentSchema,
      validFrom: civilDateSchema("Data de vigência inválida."),
    },
    INVALID_BODY,
  )
  .refine((input) => input.installmentsFrom <= input.installmentsTo, {
    message: "A parcela inicial deve ser menor ou igual à final.",
    path: ["installmentsTo"],
  });
export type CardFeeInput = z.infer<typeof cardFeeInputSchema>;

/** Query of GET /api/card-fees/in-force (RN-01). */
export const cardFeeInForceQuerySchema = z.object({
  cardMachineId: z.coerce
    .number({ message: "Maquininha inválida." })
    .int("Maquininha inválida.")
    .positive("Maquininha inválida."),
  paymentMethodId: z.coerce
    .number({ message: "Forma de pagamento inválida." })
    .int("Forma de pagamento inválida.")
    .positive("Forma de pagamento inválida."),
  installments: z.coerce.number({ message: INSTALLMENTS_MESSAGE }).pipe(installmentsSchema),
  date: civilDateSchema("Data inválida."),
});
export type CardFeeInForceQuery = z.infer<typeof cardFeeInForceQuerySchema>;
