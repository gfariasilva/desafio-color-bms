import type { FastifyInstance } from "fastify";
import {
  createFixedExpenseTemplateInputSchema,
  FIXED_EXPENSE_TEMPLATE_TEXTS,
  updateFixedExpenseTemplateInputSchema,
} from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { registerOrderedListRoutes } from "../../http/ordered-list-routes";
import {
  createFixedExpenseTemplate,
  listFixedExpenseTemplates,
  reorderFixedExpenseTemplates,
  updateFixedExpenseTemplate,
} from "./fixed-expense-templates.repository";

/**
 * FR-10: /api/fixed-expense-templates. GET (list, ?active=), POST (create),
 * PATCH /:id (edit, activate), PUT /order. No DELETE: templates are deactivated instead.
 */
export function registerFixedExpenseTemplateRoutes(
  app: FastifyInstance,
  { db }: DatabaseConnection,
  now: Clock,
): void {
  registerOrderedListRoutes(app, {
    url: "/api/fixed-expense-templates",
    key: "templates",
    notFound: FIXED_EXPENSE_TEMPLATE_TEXTS.notFound,
    createSchema: createFixedExpenseTemplateInputSchema,
    updateSchema: updateFixedExpenseTemplateInputSchema,
    repository: {
      list: (active) => listFixedExpenseTemplates(db, active),
      create: (input) => createFixedExpenseTemplate(db, input, now()),
      update: (id, changes) => updateFixedExpenseTemplate(db, id, changes, now()),
      reorder: (ids) => reorderFixedExpenseTemplates(db, ids, now()),
    },
  });
}
