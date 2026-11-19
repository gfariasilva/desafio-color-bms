import { z } from "zod";
import { startupCheckSchema } from "../system/startup-checks";

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
  /** #26: true while the system runs on the trial data folder (training, before go-live). */
  trial: z.boolean(),
  /** #26: startup checks (time zone, clock, port, folders), shown on Início. */
  checks: z.array(startupCheckSchema),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
