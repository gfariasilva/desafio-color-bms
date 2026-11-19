import type { FastifyInstance } from "fastify";
import type { BackupStatusResponse } from "@color-bms/core";
import type { BackupService } from "./backup.service";

/** GET /api/backup/status: the pilot backup's state, shown on Início (#25). */
export function registerBackupRoutes(app: FastifyInstance, backup: BackupService): void {
  app.get("/api/backup/status", async (): Promise<BackupStatusResponse> => backup.status());
}
