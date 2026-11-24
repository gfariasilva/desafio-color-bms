import { expect } from "vitest";
import {
  auditListResponseSchema,
  dayCashClosingResponseSchema,
  homeAlertsResponseSchema,
  type CloseDayInput,
} from "@color-bms/core";
import type { SalesContext } from "./sales-fixture";

/**
 * Helpers of the cash-closing tests (FR-08). They reuse the sales setup (`useSalesApp`): a
 * fresh migrated database and the app with the fixed clock of 18/11/2026 15:00 in São Paulo.
 */

export function postClose(ctx: SalesContext, date: string, payload: Record<string, unknown>) {
  return ctx.app.inject({ method: "POST", url: `/api/days/${date}/close`, payload });
}

/** Closes a day through the API and returns the closing (expects 200). */
export async function closeDayWithCount(ctx: SalesContext, date: string, input: CloseDayInput) {
  const response = await postClose(ctx, date, input);
  expect(response.statusCode, response.body).toBe(200);
  return dayCashClosingResponseSchema.parse(response.json());
}

export async function getCashClosing(ctx: SalesContext, date: string) {
  const response = await ctx.app.inject({ method: "GET", url: `/api/days/${date}/cash-closing` });
  expect(response.statusCode, response.body).toBe(200);
  return dayCashClosingResponseSchema.parse(response.json());
}

/** FR-27 "Dia não fechado": the open days listed by GET /api/alerts. */
export async function getUnclosedDays(ctx: SalesContext) {
  const response = await ctx.app.inject({ method: "GET", url: "/api/alerts" });
  expect(response.statusCode, response.body).toBe(200);
  return homeAlertsResponseSchema.parse(response.json()).unclosedDays;
}

export async function dayAudit(ctx: SalesContext) {
  const response = await ctx.app.inject({ method: "GET", url: "/api/audit?entity=day" });
  return auditListResponseSchema.parse(response.json()).entries;
}
