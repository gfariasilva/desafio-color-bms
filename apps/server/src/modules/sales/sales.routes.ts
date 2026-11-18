import type { FastifyInstance } from "fastify";
import {
  createSaleInputSchema,
  daySalesParamsSchema,
  saleListQuerySchema,
  SALE_TEXTS,
  todayCivilDate,
  updateSaleInputSchema,
  type SaleListResponse,
  type TodayResponse,
} from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { parseId, parseOr400, sendError } from "../../http/route-helpers";
import { createSale, deleteSale, getDaySales, listSales, updateSale } from "./sales.repository";

const SALE_NOT_FOUND = { error: SALE_TEXTS.notFound };

/**
 * FR-01 / FR-02: register sales and list the sales of a day; FR-03: edit and delete a sale;
 * FR-05: the day per tab; RN-15: today's date.
 */
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

  // FR-05 / RN-05: the day grouped by tab, with subtotals and totals.
  app.get("/api/days/:date/sales", async (request, reply) => {
    const params = parseOr400(daySalesParamsSchema, request.params, reply);
    if (!params) return reply;
    return getDaySales(db, params.date);
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

  app.patch<{ Params: { id: string } }>("/api/sales/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return reply.code(404).send(SALE_NOT_FOUND);
    const input = parseOr400(updateSaleInputSchema, request.body, reply);
    if (!input) return reply;
    try {
      return updateSale(db, id, input, clock());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/sales/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return reply.code(404).send(SALE_NOT_FOUND);
    try {
      deleteSale(db, id, clock());
      return reply.code(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
