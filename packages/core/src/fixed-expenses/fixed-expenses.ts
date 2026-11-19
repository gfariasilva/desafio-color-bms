import { z } from "zod";
import { INVALID_BODY } from "../catalog/categories";
import {
  EXPENSE_DESCRIPTION_MAX,
  EXPENSE_PAYMENT_MEANS,
  EXPENSE_STATUSES,
  MAX_EXPENSE_CENTS,
  type ExpenseStatus,
} from "../expenses/expenses";
import { formatCents } from "../format/currency";
import { formatYearMonth } from "../format/date";
import { civilDateSchema } from "../payments/card-fees";
import { yearMonthSchema, type YearMonth } from "../time/year-month";
import { FIXED_EXPENSE_GROUPS } from "./fixed-expense-templates";

/**
 * FR-11: the month's fixed expenses ("contas do mês"): one pending entry per template,
 * generated once a month (`planMonthFixedExpenses`), plus one-off entries the owner adds.
 * They live in the `expenses` table with `type: "fixed"` (spec §6.1 "Despesa").
 * Paying and dismissing them is FR-12 (#13).
 */

/** Spec §6.1 "Despesa": the status labels shown in the UI and the audit log. */
export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  pending: "Pendente",
  paid: "Pago",
  dismissed: "Dispensado",
};

export const FIXED_EXPENSE_TEXTS = {
  nameRequired: "Informe o nome da conta.",
  invalidMonth: "Mês inválido.",
  invalidDueDate: "Data de vencimento inválida.",
  futureMonth: "O mês de referência não pode ser futuro.",
  /** FR-11: the audit reason when the generation deactivates a finished loan. */
  loanFinishedReason: "Empréstimo sem parcelas restantes (FR-11).",
} as const;

const EXPECTED_MESSAGE = "Informe um valor previsto maior que zero.";

/** POST /api/fixed-expenses body (FR-11 "lançamento fixo avulso"). Born pending. */
export const createOneOffFixedExpenseInputSchema = z.object(
  {
    referenceMonth: yearMonthSchema(FIXED_EXPENSE_TEXTS.invalidMonth),
    /** The bill's name, e.g. "IPTU". Stored in `description`. */
    description: z
      .string({ message: FIXED_EXPENSE_TEXTS.nameRequired })
      .transform((text) => text.normalize("NFC").trim().replace(/\s+/g, " "))
      .pipe(
        z
          .string()
          .min(1, FIXED_EXPENSE_TEXTS.nameRequired)
          .max(
            EXPENSE_DESCRIPTION_MAX,
            `O nome deve ter no máximo ${EXPENSE_DESCRIPTION_MAX} caracteres.`,
          ),
      ),
    group: z.enum(FIXED_EXPENSE_GROUPS, { errorMap: () => ({ message: "Grupo inválido." }) }),
    /** RN-15: a due date may be in the future. */
    dueDate: civilDateSchema(FIXED_EXPENSE_TEXTS.invalidDueDate),
    expectedAmountCents: z
      .number({ message: EXPECTED_MESSAGE })
      .int("Valor previsto inválido.")
      .positive(EXPECTED_MESSAGE)
      .max(MAX_EXPENSE_CENTS, `O valor previsto máximo é ${formatCents(MAX_EXPENSE_CENTS)}.`)
      .nullable()
      .default(null),
  },
  INVALID_BODY,
);
export type CreateOneOffFixedExpenseInput = z.input<typeof createOneOffFixedExpenseInputSchema>;
export type ParsedCreateOneOffFixedExpenseInput = z.output<
  typeof createOneOffFixedExpenseInputSchema
>;

/**
 * FR-11 one-off entry, RN-14 and RN-15: the reference month cannot be in the future nor
 * closed. Returns the pt-BR message, or null. Also the "lock" of the month's screen.
 */
export function oneOffFixedExpenseError(
  referenceMonth: YearMonth,
  currentMonth: YearMonth,
  status: { monthClosed: boolean },
): string | null {
  if (referenceMonth > currentMonth) return FIXED_EXPENSE_TEXTS.futureMonth;
  if (status.monthClosed) {
    return `O mês ${formatYearMonth(referenceMonth)} está fechado. Reabra o mês para adicionar contas nele.`;
  }
  return null;
}

/** FR-11: Σ expected amount of the month's entries, except dismissed ones (informative). */
export function fixedExpensesExpectedTotalCents(
  rows: readonly { status: ExpenseStatus; expectedAmountCents: number | null }[],
): number {
  return rows
    .filter((row) => row.status !== "dismissed")
    .reduce((total, row) => total + (row.expectedAmountCents ?? 0), 0);
}

/** FR-13: "parcela n de N", or null when either number is unknown. */
export function fixedExpenseInstallmentLabel(entry: {
  installmentNumber: number | null;
  installmentsTotal: number | null;
}): string | null {
  if (entry.installmentNumber === null || entry.installmentsTotal === null) return null;
  return `parcela ${entry.installmentNumber} de ${entry.installmentsTotal}`;
}

/** A fixed expense of a month, as listed on "Contas do mês". */
export const fixedExpenseSchema = z.object({
  id: z.number().int().positive(),
  referenceMonth: z.string(),
  /** The template's label ("Telefonia – Vivo fixo"), or the one-off entry's name. */
  label: z.string(),
  group: z.enum(FIXED_EXPENSE_GROUPS),
  /** Null on one-off entries. */
  fixedExpenseTemplateId: z.number().int().nullable(),
  oneOff: z.boolean(),
  /** Null when the template had no due day yet (Q-05): shown as "Sem vencimento". */
  dueDate: z.string().nullable(),
  expectedAmountCents: z.number().int().nullable(),
  status: z.enum(EXPENSE_STATUSES),
  /** Filled in when paid (FR-12, #13). */
  amountCents: z.number().int().nullable(),
  paymentDate: z.string().nullable(),
  paymentMeans: z.enum(EXPENSE_PAYMENT_MEANS).nullable(),
  paidFromTill: z.boolean(),
  /** FR-13: loans only. */
  installmentNumber: z.number().int().nullable(),
  installmentsTotal: z.number().int().nullable(),
  /** ISO-8601 UTC instant. */
  createdAt: z.string(),
});
export type FixedExpense = z.infer<typeof fixedExpenseSchema>;

/** Query of GET /api/fixed-expenses; the month defaults to the current one. */
export const monthFixedExpensesQuerySchema = z.object({
  month: yearMonthSchema(FIXED_EXPENSE_TEXTS.invalidMonth).optional(),
});

/** Response of GET /api/fixed-expenses (FR-11). */
export const monthFixedExpensesResponseSchema = z.object({
  month: z.string(),
  /** The month of today in São Paulo, so the UI does not navigate into the future. */
  currentMonth: z.string(),
  /** `months.fixed_expenses_generated`: false for months before the installation. */
  generated: z.boolean(),
  /** Why no one-off entry can be added to this month (closed or future); null if it can. */
  lock: z.string().nullable(),
  /** By group (Gerais, Taxas governo), then due date (none last), then name. */
  expenses: z.array(fixedExpenseSchema),
  /** Informative: Σ expected amounts, dismissed entries excluded. */
  expectedTotalCents: z.number().int(),
});
export type MonthFixedExpensesResponse = z.infer<typeof monthFixedExpensesResponseSchema>;
