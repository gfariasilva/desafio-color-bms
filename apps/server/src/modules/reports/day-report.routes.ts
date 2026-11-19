import type { FastifyInstance } from "fastify";
import { dayParamsSchema } from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { parseOr400 } from "../../http/route-helpers";
import { getDayReport } from "./day-report.repository";

/** FR-19: the day report. */
export function registerDayReportRoutes(
  app: FastifyInstance,
  { db }: DatabaseConnection,
  clock: Clock,
): void {
  app.get("/api/days/:date/report", async (request, reply) => {
    const params = parseOr400(dayParamsSchema, request.params, reply);
    if (!params) return reply;
    return getDayReport(db, params.date, clock());
  });
}
