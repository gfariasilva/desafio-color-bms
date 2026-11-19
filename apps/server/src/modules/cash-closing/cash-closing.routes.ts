import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  closeDayInputSchema,
  dayParamsSchema,
  reopenDayInputSchema,
  type CivilDate,
  type UnclosedDaysResponse,
} from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { parseOr400, sendError } from "../../http/route-helpers";
import { closeDay, getCashClosing, listUnclosedDays, reopenDay } from "./cash-closing.repository";

/**
 * Runs after a day is closed and committed (FR-08): the place where the daily and monthly
 * spreadsheet exports (FR-28, FR-29, #21) and the DB backup (FR-31, #25) get queued.
 */
export type OnDayClosed = (date: CivilDate) => void | Promise<void>;

/**
 * Runs `onDayClosed` after a closing has committed. A failure here must not undo the closing:
 * the export queue (FR-30) will record its own failures; until then, it is only logged. An
 * async hook's rejection is caught too: an unhandled rejection would stop the server. Not
 * awaited, so a slow backup never delays the answer.
 */
export function runAfterDayClosed(
  request: FastifyRequest,
  onDayClosed: OnDayClosed,
  date: CivilDate,
): void {
  void Promise.resolve()
    .then(() => onDayClosed(date))
    .catch((error: unknown) => {
      request.log.error({ err: error, date }, "onDayClosed failed");
    });
}

/** FR-08: the closing screen, closing a day; FR-09: reopening it; FR-27: the days left open. */
export function registerCashClosingRoutes(
  app: FastifyInstance,
  { db }: DatabaseConnection,
  clock: Clock,
  onDayClosed: OnDayClosed,
): void {
  // FR-27 (pilot slice): earlier days with movement still open.
  app.get("/api/days/unclosed", async (): Promise<UnclosedDaysResponse> => {
    return { days: listUnclosedDays(db, clock()) };
  });

  app.get("/api/days/:date/cash-closing", async (request, reply) => {
    const params = parseOr400(dayParamsSchema, request.params, reply);
    if (!params) return reply;
    return getCashClosing(db, params.date, clock());
  });

  app.post("/api/days/:date/close", async (request, reply) => {
    const params = parseOr400(dayParamsSchema, request.params, reply);
    if (!params) return reply;
    const input = parseOr400(closeDayInputSchema, request.body, reply);
    if (!input) return reply;
    let closed;
    try {
      closed = closeDay(db, params.date, input, clock());
    } catch (error) {
      return sendError(reply, error);
    }
    runAfterDayClosed(request, onDayClosed, params.date);
    return closed;
  });

  // FR-09: reopen a closed day with a reason. The next closing calls onDayClosed again, which
  // makes the daily spreadsheet again (FR-28); reopening itself queues nothing.
  app.post("/api/days/:date/reopen", async (request, reply) => {
    const params = parseOr400(dayParamsSchema, request.params, reply);
    if (!params) return reply;
    const input = parseOr400(reopenDayInputSchema, request.body, reply);
    if (!input) return reply;
    try {
      return reopenDay(db, params.date, input, clock());
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
