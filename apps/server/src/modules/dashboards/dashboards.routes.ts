import type { FastifyInstance } from "fastify";
import { todayCivilDate } from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { getMonthComparison } from "./dashboards.repository";

/** FR-24 to FR-26: the dashboards (read-only). */
export function registerDashboardRoutes(
  app: FastifyInstance,
  { db }: DatabaseConnection,
  clock: Clock,
): void {
  // FR-24: this month up to today against the same days of the previous month.
  app.get("/api/dashboards/month-comparison", async () =>
    getMonthComparison(db, todayCivilDate(clock())),
  );
}
