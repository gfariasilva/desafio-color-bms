import { z } from "zod";
import { formatCents } from "../format/currency";
import { MAX_SALE_CENTS } from "../format/money-input";
import { INVALID_BODY, somethingToChange } from "../catalog/categories";
import { civilDateSchema, installmentsSchema } from "../payments/card-fees";

/**
 * FR-01 / FR-02: sales ("entradas"). A sale has exactly one tab and one payment method
 * (A-02). The rate, fee and net value in force are **copied onto the sale** when it is saved
 * (FR-02, spec §6.3), so later changes to the fee table never change it.
 *
 * Refunds (#6) are rows of the same table with `type: "refund"` and negative amounts.
 */

export const SALE_TYPES = ["sale", "refund"] as const;
export type SaleType = (typeof SALE_TYPES)[number];

export const SALE_NOTE_MAX = 200;

/** HTTP 409 code: the sale's day or month is closed (RN-14); the UI explains how to reopen. */
export const DAY_CLOSED_CODE = "day_closed";

/** HTTP 409 code: no fee in force for machine / method / installments (RN-01, FR-01). */
export const CARD_FEE_MISSING_CODE = "card_fee_missing";

/** HTTP 409 code: the sale already has refunds (#6), so it can no longer change. */
export const SALE_HAS_REFUNDS_CODE = "sale_has_refunds";

export const SALE_TEXTS = {
  inactiveCategory: "Escolha uma aba ativa.",
  inactiveMethod: "Escolha uma forma de pagamento ativa.",
  inactiveMachine: "Escolha uma maquininha ativa.",
  invalidValue: "Informe o valor da venda, por exemplo 25,00.",
  notFound: "Venda não encontrada.",
  refundNotEditable: "Estornos não podem ser editados nem excluídos.",
  hasRefunds: "Esta venda tem estornos e não pode ser alterada nem excluída.",
} as const;

const POSITIVE_MESSAGE = "Informe um valor maior que zero.";

const idSchema = (message: string) => z.number({ message }).int(message).positive(message);

/** The fields of a sale the owner types (FR-01); amounts are integer cents. */
const saleFields = {
  date: civilDateSchema("Data inválida."),
  saleCategoryId: idSchema("Escolha a aba."),
  paymentMethodId: idSchema("Escolha a forma de pagamento."),
  cardMachineId: idSchema("Escolha a maquininha.").nullable().optional(),
  installments: installmentsSchema.nullable().optional(),
  grossCents: z
    .number({ message: POSITIVE_MESSAGE })
    .int("Valor inválido.")
    .positive(POSITIVE_MESSAGE)
    .max(MAX_SALE_CENTS, `O valor máximo de uma venda é ${formatCents(MAX_SALE_CENTS)}.`),
  note: z
    .string({ message: "Observação inválida." })
    .max(SALE_NOTE_MAX, `A observação pode ter até ${SALE_NOTE_MAX} caracteres.`)
    .nullable()
    .optional()
    // An empty note is no note.
    .transform((note) => (note?.trim() ? note.trim() : note === undefined ? undefined : null)),
};

/** Body of POST /api/sales. */
export const createSaleInputSchema = z.object(saleFields, INVALID_BODY);
export type CreateSaleInput = z.input<typeof createSaleInputSchema>;
export type ParsedCreateSaleInput = z.output<typeof createSaleInputSchema>;

/** A saved sale, with the names of its tab, method and machine (renames show everywhere). */
export const saleSchema = z.object({
  id: z.number().int().positive(),
  date: z.string(),
  /** ISO-8601 UTC instant. */
  createdAt: z.string(),
  type: z.enum(SALE_TYPES),
  saleCategoryId: z.number().int(),
  saleCategoryName: z.string(),
  paymentMethodId: z.number().int(),
  paymentMethodName: z.string(),
  cardMachineId: z.number().int().nullable(),
  cardMachineName: z.string().nullable(),
  installments: z.number().int().nullable(),
  grossCents: z.number().int(),
  /** The rate copied from the fee table (percent × 10,000); 0 without a fee. */
  feeRatePpm: z.number().int(),
  feeCents: z.number().int(),
  netCents: z.number().int(),
  note: z.string().nullable(),
});
export type Sale = z.infer<typeof saleSchema>;

/**
 * Body of PATCH /api/sales/:id (FR-03): any subset of the sale fields. The server merges it
 * into the saved sale and checks the result like a new sale (FR-01), with the fee in force
 * on the sale date (FR-02).
 */
export const updateSaleInputSchema = z
  .object(saleFields, INVALID_BODY)
  .partial()
  .refine(somethingToChange.check, somethingToChange.message);
export type UpdateSaleInput = z.input<typeof updateSaleInputSchema>;
export type ParsedUpdateSaleInput = z.output<typeof updateSaleInputSchema>;

/** Response of GET /api/sales?date=YYYY-MM-DD, in the order the sales were registered. */
export const saleListResponseSchema = z.object({ sales: z.array(saleSchema) });
export type SaleListResponse = z.infer<typeof saleListResponseSchema>;

/** Query of GET /api/sales. */
export const saleListQuerySchema = z.object({
  date: civilDateSchema("Data inválida."),
});

/** Params of GET /api/days/:date/sales (FR-05). */
export const daySalesParamsSchema = z.object({ date: civilDateSchema("Data inválida.") });

/** Response of GET /api/today: the business day in São Paulo, from the server clock (RN-15). */
export const todayResponseSchema = z.object({ date: civilDateSchema("Data inválida.") });
export type TodayResponse = z.infer<typeof todayResponseSchema>;

/** Gross, fee and net added up separately (RN-05). */
export const saleTotalsSchema = z.object({
  grossCents: z.number().int(),
  feeCents: z.number().int(),
  netCents: z.number().int(),
});
export type SaleTotals = z.infer<typeof saleTotalsSchema>;

/** FR-05: one tab of the day: its sales, a subtotal per payment method and its total. */
export const daySalesTabSchema = z.object({
  saleCategoryId: z.number().int(),
  name: z.string(),
  order: z.number().int(),
  active: z.boolean(),
  /** Sales and refunds, in the order they were registered. */
  sales: z.array(saleSchema),
  methods: z.array(
    saleTotalsSchema.extend({
      paymentMethodId: z.number().int(),
      paymentMethodName: z.string(),
    }),
  ),
  total: saleTotalsSchema,
});
export type DaySalesTab = z.infer<typeof daySalesTabSchema>;

/** Response of GET /api/days/:date/sales (FR-05, RN-05). */
export const daySalesResponseSchema = z.object({
  date: civilDateSchema("Data inválida."),
  /** RN-14 / FR-03: why the day's sales cannot change (closed day or month); null if open. */
  lock: z.string().nullable(),
  tabs: z.array(daySalesTabSchema),
  total: saleTotalsSchema,
});
export type DaySalesResponse = z.infer<typeof daySalesResponseSchema>;
