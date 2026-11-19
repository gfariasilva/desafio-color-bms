import type { FastifyInstance } from "fastify";
import { monthParamsSchema, todayCivilDate } from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { parseOr400 } from "../../http/route-helpers";
import { getMonthGeneralExpenses, getMonthIncome } from "./month-reports.repository";

/** FR-20 and FR-21: the month reports (income, general expenses). */
export function registerMonthReportRoutes(
  app: FastifyInstance,
  { db }: DatabaseConnection,
  clock: Clock,
): void {
  app.get("/api/months/:yearMonth/reports/income", async (request, reply) => {
    const params = parseOr400(monthParamsSchema, request.params, reply);
    if (!params) return reply;
    return getMonthIncome(db, params.yearMonth, todayCivilDate(clock()));
  });

  app.get("/api/months/:yearMonth/reports/general-expenses", async (request, reply) => {
    const params = parseOr400(monthParamsSchema, request.params, reply);
    if (!params) return reply;
    return getMonthGeneralExpenses(db, params.yearMonth);
  });
}
