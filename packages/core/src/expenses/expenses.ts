import { z } from "zod";
import { INVALID_BODY, somethingToChange } from "../catalog/categories";
import { formatCents } from "../format/currency";
import { MAX_SALE_CENTS } from "../format/money-input";
import { civilDateSchema } from "../payments/card-fees";

/**
 * FR-06: general expenses ("despesas gerais", entered on the "saídas diárias" screen, A-07).
 * They share the `expenses` table with the fixed expenses of #11–#13 (spec §6.1 "Despesa"):
 * `type` tells them apart, and a general expense is born `paid`.
 */

/** Spec §6.1 "Despesa": tipo `geral` | `fixa`. */
export const EXPENSE_TYPES = ["general", "fixed"] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

/** Spec §6.1 "Despesa": status `pendente` | `pago` | `dispensado` (general expenses: paid). */
export const EXPENSE_STATUSES = ["pending", "paid", "dismissed"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

/**
 * A-14: the payment means of expenses are a fixed list, not master data, in the MVP.
 * Stored as these codes; shown with EXPENSE_PAYMENT_MEANS_LABELS.
 */
export const EXPENSE_PAYMENT_MEANS = ["cash", "pix", "card", "boleto", "bank_transfer"] as const;
export type ExpensePaymentMeans = (typeof EXPENSE_PAYMENT_MEANS)[number];

export const EXPENSE_PAYMENT_MEANS_LABELS: Record<ExpensePaymentMeans, string> = {
  cash: "Dinheiro",
  pix: "PIX",
  card: "Cartão",
  boleto: "Boleto",
  bank_transfer: "Transferência/Débito em conta",
};

export const EXPENSE_DESCRIPTION_MAX = 200;

/** The largest expense: the same limit as a sale, R$ 999.999,99 (the money input's maximum). */
export const MAX_EXPENSE_CENTS = MAX_SALE_CENTS;

export const EXPENSE_TEXTS = {
  inactiveCategory: "Escolha uma categoria de despesa ativa.",
  paidFromTillOnlyCash: "Só despesas pagas em Dinheiro podem sair do caixa.",
  invalidValue: "Informe o valor da despesa, por exemplo 45,00.",
  notFound: "Despesa não encontrada.",
} as const;

const POSITIVE_MESSAGE = "Informe um valor maior que zero.";
const MEANS_MESSAGE = "Escolha o meio de pagamento.";

/** FR-06 "Valor": required, greater than 0, integer cents. */
export const expenseAmountCentsSchema = z
  .number({ message: POSITIVE_MESSAGE })
  .int("Valor inválido.")
  .positive(POSITIVE_MESSAGE)
  .max(MAX_EXPENSE_CENTS, `O valor máximo de uma despesa é ${formatCents(MAX_EXPENSE_CENTS)}.`);

export const expensePaymentMeansSchema = z.enum(EXPENSE_PAYMENT_MEANS, {
  errorMap: () => ({ message: MEANS_MESSAGE }),
});

/**
 * The fields of a general expense the owner types (FR-06), in the form's order, so the first
 * validation message is about the first field to fix.
 */
const expenseFields = {
  paymentDate: civilDateSchema("Data inválida."),
  amountCents: expenseAmountCentsSchema,
  expenseCategoryId: z
    .number({ message: "Escolha a categoria." })
    .int("Escolha a categoria.")
    .positive("Escolha a categoria."),
  paymentMeans: expensePaymentMeansSchema,
  /** FR-06: only with Dinheiro; defaults to yes for Dinheiro (`resolvePaidFromTill`). */
  paidFromTill: z.boolean({ message: "Informe se foi pago com dinheiro do caixa." }).optional(),
  description: z
    .string({ message: "Descrição inválida." })
    .max(EXPENSE_DESCRIPTION_MAX, `A descrição pode ter até ${EXPENSE_DESCRIPTION_MAX} caracteres.`)
    .nullable()
    .optional()
    // An empty description is no description.
    .transform((text) => (text?.trim() ? text.trim() : text === undefined ? undefined : null)),
};

/** Body of POST /api/expenses. */
export const createExpenseInputSchema = z.object(expenseFields, INVALID_BODY);
export type CreateExpenseInput = z.input<typeof createExpenseInputSchema>;
export type ParsedCreateExpenseInput = z.output<typeof createExpenseInputSchema>;

/**
 * Body of PATCH /api/expenses/:id (FR-06, as FR-03): any subset of the fields. The server
 * merges it into the saved expense and checks the result like a new one.
 */
export const updateExpenseInputSchema = z
  .object(expenseFields, INVALID_BODY)
  .partial()
  .refine(somethingToChange.check, somethingToChange.message);
export type UpdateExpenseInput = z.input<typeof updateExpenseInputSchema>;
export type ParsedUpdateExpenseInput = z.output<typeof updateExpenseInputSchema>;

/** A saved general expense, with the name of its category (renames show everywhere). */
export const expenseSchema = z.object({
  id: z.number().int().positive(),
  type: z.enum(EXPENSE_TYPES),
  status: z.enum(EXPENSE_STATUSES),
  /** Civil date "YYYY-MM-DD" when it was paid (RN-08, A-06). */
  paymentDate: z.string(),
  /** ISO-8601 UTC instant. */
  createdAt: z.string(),
  expenseCategoryId: z.number().int(),
  expenseCategoryName: z.string(),
  /** Display order of the category, for its color dot (design system). */
  expenseCategoryOrder: z.number().int(),
  description: z.string().nullable(),
  amountCents: z.number().int(),
  paymentMeans: z.enum(EXPENSE_PAYMENT_MEANS),
  paidFromTill: z.boolean(),
});
export type Expense = z.infer<typeof expenseSchema>;

/** Params of GET /api/days/:date/expenses. */
export const dayExpensesParamsSchema = z.object({ date: civilDateSchema("Data inválida.") });

/** Response of GET /api/days/:date/expenses (FR-06). */
export const dayExpensesResponseSchema = z.object({
  date: civilDateSchema("Data inválida."),
  /** RN-14: why the day's expenses cannot change (closed day or month); null if open. */
  lock: z.string().nullable(),
  /** The day's general expenses, in the order they were registered. */
  expenses: z.array(expenseSchema),
  /** Σ of the day's general expenses. */
  totalCents: z.number().int(),
  /** RN-07: the day's expenses paid in cash from the till (they reduce expected cash). */
  paidFromTillCents: z.number().int(),
  /** RN-08: general expenses of the date's month. */
  monthGeneralTotalCents: z.number().int(),
});
export type DayExpensesResponse = z.infer<typeof dayExpensesResponseSchema>;
