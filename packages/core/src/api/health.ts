import { z } from "zod";

/** Response of GET /api/health. Shared by the server (producer) and the web app (consumer). */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  /** ISO-8601 UTC instant on the server. */
  serverTime: z.string(),
  db: z.object({
    sqliteVersion: z.string(),
    journalMode: z.string(),
    settingsCount: z.number().int().nonnegative(),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
