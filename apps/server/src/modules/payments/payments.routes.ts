import type { FastifyInstance } from "fastify";
import {
  CARD_FEE_TEXTS,
  cardFeeInForceQuerySchema,
  cardFeeInputSchema,
  createCardMachineInputSchema,
  createPaymentMethodInputSchema,
  PAYMENT_LIST_TEXTS,
  updateCardMachineInputSchema,
  updatePaymentMethodInputSchema,
} from "@color-bms/core";
import type { DatabaseConnection } from "../../db/client";
import { registerOrderedListRoutes } from "../../http/ordered-list-routes";
import { parseId, parseOr400, sendError } from "../../http/route-helpers";
import {
  createCardFee,
  deleteCardFee,
  findCardFeeInForce,
  listCardFees,
  updateCardFee,
} from "./card-fees.repository";
import {
  createPaymentItem,
  deletePaymentItem,
  listPaymentItems,
  reorderPaymentItems,
  updatePaymentItem,
} from "./payment-lists.repository";

/** FR-15: the same endpoints as the categories (FR-14), for both payment lists. */
function registerPaymentLists(app: FastifyInstance, { db }: DatabaseConnection) {
  registerOrderedListRoutes(app, {
    url: "/api/payment-methods",
    key: "paymentMethods",
    notFound: PAYMENT_LIST_TEXTS.payment_method.notFound,
    createSchema: createPaymentMethodInputSchema,
    updateSchema: updatePaymentMethodInputSchema,
    repository: {
      list: (active) => listPaymentItems(db, "payment_method", active),
      create: (input) => createPaymentItem(db, "payment_method", input),
      update: (id, changes) => updatePaymentItem(db, "payment_method", id, changes),
      reorder: (ids) => reorderPaymentItems(db, "payment_method", ids),
      remove: (id) => deletePaymentItem(db, "payment_method", id),
    },
  });

  registerOrderedListRoutes(app, {
    url: "/api/card-machines",
    key: "cardMachines",
    notFound: PAYMENT_LIST_TEXTS.card_machine.notFound,
    createSchema: createCardMachineInputSchema,
    updateSchema: updateCardMachineInputSchema,
    repository: {
      list: (active) => listPaymentItems(db, "card_machine", active),
      create: (input) => createPaymentItem(db, "card_machine", input),
      update: (id, changes) => updatePaymentItem(db, "card_machine", id, changes),
      reorder: (ids) => reorderPaymentItems(db, "card_machine", ids),
      remove: (id) => deletePaymentItem(db, "card_machine", id),
    },
  });
}

/** FR-15: the fee table, and RN-01's lookup of the fee in force for a sale. */
function registerCardFees(app: FastifyInstance, { db }: DatabaseConnection) {
  const url = "/api/card-fees";
  const notFound = { error: CARD_FEE_TEXTS.notFound };

  app.get(url, async () => ({ fees: listCardFees(db) }));

  // RN-01: ?cardMachineId&paymentMethodId&installments&date → { fee } or { fee: null }.
  app.get(`${url}/in-force`, async (request, reply) => {
    const query = parseOr400(cardFeeInForceQuerySchema, request.query, reply);
    if (!query) return reply;
    return { fee: findCardFeeInForce(db, query) };
  });

  app.post(url, async (request, reply) => {
    const input = parseOr400(cardFeeInputSchema, request.body, reply);
    if (!input) return reply;
    try {
      return reply.code(201).send(createCardFee(db, input));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // PUT: the body is the whole row, as in POST.
  app.put<{ Params: { id: string } }>(`${url}/:id`, async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return reply.code(404).send(notFound);
    const input = parseOr400(cardFeeInputSchema, request.body, reply);
    if (!input) return reply;
    try {
      return updateCardFee(db, id, input);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>(`${url}/:id`, async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return reply.code(404).send(notFound);
    try {
      deleteCardFee(db, id);
      return reply.code(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });
}

/**
 * FR-15: /api/payment-methods and /api/card-machines (GET, POST, PATCH /:id, PUT /order,
 * DELETE /:id, like the categories), and /api/card-fees (GET, GET /in-force, POST,
 * PUT /:id, DELETE /:id).
 */
export function registerPaymentRoutes(app: FastifyInstance, connection: DatabaseConnection): void {
  registerPaymentLists(app, connection);
  registerCardFees(app, connection);
}
