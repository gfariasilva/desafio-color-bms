import type { FastifyReply } from "fastify";
import type { z } from "zod";

/**
 * Small helpers shared by the API modules (categories, payments, …): request validation with
 * the core Zod schemas, `:id` parsing and business errors with pt-BR messages.
 */

/** A business error the routes turn into an HTTP answer with a pt-BR message. */
export class BusinessError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    /** Machine-readable reason for the UI, e.g. CATEGORY_IN_USE_CODE. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "BusinessError";
  }
}

/** Sends 400 with the first pt-BR validation message, or returns the parsed value. */
export function parseOr400<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  reply: FastifyReply,
): T | undefined {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  void reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." });
  return undefined;
}

/** `:id` must be a positive integer; anything else is "not found". */
export function parseId(raw: string): number | null {
  return /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : null;
}

/** Turns a BusinessError into its HTTP answer; anything else is a real bug (500). */
export function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof BusinessError) {
    return reply
      .code(error.status)
      .send(error.code ? { error: error.message, code: error.code } : { error: error.message });
  }
  throw error;
}
