import { z } from "zod";
import {
  activeSchema,
  categoryNameKey,
  categoryNameSchema,
  CATEGORY_NAME_MAX,
  INVALID_BODY,
  normalizeCategoryName,
  somethingToChange,
} from "../catalog/categories";
import { MAX_EXPENSE_CENTS } from "../expenses/expenses";
import { formatCents } from "../format/currency";

/**
 * FR-10: fixed-expense templates ("modelos de despesa fixa"). Each template is a monthly bill
 * (Luz, Aluguel, DAS…) with a due day and an optional expected amount. #12 generates one
 * entry per active template every month; #13 pays it.
 *
 * Templates can be created, edited, deactivated and reordered. They are never deleted
 * (FR-10 lists no delete): deactivating keeps the past entries in the reports.
 */

/** FR-10: the two groups of fixed expenses (spec §6.1 "ModeloDespesaFixa"). */
export const FIXED_EXPENSE_GROUPS = ["general", "government_fees"] as const;
export type FixedExpenseGroup = (typeof FIXED_EXPENSE_GROUPS)[number];

export const FIXED_EXPENSE_GROUP_LABELS: Record<FixedExpenseGroup, string> = {
  general: "Gerais",
  government_fees: "Taxas governo",
};

/** The largest loan we accept: 999 installments is far beyond any real loan. */
export const MAX_LOAN_INSTALLMENTS = 999;

export interface InitialFixedExpenseTemplate {
  name: string;
  group: FixedExpenseGroup;
  subgroup: string | null;
  isLoan: boolean;
}

/**
 * RN-12 / FR-10: the initial templates, in display order. "Telefonia – Vivo fixo" is the
 * subgroup Telefonia + the name Vivo fixo. Due days, amounts and loan installments are not
 * known yet (Q-05, Q-06): the owner fills them in at installation.
 */
export const INITIAL_FIXED_EXPENSE_TEMPLATES: readonly InitialFixedExpenseTemplate[] = [
  { name: "Água", group: "general", subgroup: null, isLoan: false },
  { name: "Luz", group: "general", subgroup: null, isLoan: false },
  { name: "Aluguel", group: "general", subgroup: null, isLoan: false },
  { name: "Contador", group: "general", subgroup: null, isLoan: false },
  { name: "Funcionário", group: "general", subgroup: null, isLoan: false },
  { name: "GPS", group: "general", subgroup: null, isLoan: false },
  { name: "Seguro loja", group: "general", subgroup: null, isLoan: false },
  { name: "Vivo fixo", group: "general", subgroup: "Telefonia", isLoan: false },
  { name: "Vivo móvel", group: "general", subgroup: "Telefonia", isLoan: false },
  { name: "Banco", group: "general", subgroup: null, isLoan: false },
  { name: "Empréstimos", group: "general", subgroup: null, isLoan: true },
  { name: "DAS", group: "government_fees", subgroup: null, isLoan: false },
  { name: "DARE", group: "government_fees", subgroup: null, isLoan: false },
  { name: "DARF", group: "government_fees", subgroup: null, isLoan: false },
  { name: "TFE", group: "government_fees", subgroup: null, isLoan: false },
];

/** FR-10: how a template is shown: "Telefonia – Vivo fixo", or just "Luz". */
export function fixedExpenseTemplateLabel(template: {
  name: string;
  subgroup: string | null;
}): string {
  return template.subgroup ? `${template.subgroup} – ${template.name}` : template.name;
}

/**
 * FR-10: the key that makes a template unique: its label (subgroup + name), ignoring case
 * and accents, like the categories (FR-14). Two templates with the same key would generate
 * the same bill twice (#12). Stored in the `name_key` column (unique index).
 */
export function fixedExpenseTemplateNameKey(template: {
  name: string;
  subgroup: string | null;
}): string {
  return categoryNameKey(fixedExpenseTemplateLabel(template));
}

/**
 * FR-10 + FR-11: whether the month generation (#12) creates an entry for this template.
 * Not for a deactivated template, nor for a loan with 0 installments left (#12 then
 * deactivates it). A loan whose installments are still to be filled in (null) is generated.
 */
export function isTemplateGenerated(template: {
  active: boolean;
  isLoan: boolean;
  installmentsRemaining: number | null;
}): boolean {
  if (!template.active) return false;
  return !(template.isLoan && template.installmentsRemaining === 0);
}

export const FIXED_EXPENSE_TEMPLATE_TEXTS = {
  notFound: "Modelo de despesa fixa não encontrado.",
  duplicate: "Já existe um modelo de despesa fixa com esse nome.",
  loanBoth: "Informe o total de parcelas e as parcelas restantes.",
  remainingAboveTotal: "As parcelas restantes não podem passar do total.",
  onlyLoans: "Parcelas só valem para empréstimos.",
} as const;

/**
 * FR-10: the loan rules, checked on the whole template (also after a partial edit):
 * only loans have installments; a loan has both counts or neither (still to be filled in,
 * Q-06); the remaining installments never exceed the total. Returns the pt-BR message of
 * the first broken rule, or null.
 */
