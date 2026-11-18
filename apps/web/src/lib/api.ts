import { healthResponseSchema, type HealthResponse } from "@color-bms/core";
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
    throw new ApiError(response.status, `GET ${url} failed with ${response.status}`);
  }
  return schema.parse(await response.json());
}

export const api = {
  health: (): Promise<HealthResponse> => getJson("/api/health", healthResponseSchema),
};
