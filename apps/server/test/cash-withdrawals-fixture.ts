import { expect } from "vitest";
import {
  auditListResponseSchema,
  cashWithdrawalSchema,
  dayCashWithdrawalsResponseSchema,
  type CashWithdrawal,
  type CreateCashWithdrawalInput,
} from "@color-bms/core";
import { TODAY, type SalesContext } from "./sales-fixture";

/**
 * Helpers of the sangria tests (FR-07). They reuse the sales setup (`useSalesApp`): a fresh
 * migrated database and the app with the fixed clock of 18/11/2026 15:00 in São Paulo.
 */

export function postCashWithdrawal(ctx: SalesContext, payload: Record<string, unknown>) {
  return ctx.app.inject({ method: "POST", url: "/api/cash-withdrawals", payload });
}

/** Registers a sangria: R$ 300,00 "depósito no banco", today, unless `input` says otherwise. */
export async function createCashWithdrawal(
  ctx: SalesContext,
  input: Partial<CreateCashWithdrawalInput> = {},
): Promise<CashWithdrawal> {
  const response = await postCashWithdrawal(ctx, {
    date: TODAY,
    amountCents: 30000,
    note: "depósito no banco",
    ...input,
  });
  expect(response.statusCode, response.body).toBe(201);
  return cashWithdrawalSchema.parse(response.json());
}

export async function getDayCashWithdrawals(ctx: SalesContext, date: string) {
  const response = await ctx.app.inject({
    method: "GET",
    url: `/api/days/${date}/cash-withdrawals`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return dayCashWithdrawalsResponseSchema.parse(response.json());
}

export async function cashWithdrawalAudit(ctx: SalesContext) {
  const response = await ctx.app.inject({
    method: "GET",
    url: "/api/audit?entity=cash_withdrawal",
  });
  return auditListResponseSchema.parse(response.json()).entries;
}
