import type { FastifyInstance } from "fastify";
import { count } from "drizzle-orm";
import type { HealthResponse } from "@color-bms/core";
import type { DatabaseConnection } from "../../db/client";
import { settings } from "../../db/schema";

/** GET /api/health: proves the server and the database are working. */
export function registerHealthRoutes(
  app: FastifyInstance,
  { sqlite, db }: DatabaseConnection,
  version: string,
): void {
  app.get("/api/health", async (): Promise<HealthResponse> => {
    const sqliteVersion = sqlite.prepare("select sqlite_version() as v").pluck().get() as string;
    const journalMode = sqlite.pragma("journal_mode", { simple: true }) as string;
    const [row] = await db.select({ value: count() }).from(settings);
    return {
      status: "ok",
      version,
      serverTime: new Date().toISOString(),
      db: { sqliteVersion, journalMode, settingsCount: row?.value ?? 0 },
    };
  });
}
