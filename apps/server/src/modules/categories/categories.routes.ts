import type { FastifyInstance, FastifyReply } from "fastify";
import type { z } from "zod";
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
import {
  CategoryError,
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

/** Sends 400 with the first pt-BR validation message, or returns the parsed value. */
function parseOr400<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  reply: FastifyReply,
) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  void reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." });
  return undefined;
}

/** `:id` must be a positive integer; anything else is "not found". */
function parseId(raw: string): number | null {
  return /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : null;
}

/** Turns a CategoryError into its HTTP answer; anything else is a real bug (500). */
function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof CategoryError) {
    return reply
      .code(error.status)
      .send(error.code ? { error: error.message, code: error.code } : { error: error.message });
  }
  throw error;
}

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
