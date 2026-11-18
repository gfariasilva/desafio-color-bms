import {
  auditListResponseSchema,
  expenseCategoryListResponseSchema,
  expenseCategorySchema,
  saleCategoryListResponseSchema,
  saleCategorySchema,
  type CreateExpenseCategoryInput,
  type CreateSaleCategoryInput,
  type ExpenseCategory,
  type SaleCategory,
  type UpdateExpenseCategoryInput,
  type UpdateSaleCategoryInput,
  healthResponseSchema,
  type AuditListResponse,
  type AuditQuery,
  type HealthResponse,
} from "@color-bms/core";
import type { z } from "zod";

/** Thrown when the server answers with a non-2xx status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Machine-readable reason sent by the server, e.g. CATEGORY_IN_USE_CODE. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * GET a JSON endpoint and validate it with a shared Zod schema from @color-bms/core,
 * so the UI never works with data of an unexpected shape.
 */
async function getJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  return requestJson("GET", url, undefined, schema);
}

/**
 * Sends a request with an optional JSON body. Validates the answer with `schema`, or ignores
 * it when `schema` is undefined (e.g. 204 No Content).
 */
async function requestJson<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T>;
async function requestJson(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body: unknown,
): Promise<void>;
async function requestJson<T>(
  method: string,
  url: string,
  body: unknown,
  schema?: z.ZodType<T>,
): Promise<T | void> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    // The server sends pt-BR messages as { error: "…", code?: "…" } (e.g. a duplicate name).
    const data = (await response.json().catch(() => null)) as {
      error?: unknown;
      code?: unknown;
    } | null;
    const message =
      typeof data?.error === "string"
        ? data.error
        : `${method} ${url} failed with ${response.status}`;
    throw new ApiError(
      response.status,
      message,
      typeof data?.code === "string" ? data.code : undefined,
    );
  }
  if (!schema) return;
  return schema.parse(await response.json());
}

/** Builds a query string, skipping empty values. */
function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const api = {
  health: (): Promise<HealthResponse> => getJson("/api/health", healthResponseSchema),
  /** FR-18: read-only audit log, newest first. */
  audit: (query: Partial<AuditQuery>): Promise<AuditListResponse> =>
    getJson(`/api/audit${toQueryString(query)}`, auditListResponseSchema),

  /** FR-14: sale tabs (abas), in display order. */
  saleCategories: {
    list: (): Promise<SaleCategory[]> =>
      getJson("/api/sale-categories", saleCategoryListResponseSchema).then((r) => r.categories),
    create: (input: CreateSaleCategoryInput): Promise<SaleCategory> =>
      requestJson("POST", "/api/sale-categories", input, saleCategorySchema),
    update: (id: number, changes: UpdateSaleCategoryInput): Promise<SaleCategory> =>
      requestJson("PATCH", `/api/sale-categories/${id}`, changes, saleCategorySchema),
    reorder: (ids: number[]): Promise<SaleCategory[]> =>
      requestJson(
        "PUT",
        "/api/sale-categories/order",
        { ids },
        saleCategoryListResponseSchema,
      ).then((r) => r.categories),
    remove: (id: number): Promise<void> =>
      requestJson("DELETE", `/api/sale-categories/${id}`, undefined),
  },

  /** FR-14: general-expense categories, in display order. */
  expenseCategories: {
    list: (): Promise<ExpenseCategory[]> =>
      getJson("/api/expense-categories", expenseCategoryListResponseSchema).then(
        (r) => r.categories,
      ),
    create: (input: CreateExpenseCategoryInput): Promise<ExpenseCategory> =>
      requestJson("POST", "/api/expense-categories", input, expenseCategorySchema),
    update: (id: number, changes: UpdateExpenseCategoryInput): Promise<ExpenseCategory> =>
      requestJson("PATCH", `/api/expense-categories/${id}`, changes, expenseCategorySchema),
    reorder: (ids: number[]): Promise<ExpenseCategory[]> =>
      requestJson(
        "PUT",
        "/api/expense-categories/order",
        { ids },
        expenseCategoryListResponseSchema,
      ).then((r) => r.categories),
    remove: (id: number): Promise<void> =>
      requestJson("DELETE", `/api/expense-categories/${id}`, undefined),
  },
};