export function findTemplateLoanError(template: {
  isLoan: boolean;
  installmentsTotal: number | null;
  installmentsRemaining: number | null;
}): string | null {
  const { isLoan, installmentsTotal: total, installmentsRemaining: remaining } = template;
  if (!isLoan) {
    return total === null && remaining === null ? null : FIXED_EXPENSE_TEMPLATE_TEXTS.onlyLoans;
  }
  if ((total === null) !== (remaining === null)) return FIXED_EXPENSE_TEMPLATE_TEXTS.loanBoth;
  if (total !== null && remaining !== null && remaining > total) {
    return FIXED_EXPENSE_TEMPLATE_TEXTS.remainingAboveTotal;
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Zod schemas, shared by the server (request validation) and the web app (form, responses).
// ---------------------------------------------------------------------------------------

const DUE_DAY_MESSAGE = "O dia de vencimento deve ser de 1 a 31.";
const EXPECTED_MESSAGE = "Informe um valor previsto maior que zero.";
const TOTAL_MESSAGE = `O total de parcelas deve ser de 1 a ${MAX_LOAN_INSTALLMENTS}.`;
const REMAINING_MESSAGE = `As parcelas restantes devem ser de 0 a ${MAX_LOAN_INSTALLMENTS}.`;

const groupSchema = z.enum(FIXED_EXPENSE_GROUPS, {
  errorMap: () => ({ message: "Grupo inválido." }),
});

/** FR-10 "subgrupo opcional": trimmed like a name; empty means no subgroup (null). */
const subgroupSchema = z
  .string({ message: "Subgrupo inválido." })
  .transform(normalizeCategoryName)
  .pipe(
    z
      .string()
      .max(CATEGORY_NAME_MAX, `O subgrupo deve ter no máximo ${CATEGORY_NAME_MAX} caracteres.`),
  )
  .transform((value) => (value === "" ? null : value))
  .nullable();

/** FR-10 "dia de vencimento (1–31)". */
const dueDaySchema = z
  .number({ message: DUE_DAY_MESSAGE })
  .int(DUE_DAY_MESSAGE)
  .min(1, DUE_DAY_MESSAGE)
  .max(31, DUE_DAY_MESSAGE);

/** FR-10 "valor previsto (opcional)": integer cents, > 0, up to the expense maximum. */
const expectedAmountCentsSchema = z
  .number({ message: EXPECTED_MESSAGE })
  .int("Valor previsto inválido.")
  .positive(EXPECTED_MESSAGE)
  .max(MAX_EXPENSE_CENTS, `O valor previsto máximo é ${formatCents(MAX_EXPENSE_CENTS)}.`)
  .nullable();

const installmentsTotalSchema = z
  .number({ message: TOTAL_MESSAGE })
  .int(TOTAL_MESSAGE)
  .min(1, TOTAL_MESSAGE)
  .max(MAX_LOAN_INSTALLMENTS, TOTAL_MESSAGE)
  .nullable();

const installmentsRemainingSchema = z
  .number({ message: REMAINING_MESSAGE })
  .int(REMAINING_MESSAGE)
  .min(0, REMAINING_MESSAGE)
  .max(MAX_LOAN_INSTALLMENTS, REMAINING_MESSAGE)
  .nullable();

/** The fields the owner types, in the form's order, so the first message is the first field. */
const templateFields = {
  name: categoryNameSchema,
  group: groupSchema,
  subgroup: subgroupSchema,
  dueDay: dueDaySchema,
  expectedAmountCents: expectedAmountCentsSchema,
  isLoan: z.boolean({ message: "Informe se é um empréstimo." }),
  installmentsTotal: installmentsTotalSchema,
  installmentsRemaining: installmentsRemainingSchema,
};

/** POST /api/fixed-expense-templates body (FR-10). New templates are active. */
export const createFixedExpenseTemplateInputSchema = z
  .object(
    {
      ...templateFields,
      subgroup: subgroupSchema.default(null),
      expectedAmountCents: expectedAmountCentsSchema.default(null),
      isLoan: templateFields.isLoan.default(false),
      installmentsTotal: installmentsTotalSchema.default(null),
      installmentsRemaining: installmentsRemainingSchema.default(null),
    },
    INVALID_BODY,
  )
  .superRefine((input, context) => {
    const message = findTemplateLoanError(input);
    if (message) context.addIssue({ code: z.ZodIssueCode.custom, message });
  });
export type CreateFixedExpenseTemplateInput = z.infer<typeof createFixedExpenseTemplateInputSchema>;

/**
 * PATCH /api/fixed-expense-templates/:id body (FR-10): any field, and/or `active`.
 * The loan rules depend on the whole template, so the server checks them after merging
 * (`findTemplateLoanError`). The due day can be changed but never cleared.
 */
export const updateFixedExpenseTemplateInputSchema = z
  .object({ ...templateFields, active: activeSchema }, INVALID_BODY)
  .partial()
  .refine(somethingToChange.check, somethingToChange.message);
export type UpdateFixedExpenseTemplateInput = z.infer<typeof updateFixedExpenseTemplateInputSchema>;

export const fixedExpenseTemplateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  group: z.enum(FIXED_EXPENSE_GROUPS),
  subgroup: z.string().nullable(),
  /** Null only on the seeded templates, until the owner fills it in (Q-05). */
  dueDay: z.number().int().nullable(),
  expectedAmountCents: z.number().int().nullable(),
  isLoan: z.boolean(),
  installmentsTotal: z.number().int().nullable(),
  installmentsRemaining: z.number().int().nullable(),
  /** Display order, 1-based, across both groups. */
  order: z.number().int(),
  active: z.boolean(),
});
export type FixedExpenseTemplate = z.infer<typeof fixedExpenseTemplateSchema>;

/** Response of GET /api/fixed-expense-templates, in display order. */
export const fixedExpenseTemplateListResponseSchema = z.object({
  templates: z.array(fixedExpenseTemplateSchema),
});
export type FixedExpenseTemplateListResponse = z.infer<
  typeof fixedExpenseTemplateListResponseSchema
>;
