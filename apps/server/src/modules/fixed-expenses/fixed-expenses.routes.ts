import type { FastifyInstance } from "fastify";
import {
  createOneOffFixedExpenseInputSchema,
  monthFixedExpensesQuerySchema,
  monthOf,
  todayCivilDate,
} from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { parseOr400, sendError } from "../../http/route-helpers";
import {
  createOneOffFixedExpense,
  ensureMonthFixedExpenses,
  getMonthFixedExpenses,
} from "./fixed-expenses.repository";

/**
 * FR-11: "quando o sistema é aberto em qualquer dia do mês M", the month's fixed expenses are
 * generated. Runs once now (server start) and again on the first API request of a new month,
 * so a PC left on past midnight on the last day also generates the next month.
 *
 * The month already checked is remembered in memory, so the other requests cost nothing.
 * A failure is logged and never blocks the request (sales must keep working); the next
 * request tries again. Register this before the routes.
 */
export function registerMonthGeneration(
  app: FastifyInstance,
  { db }: DatabaseConnection,
  clock: Clock,
): void {
  let checkedMonth: string | null = null;

  const ensure = () => {
    const now = clock();
    const month = monthOf(todayCivilDate(now));
    if (month === checkedMonth) return;
    try {
      const created = ensureMonthFixedExpenses(db, month, now);
      if (created > 0) app.log.info(`FR-11: ${created} fixed expenses generated for ${month}`);
      checkedMonth = month;
    } catch (error) {
      app.log.error({ err: error }, `FR-11: generating the fixed expenses of ${month} failed`);
    }
  };

  ensure();
  app.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/api/")) ensure();
  });
}

/** FR-11: GET /api/fixed-expenses?month=YYYY-MM (the month's bills), POST (one-off entry). */
export function registerFixedExpenseRoutes(
  app: FastifyInstance,
  { db }: DatabaseConnection,
  clock: Clock,
): void {
  app.get("/api/fixed-expenses", async (request, reply) => {
    const query = parseOr400(monthFixedExpensesQuerySchema, request.query, reply);
    if (!query) return reply;
    const now = clock();
    return getMonthFixedExpenses(db, query.month ?? monthOf(todayCivilDate(now)), now);
  });

  app.post("/api/fixed-expenses", async (request, reply) => {
    const input = parseOr400(createOneOffFixedExpenseInputSchema, request.body, reply);
    if (!input) return reply;
    try {
      return reply.code(201).send(createOneOffFixedExpense(db, input, clock()));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
