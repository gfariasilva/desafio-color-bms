import { expect } from "vitest";
import {
  auditListResponseSchema,
  contaCandidatesResponseSchema,
  fixedExpenseSchema,
  fixedExpenseTemplateListResponseSchema,
  monthFixedExpensesResponseSchema,
  type FixedExpense,
} from "@color-bms/core";
import type { SalesContext } from "./sales-fixture";

/**
 * Helpers of the fixed-expense payment tests (FR-12, FR-13, #13). They reuse the sales setup
 * (`useSalesApp`): the clock is 18/11/2026, so November's bills are already generated.
 */

export async function getFixedMonth(ctx: SalesContext, month = "2026-11") {
  const response = await ctx.app.inject({
    method: "GET",
    url: `/api/fixed-expenses?month=${month}`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return monthFixedExpensesResponseSchema.parse(response.json());
}

/** The entry of `month` whose label is `label` (e.g. "Luz"). */
export async function fixedEntry(ctx: SalesContext, label: string, month = "2026-11") {
  const found = (await getFixedMonth(ctx, month)).expenses.find((entry) => entry.label === label);
  if (!found) throw new Error(`no fixed expense ${label} in ${month}`);
  return found;
}

export async function templateByName(ctx: SalesContext, name: string) {
  const response = await ctx.app.inject({ method: "GET", url: "/api/fixed-expense-templates" });
  const found = fixedExpenseTemplateListResponseSchema
    .parse(response.json())
    .templates.find((template) => template.name === name);
  if (!found) throw new Error(`no template ${name}`);
  return found;
}

export async function patchTemplate(ctx: SalesContext, name: string, payload: object) {
  const template = await templateByName(ctx, name);
  const response = await ctx.app.inject({
    method: "PATCH",
    url: `/api/fixed-expense-templates/${template.id}`,
    payload,
  });
  expect(response.statusCode, response.body).toBe(200);
}

export function postAction(
  ctx: SalesContext,
  id: number,
  action: "pay" | "dismiss" | "undo",
  payload?: Record<string, unknown>,
) {
  return ctx.app.inject({
    method: "POST",
    url: `/api/fixed-expenses/${id}/${action}`,
    ...(payload ? { payload } : {}),
  });
}

/** Pays an entry (expects 200): R$ 187,43 via PIX on 10/11/2026 unless `input` says otherwise. */
export async function payEntry(
  ctx: SalesContext,
  id: number,
  input: Record<string, unknown> = {},
): Promise<FixedExpense> {
  const response = await postAction(ctx, id, "pay", {
    amountCents: 18743,
    paymentDate: "2026-11-10",
    paymentMeans: "pix",
    ...input,
  });
  expect(response.statusCode, response.body).toBe(200);
  return fixedExpenseSchema.parse(response.json());
}

export async function auditOf(ctx: SalesContext, entity: string) {
  const response = await ctx.app.inject({ method: "GET", url: `/api/audit?entity=${entity}` });
  return auditListResponseSchema.parse(response.json()).entries;
}

export async function getContaCandidates(ctx: SalesContext) {
  const response = await ctx.app.inject({ method: "GET", url: "/api/conta-conversions" });
  expect(response.statusCode, response.body).toBe(200);
  return contaCandidatesResponseSchema.parse(response.json());
}

export function postConvert(ctx: SalesContext, withdrawalId: number, payload: object) {
  return ctx.app.inject({
    method: "POST",
    url: `/api/conta-conversions/${withdrawalId}`,
    payload,
  });
}
