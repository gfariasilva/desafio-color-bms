import type { FastifyInstance } from "fastify";
import type { ExportQueueStatusResponse } from "@color-bms/core";
import type { ExportQueueService } from "./export-queue.service";

/** FR-30: the export queue's state on Início, and "Tentar agora". */
export function registerExportRoutes(app: FastifyInstance, exports: ExportQueueService): void {
  app.get("/api/exports/status", async (): Promise<ExportQueueStatusResponse> => exports.status());

  // FR-30 "Tentar agora": tries every open item now and answers with the new state.
  app.post("/api/exports/retry", async (): Promise<ExportQueueStatusResponse> => {
    await exports.processAll();
    return exports.status();
  });
}
