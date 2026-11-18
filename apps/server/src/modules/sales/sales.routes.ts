import type { FastifyInstance } from "fastify";
import {
  createSaleInputSchema,
  saleListQuerySchema,
  todayCivilDate,
  type SaleListResponse,
  type TodayResponse,
} from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { parseOr400, sendError } from "../../http/route-helpers";
import { createSale, listSales } from "./sales.repository";

/** FR-01 / FR-02: register sales and list the sales of a day; RN-15: today's date. */
export function registerSalesRoutes(
  app: FastifyInstance,
  { db }: DatabaseConnection,
  clock: Clock,
): void {
  // RN-15: the UI takes "today" from the server, never from the browser clock (ADR 0002).
  app.get("/api/today", async (): Promise<TodayResponse> => ({ date: todayCivilDate(clock()) }));

  app.get("/api/sales", async (request, reply) => {
    const query = parseOr400(saleListQuerySchema, request.query, reply);
    if (!query) return reply;
    const response: SaleListResponse = { sales: listSales(db, query.date) };
    return response;
  });

  app.post("/api/sales", async (request, reply) => {
    const input = parseOr400(createSaleInputSchema, request.body, reply);
    if (!input) return reply;
    try {
      return reply.code(201).send(createSale(db, input, clock()));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
