import type { FastifyInstance } from "fastify";
import {
  CASH_WITHDRAWAL_TEXTS,
  createCashWithdrawalInputSchema,
  dayCashWithdrawalsParamsSchema,
  updateCashWithdrawalInputSchema,
} from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { parseId, parseOr400, sendError } from "../../http/route-helpers";
import {
  createCashWithdrawal,
  deleteCashWithdrawal,
  getDayCashWithdrawals,
  updateCashWithdrawal,
} from "./cash-withdrawals.repository";

const NOT_FOUND = { error: CASH_WITHDRAWAL_TEXTS.notFound };

/** FR-07: sangrias (cash withdrawals): the day's list, register, edit and delete. */
export function registerCashWithdrawalRoutes(
  app: FastifyInstance,
  { db }: DatabaseConnection,
  clock: Clock,
): void {
  app.get("/api/days/:date/cash-withdrawals", async (request, reply) => {
    const params = parseOr400(dayCashWithdrawalsParamsSchema, request.params, reply);
    if (!params) return reply;
    return getDayCashWithdrawals(db, params.date);
  });

  app.post("/api/cash-withdrawals", async (request, reply) => {
    const input = parseOr400(createCashWithdrawalInputSchema, request.body, reply);
    if (!input) return reply;
    try {
      return reply.code(201).send(createCashWithdrawal(db, input, clock()));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>("/api/cash-withdrawals/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return reply.code(404).send(NOT_FOUND);
    const input = parseOr400(updateCashWithdrawalInputSchema, request.body, reply);
    if (!input) return reply;
    try {
      return updateCashWithdrawal(db, id, input, clock());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/cash-withdrawals/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return reply.code(404).send(NOT_FOUND);
    try {
      deleteCashWithdrawal(db, id, clock());
      return reply.code(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
