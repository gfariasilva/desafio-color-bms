import type { FastifyInstance } from "fastify";
import {
  CATEGORY_TEXTS,
  createExpenseCategoryInputSchema,
  createSaleCategoryInputSchema,
  updateExpenseCategoryInputSchema,
  updateSaleCategoryInputSchema,
} from "@color-bms/core";
import type { DatabaseConnection } from "../../db/client";
import { registerOrderedListRoutes } from "../../http/ordered-list-routes";
import {
  createCategory,
  deleteCategory,
  listCategories,
  reorderCategories,
  updateCategory,
} from "./categories.repository";

/**
 * FR-14: /api/sale-categories (abas) and /api/expense-categories, with the same endpoints:
 * GET (list), POST (create), PATCH /:id (rename, activate, group), PUT /order, DELETE /:id.
 */
export function registerCategoryRoutes(app: FastifyInstance, { db }: DatabaseConnection): void {
  registerOrderedListRoutes(app, {
    url: "/api/sale-categories",
    key: "categories",
    notFound: CATEGORY_TEXTS.sale.notFound,
    createSchema: createSaleCategoryInputSchema,
    updateSchema: updateSaleCategoryInputSchema,
    repository: {
      list: (active) => listCategories(db, "sale", active),
      create: (input) => createCategory(db, "sale", input),
      update: (id, changes) => updateCategory(db, "sale", id, changes),
      reorder: (ids) => reorderCategories(db, "sale", ids),
      remove: (id) => deleteCategory(db, "sale", id),
    },
  });

  registerOrderedListRoutes(app, {
    url: "/api/expense-categories",
    key: "categories",
    notFound: CATEGORY_TEXTS.expense.notFound,
    createSchema: createExpenseCategoryInputSchema,
    updateSchema: updateExpenseCategoryInputSchema,
    repository: {
      list: (active) => listCategories(db, "expense", active),
      create: (input) => createCategory(db, "expense", input),
      update: (id, changes) => updateCategory(db, "expense", id, changes),
      reorder: (ids) => reorderCategories(db, "expense", ids),
      remove: (id) => deleteCategory(db, "expense", id),
    },
  });
}
