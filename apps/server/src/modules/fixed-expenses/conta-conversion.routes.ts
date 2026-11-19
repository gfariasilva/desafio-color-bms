import type { FastifyInstance } from "fastify";
import { CASH_WITHDRAWAL_TEXTS, convertContaInputSchema } from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { parseId, parseOr400, sendError } from "../../http/route-helpers";
import { runAfterDayClosed, type OnDayClosed } from "../cash-closing/cash-closing.routes";
import { convertConta, listContaCandidates } from "./conta-conversion.repository";

/**
 * #13: converting the pilot's "CONTA:" sangrias into paid fixed expenses.
 * GET /api/conta-conversions lists what is left; POST /api/conta-conversions/:withdrawalId
 * converts one sangria (and closes its day again when it was closed).
 */
export function registerContaConversionRoutes(
  app: FastifyInstance,
  { db }: DatabaseConnection,
  clock: Clock,
  onDayClosed: OnDayClosed,
): void {
  app.get("/api/conta-conversions", async () => listContaCandidates(db));

  app.post<{ Params: { withdrawalId: string } }>(
    "/api/conta-conversions/:withdrawalId",
    async (request, reply) => {
      const id = parseId(request.params.withdrawalId);
      if (id === null) return reply.code(404).send({ error: CASH_WITHDRAWAL_TEXTS.notFound });
      const input = parseOr400(convertContaInputSchema, request.body, reply);
      if (!input) return reply;
      let result;
      try {
        result = convertConta(db, id, input, clock());
      } catch (error) {
        return sendError(reply, error);
      }
      // FR-08: a re-closed day queues its exports and backup again, after the commit.
      if (result.reclosedDate) runAfterDayClosed(request, onDayClosed, result.reclosedDate);
      return result.expense;
    },
  );
}
