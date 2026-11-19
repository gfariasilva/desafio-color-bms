import type { FastifyInstance } from "fastify";
import { count } from "drizzle-orm";
import type { HealthResponse } from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { settings } from "../../db/schema";
import { runSystemChecks, type SystemInfo } from "./system-checks";

export interface HealthOptions {
  version: string;
  now: Clock;
  /** #26: where the server runs; without it only the clock checks are made. */
  system?: SystemInfo;
}

/**
 * GET /api/health: proves the server and the database are working, and reports the version
 * and the startup checks (#26) shown on Início.
 */
export function registerHealthRoutes(
  app: FastifyInstance,
  { sqlite, db }: DatabaseConnection,
  { version, now, system }: HealthOptions,
): void {
  app.get("/api/health", async (): Promise<HealthResponse> => {
    const sqliteVersion = sqlite.prepare("select sqlite_version() as v").pluck().get() as string;
    const journalMode = sqlite.pragma("journal_mode", { simple: true }) as string;
    const [row] = await db.select({ value: count() }).from(settings);
    const at = now();
    return {
      status: "ok",
      version,
      serverTime: at.toISOString(),
      db: { sqliteVersion, journalMode, settingsCount: row?.value ?? 0 },
      trial: system?.trial ?? false,
      checks: runSystemChecks(sqlite, at, system),
    };
  });
}
