import { expect } from "vitest";
import {
  auditListResponseSchema,
  dayExpensesResponseSchema,
  expenseCategoryListResponseSchema,
  expenseSchema,
  type CreateExpenseInput,
  type Expense,
} from "@color-bms/core";
import { TODAY, type SalesContext } from "./sales-fixture";

/**
 * Helpers of the expense tests (FR-06). They reuse the sales setup (`useSalesApp`): a fresh
 * migrated database and the app with the fixed clock of 18/11/2026 15:00 in São Paulo.
 */

/** Expense category id by name (the seeded RN-12 list). */
export async function expenseCategoryId(ctx: SalesContext, name: string): Promise<number> {
  const response = await ctx.app.inject({ method: "GET", url: "/api/expense-categories" });
  const list = expenseCategoryListResponseSchema.parse(response.json()).categories;
  const found = list.find((category) => category.name === name);
  if (!found) throw new Error(`Expense category "${name}" not found`);
  return found.id;
}

export function postExpense(ctx: SalesContext, payload: Record<string, unknown>) {
  return ctx.app.inject({ method: "POST", url: "/api/expenses", payload });
}

/**
 * Registers an expense through POST /api/expenses: R$ 45,00 in "Abastecimento moto", paid
 * in cash from the till, today, unless `input` says otherwise.
 */
export async function createExpense(
  ctx: SalesContext,
  input: Partial<CreateExpenseInput> = {},
): Promise<Expense> {
  const response = await postExpense(ctx, {
    paymentDate: TODAY,
    expenseCategoryId: await expenseCategoryId(ctx, "Abastecimento moto"),
    amountCents: 4500,
    paymentMeans: "cash",
    ...input,
  });
  expect(response.statusCode, response.body).toBe(201);
  return expenseSchema.parse(response.json());
}

export async function getDayExpenses(ctx: SalesContext, date: string) {
  const response = await ctx.app.inject({ method: "GET", url: `/api/days/${date}/expenses` });
  expect(response.statusCode, response.body).toBe(200);
  return dayExpensesResponseSchema.parse(response.json());
}

export async function expenseAudit(ctx: SalesContext) {
  const response = await ctx.app.inject({ method: "GET", url: "/api/audit?entity=expense" });
  return auditListResponseSchema.parse(response.json()).entries;
}
