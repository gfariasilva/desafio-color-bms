import {
  auditListResponseSchema,
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
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    // The server sends pt-BR messages as { error: "…" } (e.g. invalid filters).
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const message =
      typeof body?.error === "string" ? body.error : `GET ${url} failed with ${response.status}`;
    throw new ApiError(response.status, message);
  }
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
};
