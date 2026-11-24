import type { FastifyInstance } from "fastify";
import type { HomeAlertsResponse } from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import type { SettingsStore } from "../settings/settings.repository";
import { getHomeAlerts } from "./alerts.repository";

/** FR-27: the alerts of Início, with the thresholds of Configurações (FR-33). */
export function registerAlertRoutes(
  app: FastifyInstance,
  { db }: DatabaseConnection,
  settings: SettingsStore,
  clock: Clock,
): void {
  app.get("/api/alerts", async (): Promise<HomeAlertsResponse> => {
    const { dueSoonDays, cashDifferenceLimitCents } = settings.read();
    return getHomeAlerts(db, { dueSoonDays, cashDifferenceLimitCents }, clock());
  });
}
