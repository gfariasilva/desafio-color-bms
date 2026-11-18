import type { FastifyInstance } from "fastify";
import {
  createExpenseInputSchema,
  dayExpensesParamsSchema,
  EXPENSE_TEXTS,
  updateExpenseInputSchema,
} from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { parseId, parseOr400, sendError } from "../../http/route-helpers";
import { createExpense, deleteExpense, getDayExpenses, updateExpense } from "./expenses.repository";

const EXPENSE_NOT_FOUND = { error: EXPENSE_TEXTS.notFound };

/** FR-06: general expenses ("saídas diárias"): the day's list, register, edit and delete. */
export function registerExpenseRoutes(
  app: FastifyInstance,
  { db }: DatabaseConnection,
  clock: Clock,
): void {
  app.get("/api/days/:date/expenses", async (request, reply) => {
    const params = parseOr400(dayExpensesParamsSchema, request.params, reply);
    if (!params) return reply;
    return getDayExpenses(db, params.date);
  });

  app.post("/api/expenses", async (request, reply) => {
    const input = parseOr400(createExpenseInputSchema, request.body, reply);
    if (!input) return reply;
    try {
      return reply.code(201).send(createExpense(db, input, clock()));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>("/api/expenses/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return reply.code(404).send(EXPENSE_NOT_FOUND);
    const input = parseOr400(updateExpenseInputSchema, request.body, reply);
    if (!input) return reply;
    try {
      return updateExpense(db, id, input, clock());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/expenses/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return reply.code(404).send(EXPENSE_NOT_FOUND);
    try {
      deleteExpense(db, id, clock());
      return reply.code(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
