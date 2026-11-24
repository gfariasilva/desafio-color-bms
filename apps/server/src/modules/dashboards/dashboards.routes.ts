import type { FastifyInstance } from "fastify";
import {
  incomeVsExpensesQuerySchema,
  isMonthAfterToday,
  TAB_RANKING_FUTURE_MONTH_ERROR,
  tabRankingQuerySchema,
  todayCivilDate,
} from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { parseOr400 } from "../../http/route-helpers";
import { getIncomeVsExpenses, getMonthComparison, getTabRanking } from "./dashboards.repository";

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

  // FR-25: the tabs ranked by gross income in a month (`?month=YYYY-MM`).
  app.get("/api/dashboards/tab-ranking", async (request, reply) => {
    const query = parseOr400(tabRankingQuerySchema, request.query, reply);
    if (!query) return reply;
    const today = todayCivilDate(clock());
    // RN-15: no sale can be in the future.
    if (isMonthAfterToday(query.month, today)) {
      return reply.code(400).send({ error: TAB_RANKING_FUTURE_MONTH_ERROR });
    }
    return getTabRanking(db, query.month, today);
  });

  // FR-26: daily income × expenses of the last 7 or 30 days (`?days=7|30`, 7 by default).
  app.get("/api/dashboards/income-vs-expenses", async (request, reply) => {
    const query = parseOr400(incomeVsExpensesQuerySchema, request.query, reply);
    if (!query) return reply;
    return getIncomeVsExpenses(db, todayCivilDate(clock()), query.days);
  });
}
