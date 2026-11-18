import { z } from "zod";

/**
 * FR-14: categories. There are two independent lists:
 * - sale tabs ("abas", spec §3), used by sales;
 * - general-expense categories, in two groups, used by general expenses (RN-08).
 *
 * Both can be created, renamed, deactivated, reactivated and reordered. A category is only
 * deleted if it was never used. Names are unique per list, ignoring case and accents.
 * Sales and expenses reference categories by id, so a rename changes the history's label
 * but never its totals (spec §6.3).
 */

/** Groups of general-expense categories (spec §6.1 "CategoriaDespesa"). */
export const EXPENSE_CATEGORY_GROUPS = ["general", "suppliers"] as const;
export type ExpenseCategoryGroup = (typeof EXPENSE_CATEGORY_GROUPS)[number];

export const EXPENSE_CATEGORY_GROUP_LABELS: Record<ExpenseCategoryGroup, string> = {
  general: "Geral",
  suppliers: "Fornecedores de materiais",
};

/** RN-12: the 9 initial sale tabs, in display order. */
export const INITIAL_SALE_CATEGORIES = [
  "Acessórios",
  "Carimbos",
  "Cartuchos compatíveis",
  "Recargas",
  "Papelaria",
  "Chaveiro",
  "Toner",
  "Serviços de copiadora",
  "Personalizados",
] as const;

/** RN-12: the initial general-expense categories, then the Fornecedores de materiais group. */
export const INITIAL_EXPENSE_CATEGORIES: readonly { name: string; group: ExpenseCategoryGroup }[] =
  [
    { name: "Acessórios", group: "general" },
    { name: "Carimbos", group: "general" },
    { name: "Chaves", group: "general" },
    { name: "Despesas gerais (loja)", group: "general" },
    { name: "Despesas moto", group: "general" },
    { name: "Abastecimento moto", group: "general" },
    { name: "Diversos", group: "general" },
    { name: "Alimentação", group: "general" },
    { name: "Casa Forte", group: "suppliers" },
    { name: "Nova Supri", group: "suppliers" },
    { name: "Canal Verde", group: "suppliers" },
    { name: "Jandaia", group: "suppliers" },
    { name: "Kalunga", group: "suppliers" },
    { name: "Suzano", group: "suppliers" },
    { name: "Outros fornecedores", group: "suppliers" },
  ];

export const CATEGORY_NAME_MAX = 60;

/** Error code sent with HTTP 409 when deleting a used category, so the UI offers "Desativar". */
export const CATEGORY_IN_USE_CODE = "category_in_use";

/** FR-14: the name as stored: trimmed, inner spaces collapsed, Unicode NFC. */
export function normalizeCategoryName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * FR-14: the key used to compare names. Two names with the same key are the same name:
 * case and accents are ignored ("Serviços" = "SERVICOS"), as decided by the owner.
 * NFD splits "ç" into "c" + a combining mark, which we then remove.
 */
export function categoryNameKey(name: string): string {
  return normalizeCategoryName(name)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

/**
 * FR-14: another category in the same list with the same name (by `categoryNameKey`).
 * `exceptId` is the category being renamed, which may keep its own name in another case.
 */
export function findCategoryWithSameName<T extends { id: number; name: string }>(
  categories: readonly T[],
  name: string,
  exceptId?: number,
): T | undefined {
  const key = categoryNameKey(name);
  return categories.find(
    (category) => category.id !== exceptId && categoryNameKey(category.name) === key,
  );
}

/** FR-14: a category can only be deleted if no sale or expense ever used it. */
export function canDeleteCategory(usageCount: number): boolean {
  return usageCount === 0;
}

/**
 * FR-14: the ids in their new order after moving one category up or down, or null if it
 * cannot move. With groups (expense categories), it swaps with the nearest neighbour of the
 * same group, so the move is visible in the grouped table.
 */
export function moveCategory(
  categories: readonly { id: number; group?: string }[],
  id: number,
  direction: "up" | "down",
): number[] | null {
  const index = categories.findIndex((category) => category.id === id);
  if (index === -1) return null;
  const group = categories[index]?.group;
  const step = direction === "up" ? -1 : 1;
  let other = index + step;
  while (other >= 0 && other < categories.length && categories[other]?.group !== group) {
    other += step;
  }
  if (other < 0 || other >= categories.length) return null;

  const ids = categories.map((category) => category.id);
  [ids[index], ids[other]] = [ids[other] as number, ids[index] as number];
  return ids;
}

// ---------------------------------------------------------------------------------------
// Zod schemas, shared by the server (request validation) and the web app (forms, responses).
// ---------------------------------------------------------------------------------------

const categoryNameSchema = z
  .string({ message: "Informe o nome." })
  .transform(normalizeCategoryName)
  .pipe(
    z
      .string()
      .min(1, "Informe o nome.")
      .max(CATEGORY_NAME_MAX, `O nome deve ter no máximo ${CATEGORY_NAME_MAX} caracteres.`),
  );

const groupSchema = z.enum(EXPENSE_CATEGORY_GROUPS, {
  errorMap: () => ({ message: "Grupo inválido." }),
});

export const saleCategorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  /** Display order, 1-based. */
  order: z.number().int(),
  active: z.boolean(),
});
export type SaleCategory = z.infer<typeof saleCategorySchema>;

