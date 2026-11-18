import type { FastifyInstance } from "fastify";
import {
  CARD_FEE_TEXTS,
  cardFeeInForceQuerySchema,
  cardFeeInputSchema,
  categoryListQuerySchema,
  createCardMachineInputSchema,
  createPaymentMethodInputSchema,
  PAYMENT_LIST_TEXTS,
  reorderCategoriesInputSchema,
  updateCardMachineInputSchema,
  updatePaymentMethodInputSchema,
  type PaymentListKind,
} from "@color-bms/core";
import type { DatabaseConnection } from "../../db/client";
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

/** Each list's URL, response key and the Zod schemas that validate its request bodies. */
const LISTS = {
  payment_method: {
    url: "/api/payment-methods",
    key: "paymentMethods",
    create: createPaymentMethodInputSchema,
    update: updatePaymentMethodInputSchema,
  },
  card_machine: {
    url: "/api/card-machines",
    key: "cardMachines",
    create: createCardMachineInputSchema,
    update: updateCardMachineInputSchema,
  },
} as const;

/** FR-15: the same endpoints as the categories (FR-14), for one list. */
function registerList(app: FastifyInstance, { db }: DatabaseConnection, kind: PaymentListKind) {
  const { url, key, create, update } = LISTS[kind];
  const notFound = { error: PAYMENT_LIST_TEXTS[kind].notFound };

  // ?active=true for the sale form, ?active=false for only the deactivated ones.
  app.get(url, async (request, reply) => {
    const query = parseOr400(categoryListQuerySchema, request.query, reply);
    if (!query) return reply;
    return { [key]: listPaymentItems(db, kind, query.active) };
  });

  app.post(url, async (request, reply) => {
    const input = parseOr400(create, request.body, reply);
    if (!input) return reply;
    try {
      return reply.code(201).send(createPaymentItem(db, kind, input));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.put(`${url}/order`, async (request, reply) => {
    const input = parseOr400(reorderCategoriesInputSchema, request.body, reply);
    if (!input) return reply;
    try {
      return { [key]: reorderPaymentItems(db, kind, input.ids) };
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
      return updatePaymentItem(db, kind, id, changes);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>(`${url}/:id`, async (request, reply) => {
    const id = parseId(request.params.id);
    if (id === null) return reply.code(404).send(notFound);
    try {
      deletePaymentItem(db, kind, id);
      return reply.code(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
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
  registerList(app, connection, "payment_method");
  registerList(app, connection, "card_machine");
  registerCardFees(app, connection);
}
