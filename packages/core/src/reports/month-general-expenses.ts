import { z } from "zod";
import {
  EXPENSE_CATEGORY_GROUPS,
  type ExpenseCategory,
  type ExpenseCategoryGroup,
} from "../catalog/categories";
import { expensesTotalCents } from "../expenses/expense-totals";
import { expenseSchema, type Expense } from "../expenses/expenses";
import { yearMonthSchema, type YearMonth } from "../time/year-month";

/**
 * FR-21: the month's general expenses report ("Relatório Mês – Despesas gerais"): the total
 * of each category by payment date (RN-08), the "Fornecedores de materiais" group with its
 * subtotal, the total geral, and each category's entries. The monthly spreadsheet (FR-29,
 * #28) builds its "Despesas gerais" sheet from the same data.
 */

/** One category of the month, with its entries. */
export const monthExpenseCategorySchema = z.object({
  expenseCategoryId: z.number().int(),
  name: z.string(),
  /** Display order, for the category's color dot (design system). */
  order: z.number().int(),
  active: z.boolean(),
  group: z.enum(EXPENSE_CATEGORY_GROUPS),
  /** RN-08: Σ amount of the category's general expenses paid in the month. */
  totalCents: z.number().int(),
  /** FR-21: the entries, by payment date (then registration order). */
  expenses: z.array(expenseSchema),
});
export type MonthExpenseCategory = z.infer<typeof monthExpenseCategorySchema>;

/** One group of categories (Geral or Fornecedores de materiais) with its subtotal. */
export const monthExpenseGroupSchema = z.object({
  categories: z.array(monthExpenseCategorySchema),
  subtotalCents: z.number().int(),
});
export type MonthExpenseGroup = z.infer<typeof monthExpenseGroupSchema>;

/** Response of GET /api/months/:yearMonth/reports/general-expenses (FR-21). */
export const monthGeneralExpensesResponseSchema = z.object({
  yearMonth: yearMonthSchema("Mês inválido."),
  general: monthExpenseGroupSchema,
  suppliers: monthExpenseGroupSchema,
  /** RN-08: total geral of the month's general expenses (= Geral + Fornecedores). */
  totalCents: z.number().int(),
});
export type MonthGeneralExpensesResponse = z.infer<typeof monthGeneralExpensesResponseSchema>;

/**
 * RN-08 / FR-21: groups the month's general expenses by category.
 *
 * - Only `general` expenses whose **payment date** falls in the month count (fixed expenses
 *   are RN-09, #17). Each expense has exactly one category (A-08), so it counts once.
 * - Categories: every active one, plus inactive ones with expenses in the month, in display
 *   order, split into the two groups (spec §6.1 "CategoriaDespesa").
 */
export function buildMonthGeneralExpenses(input: {
  yearMonth: YearMonth;
  categories: readonly ExpenseCategory[];
  expenses: readonly Expense[];
}): MonthGeneralExpensesResponse {
  const ofMonth = input.expenses
    .filter(
      (expense) =>
        expense.type === "general" && expense.paymentDate.slice(0, 7) === input.yearMonth,
    )
    .sort(
      (a, b) =>
        a.paymentDate.localeCompare(b.paymentDate) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id - b.id,
    );

  const byCategory = new Map<number, Expense[]>();
  for (const expense of ofMonth) {
    const list = byCategory.get(expense.expenseCategoryId) ?? [];
    list.push(expense);
    byCategory.set(expense.expenseCategoryId, list);
  }

  const categories = [...input.categories]
    .sort((a, b) => a.order - b.order || a.id - b.id)
    .filter((category) => category.active || byCategory.has(category.id))
    .map((category): MonthExpenseCategory => {
      const expenses = byCategory.get(category.id) ?? [];
      return {
        expenseCategoryId: category.id,
        name: category.name,
        order: category.order,
        active: category.active,
        group: category.group,
        totalCents: expensesTotalCents(expenses),
        expenses,
      };
    });

  const group = (name: ExpenseCategoryGroup): MonthExpenseGroup => {
    const list = categories.filter((category) => category.group === name);
    return {
      categories: list,
      subtotalCents: list.reduce((sum, category) => sum + category.totalCents, 0),
    };
  };
  const general = group("general");
  const suppliers = group("suppliers");

  return {
    yearMonth: input.yearMonth,
    general,
    suppliers,
    totalCents: general.subtotalCents + suppliers.subtotalCents,
  };
}
