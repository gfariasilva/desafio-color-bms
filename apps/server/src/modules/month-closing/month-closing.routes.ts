import type { FastifyInstance } from "fastify";
import { monthParamsSchema, reopenMonthInputSchema, type YearMonth } from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { parseOr400, sendError } from "../../http/route-helpers";
import { closeMonth, getMonthClosing, reopenMonth } from "./month-closing.repository";

/**
 * Runs after a month is closed and committed (FR-16): the place for the final monthly
 * spreadsheet (FR-29, #28) and the database backup (FR-31, #22).
 */
export type OnMonthClosed = (yearMonth: YearMonth) => void | Promise<void>;

/** FR-16: close a month; FR-17: reopen it; and the data of the "Fechamento do mês" section. */
export function registerMonthClosingRoutes(
  app: FastifyInstance,
  { db }: DatabaseConnection,
  clock: Clock,
  onMonthClosed: OnMonthClosed,
): void {
  app.get("/api/months/:yearMonth/closing", async (request, reply) => {
    const params = parseOr400(monthParamsSchema, request.params, reply);
    if (!params) return reply;
    return getMonthClosing(db, params.yearMonth, clock());
  });

  app.post("/api/months/:yearMonth/close", async (request, reply) => {
    const params = parseOr400(monthParamsSchema, request.params, reply);
    if (!params) return reply;
    let closed;
    try {
      closed = closeMonth(db, params.yearMonth, clock());
    } catch (error) {
      return sendError(reply, error);
    }
    // After the commit, not awaited: a failing or slow hook never undoes or delays the closing.
    const { yearMonth } = params;
    void Promise.resolve()
      .then(() => onMonthClosed(yearMonth))
      .catch((error: unknown) => {
        request.log.error({ err: error, yearMonth }, "onMonthClosed failed");
      });
    return closed;
  });

  app.post("/api/months/:yearMonth/reopen", async (request, reply) => {
    const params = parseOr400(monthParamsSchema, request.params, reply);
    if (!params) return reply;
    const input = parseOr400(reopenMonthInputSchema, request.body, reply);
    if (!input) return reply;
    try {
      return reopenMonth(db, params.yearMonth, input, clock());
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