export const expenseCategorySchema = saleCategorySchema.extend({
  group: z.enum(EXPENSE_CATEGORY_GROUPS),
});
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

/** Response of GET /api/sale-categories, in display order. */
export const saleCategoryListResponseSchema = z.object({
  categories: z.array(saleCategorySchema),
});
export type SaleCategoryListResponse = z.infer<typeof saleCategoryListResponseSchema>;

/** Response of GET /api/expense-categories, in display order. */
export const expenseCategoryListResponseSchema = z.object({
  categories: z.array(expenseCategorySchema),
});
export type ExpenseCategoryListResponse = z.infer<typeof expenseCategoryListResponseSchema>;

/** Query of GET /api/…-categories: `?active=true` lists only what entry forms may offer. */
export const categoryListQuerySchema = z.object({
  active: z
    .enum(["true", "false"], { errorMap: () => ({ message: "Filtro inválido." }) })
    .transform((value) => value === "true")
    .optional(),
});

export const createSaleCategoryInputSchema = z.object({ name: categoryNameSchema });
export type CreateSaleCategoryInput = z.infer<typeof createSaleCategoryInputSchema>;

export const createExpenseCategoryInputSchema = z.object({
  name: categoryNameSchema,
  group: groupSchema,
});
export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategoryInputSchema>;

const somethingToChange = {
  check: (input: object) => Object.values(input).some((value) => value !== undefined),
  message: "Nada para alterar.",
};

/** PATCH body: rename and/or (de)activate. */
export const updateSaleCategoryInputSchema = z
  .object({ name: categoryNameSchema.optional(), active: z.boolean().optional() })
  .refine(somethingToChange.check, somethingToChange.message);
export type UpdateSaleCategoryInput = z.infer<typeof updateSaleCategoryInputSchema>;

/** PATCH body: rename, (de)activate and/or move to another group. */
export const updateExpenseCategoryInputSchema = z
  .object({
    name: categoryNameSchema.optional(),
    active: z.boolean().optional(),
    group: groupSchema.optional(),
  })
  .refine(somethingToChange.check, somethingToChange.message);
export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategoryInputSchema>;

/** PUT …/order body: every category id, in the new display order. */
export const reorderCategoriesInputSchema = z.object({
  ids: z
    .array(z.number().int().positive(), { message: "Ordem inválida." })
    .min(1, "Ordem inválida.")
    .refine((ids) => new Set(ids).size === ids.length, "A nova ordem repete uma categoria."),
});
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesInputSchema>;

/** The two category lists, and their pt-BR texts (error messages, labels). */
export const CATEGORY_KINDS = ["sale", "expense"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const CATEGORY_TEXTS: Record<
  CategoryKind,
  { notFound: string; duplicate: string; inUse: string }
> = {
  sale: {
    notFound: "Aba não encontrada.",
    duplicate: "Já existe uma aba com esse nome.",
    inUse:
      "Esta aba já tem lançamentos e não pode ser excluída. Desative-a para que não apareça mais no lançamento de vendas.",
  },
  expense: {
    notFound: "Categoria de despesa não encontrada.",
    duplicate: "Já existe uma categoria de despesa com esse nome.",
    inUse:
      "Esta categoria já tem lançamentos e não pode ser excluída. Desative-a para que não apareça mais no lançamento de despesas.",
  },
};

/** Sent when a reorder does not list exactly the current categories (someone else changed them). */
export const CATEGORY_ORDER_STALE_MESSAGE = "A lista mudou. Atualize a página e tente de novo.";
