import type { FastifyInstance } from "fastify";
import {
  CATEGORY_TEXTS,
  categoryListQuerySchema,
  createExpenseCategoryInputSchema,
  createSaleCategoryInputSchema,
  reorderCategoriesInputSchema,
  updateExpenseCategoryInputSchema,
  updateSaleCategoryInputSchema,
  type CategoryKind,
} from "@color-bms/core";
import type { DatabaseConnection } from "../../db/client";
import { parseId, parseOr400, sendError } from "../../http/route-helpers";
import {
  createCategory,
  deleteCategory,
  listCategories,
  reorderCategories,
  updateCategory,
} from "./categories.repository";

/** Each list's URL and the Zod schemas that validate its request bodies. */
const ROUTES = {
  sale: {
    url: "/api/sale-categories",
    create: createSaleCategoryInputSchema,
    update: updateSaleCategoryInputSchema,
  },
  expense: {
    url: "/api/expense-categories",
    create: createExpenseCategoryInputSchema,
    update: updateExpenseCategoryInputSchema,
  },
} as const;

function registerKind(app: FastifyInstance, { db }: DatabaseConnection, kind: CategoryKind) {
  const { url, create, update } = ROUTES[kind];
  const notFound = { error: CATEGORY_TEXTS[kind].notFound };

  // FR-14: the list in display order; ?active=true for the entry forms, ?active=false
  // for only the deactivated ones.
  app.get(url, async (request, reply) => {
    const query = parseOr400(categoryListQuerySchema, request.query, reply);
    if (!query) return reply;
    return { categories: listCategories(db, kind, query.active) };
  });

  app.post(url, async (request, reply) => {
    const input = parseOr400(create, request.body, reply);
    if (!input) return reply;
    try {
      return reply.code(201).send(createCategory(db, kind, input));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Registered before "/:id" routes; Fastify matches the static segment first anyway.
  app.put(`${url}/order`, async (request, reply) => {
    const input = parseOr400(reorderCategoriesInputSchema, request.body, reply);
    if (!input) return reply;
    try {
      return { categories: reorderCategories(db, kind, input.ids) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>(`${url}/:id`, async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return reply.code(404).send(notFound);
    const changes = parseOr400(update, request.body, reply);
    if (!changes) return reply;
    try {
      return updateCategory(db, kind, id, changes);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>(`${url}/:id`, async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return reply.code(404).send(notFound);
    try {
      deleteCategory(db, kind, id);
      return reply.code(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });
}

/**
 * FR-14: /api/sale-categories (abas) and /api/expense-categories, with the same endpoints:
 * GET (list), POST (create), PATCH /:id (rename, activate, group), PUT /order, DELETE /:id.
 */
export function registerCategoryRoutes(app: FastifyInstance, connection: DatabaseConnection): void {
  registerKind(app, connection, "sale");
  registerKind(app, connection, "expense");
}
