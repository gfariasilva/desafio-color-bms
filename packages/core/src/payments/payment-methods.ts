import { z } from "zod";
import {
  activeSchema,
  categoryNameSchema,
  INVALID_BODY,
  somethingToChange,
} from "../catalog/categories";

/**
 * FR-15: payment methods ("formas de pagamento") and card machines ("maquininhas").
 * Both follow the FR-14 rules: create, rename, deactivate/reactivate, reorder, and delete
 * only if never used; names are unique per list, ignoring case and accents.
 *
 * A payment method says whether a sale needs a card machine (FR-01) and whether it can be
 * split into installments. The sale form and RN-02 read these flags, so a new method works
 * without code changes.
 */

/** FR-01 "Maquininha": required for cards, optional for PIX, not applicable for cash. */
export const MACHINE_USAGES = ["required", "optional", "not_applicable"] as const;
export type MachineUsage = (typeof MACHINE_USAGES)[number];

export const MACHINE_USAGE_LABELS: Record<MachineUsage, string> = {
  required: "Obrigatória",
  optional: "Opcional",
  not_applicable: "Não se aplica",
};

/** RN-12 (with FR-01 and the Q-03 assumption: PIX with an optional card machine). */
export const INITIAL_PAYMENT_METHODS: readonly {
  name: string;
  machineUsage: MachineUsage;
  allowsInstallments: boolean;
}[] = [
  { name: "Dinheiro", machineUsage: "not_applicable", allowsInstallments: false },
  { name: "Cartão de débito", machineUsage: "required", allowsInstallments: false },
  { name: "Cartão de crédito", machineUsage: "required", allowsInstallments: true },
  { name: "PIX/Depósito", machineUsage: "optional", allowsInstallments: false },
  { name: "Boleto bancário", machineUsage: "not_applicable", allowsInstallments: false },
];

/** RN-12: initial card machines. Their rates are filled in later (Q-01). */
export const INITIAL_CARD_MACHINES = ["PagSeguro", "Mercado Pago"] as const;

/**
 * FR-15: only a method paid through a card machine can have a fee row. Cash and boleto
 * never have a fee (RN-02).
 */
export function canHaveCardFee(method: { machineUsage: MachineUsage }): boolean {
  return method.machineUsage !== "not_applicable";
}

// ---------------------------------------------------------------------------------------
// Zod schemas, shared by the server and the web app.
// ---------------------------------------------------------------------------------------

const machineUsageSchema = z.enum(MACHINE_USAGES, {
  errorMap: () => ({ message: "Uso da maquininha inválido." }),
});
const allowsInstallmentsSchema = z.boolean({
  message: "Parcelamento inválido: use verdadeiro ou falso.",
});

export const cardMachineSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  /** Display order, 1-based. */
  order: z.number().int(),
  active: z.boolean(),
});
export type CardMachine = z.infer<typeof cardMachineSchema>;

export const paymentMethodSchema = cardMachineSchema.extend({
  machineUsage: z.enum(MACHINE_USAGES),
  allowsInstallments: z.boolean(),
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/** Response of GET /api/card-machines, in display order. */
export const cardMachineListResponseSchema = z.object({
  cardMachines: z.array(cardMachineSchema),
});
export type CardMachineListResponse = z.infer<typeof cardMachineListResponseSchema>;

/** Response of GET /api/payment-methods, in display order. */
export const paymentMethodListResponseSchema = z.object({
  paymentMethods: z.array(paymentMethodSchema),
});
export type PaymentMethodListResponse = z.infer<typeof paymentMethodListResponseSchema>;

export const createCardMachineInputSchema = z.object({ name: categoryNameSchema }, INVALID_BODY);
export type CreateCardMachineInput = z.infer<typeof createCardMachineInputSchema>;

export const createPaymentMethodInputSchema = z.object(
  {
    name: categoryNameSchema,
    machineUsage: machineUsageSchema,
    allowsInstallments: allowsInstallmentsSchema,
  },
  INVALID_BODY,
);
export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodInputSchema>;

/** PATCH body: rename and/or (de)activate. */
export const updateCardMachineInputSchema = z
  .object({ name: categoryNameSchema.optional(), active: activeSchema.optional() }, INVALID_BODY)
  .refine(somethingToChange.check, somethingToChange.message);
export type UpdateCardMachineInput = z.infer<typeof updateCardMachineInputSchema>;

/** PATCH body: rename, (de)activate, machine usage and/or installments. */
export const updatePaymentMethodInputSchema = z
  .object(
    {
      name: categoryNameSchema.optional(),
      active: activeSchema.optional(),
      machineUsage: machineUsageSchema.optional(),
      allowsInstallments: allowsInstallmentsSchema.optional(),
    },
    INVALID_BODY,
  )
  .refine(somethingToChange.check, somethingToChange.message);
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodInputSchema>;

/** The two lists of this module, and their pt-BR texts (error messages). */
export const PAYMENT_LIST_KINDS = ["payment_method", "card_machine"] as const;
export type PaymentListKind = (typeof PAYMENT_LIST_KINDS)[number];

export const PAYMENT_LIST_TEXTS: Record<
  PaymentListKind,
  { notFound: string; duplicate: string; inUse: string }
> = {
  payment_method: {
    notFound: "Forma de pagamento não encontrada.",
    duplicate: "Já existe uma forma de pagamento com esse nome.",
    inUse:
      "Esta forma de pagamento já tem taxas ou vendas e não pode ser excluída. Desative-a para que não apareça mais no lançamento de vendas.",
  },
  card_machine: {
    notFound: "Maquininha não encontrada.",
    duplicate: "Já existe uma maquininha com esse nome.",
    inUse:
      "Esta maquininha já tem taxas ou vendas e não pode ser excluída. Desative-a para que não apareça mais no lançamento de vendas.",
  },
};
