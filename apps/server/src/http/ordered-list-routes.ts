import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { categoryListQuerySchema, reorderCategoriesInputSchema } from "@color-bms/core";
import { parseId, parseOr400, sendError } from "./route-helpers";

/** What one ordered master-data list (FR-14 categories, FR-15 payment lists) can do. */
export interface OrderedListRepository<TCreate, TUpdate> {
  list(active?: boolean): unknown[];
  create(input: TCreate): unknown;
  update(id: number, changes: TUpdate): unknown;
  reorder(ids: number[]): unknown[];
  /** Lists without a delete (FR-10 fixed-expense templates) leave it out: no DELETE route. */
  remove?(id: number): void;
}

export interface OrderedListRoutesOptions<TCreate, TUpdate> {
  /** e.g. "/api/sale-categories". */
  url: string;
  /** Key of the list in GET and PUT /order responses, e.g. "categories". */
  key: string;
  /** pt-BR message for an unknown id. */
  notFound: string;
  createSchema: z.ZodType<TCreate, z.ZodTypeDef, unknown>;
  updateSchema: z.ZodType<TUpdate, z.ZodTypeDef, unknown>;
  repository: OrderedListRepository<TCreate, TUpdate>;
}

/**
 * FR-14 / FR-15: the endpoints every ordered master-data list has:
 * GET (?active=true for the entry forms, ?active=false for only the deactivated ones),
 * POST, PUT /order, PATCH /:id and DELETE /:id (only when the repository can remove).
 * Business errors become pt-BR answers.
 */
export function registerOrderedListRoutes<TCreate, TUpdate>(
  app: FastifyInstance,
  options: OrderedListRoutesOptions<TCreate, TUpdate>,
): void {
  const { url, key, createSchema, updateSchema, repository } = options;
  const notFound = { error: options.notFound };

  app.get(url, async (request, reply) => {
    const query = parseOr400(categoryListQuerySchema, request.query, reply);
    if (!query) return reply;
    return { [key]: repository.list(query.active) };
  });

  app.post(url, async (request, reply) => {
    const input = parseOr400(createSchema, request.body, reply);
    if (!input) return reply;
    try {
      return reply.code(201).send(repository.create(input));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Registered before "/:id" routes; Fastify matches the static segment first anyway.
  app.put(`${url}/order`, async (request, reply) => {
    const input = parseOr400(reorderCategoriesInputSchema, request.body, reply);
    if (!input) return reply;
    try {
      return { [key]: repository.reorder(input.ids) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>(`${url}/:id`, async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return reply.code(404).send(notFound);
    const changes = parseOr400(updateSchema, request.body, reply);
    if (!changes) return reply;
    try {
      return repository.update(id, changes);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  if (!repository.remove) return;
  app.delete<{ Params: { id: string } }>(`${url}/:id`, async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return reply.code(404).send(notFound);
    try {
      // Called on the repository (not detached), so a class-based one keeps its `this`.
      repository.remove?.(id);
      return reply.code(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
