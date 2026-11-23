import fs from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { systemClock, type Clock } from "./clock";
import type { DatabaseConnection } from "./db/client";
import { registerHostGuard } from "./http/host-guard";
import { registerAuditRoutes } from "./modules/audit/audit.routes";
import { registerBackupRoutes } from "./modules/backup/backup.routes";
import { createBackupService, type BackupService } from "./modules/backup/backup.service";
import {
  registerCashClosingRoutes,
  type OnDayClosed,
} from "./modules/cash-closing/cash-closing.routes";
import { registerCashWithdrawalRoutes } from "./modules/cash-withdrawals/cash-withdrawals.routes";
import { registerCategoryRoutes } from "./modules/categories/categories.routes";
import { registerExpenseRoutes } from "./modules/expenses/expenses.routes";
import { createExportQueue, type ExportQueueService } from "./modules/export/export-queue.service";
import { registerExportRoutes } from "./modules/export/export.routes";
import {
  registerFixedExpenseRoutes,
  registerMonthGeneration,
} from "./modules/fixed-expenses/fixed-expenses.routes";
import { registerContaConversionRoutes } from "./modules/fixed-expenses/conta-conversion.routes";
import { registerFixedExpenseTemplateRoutes } from "./modules/fixed-expense-templates/fixed-expense-templates.routes";
import { registerPaymentRoutes } from "./modules/payments/payments.routes";
import {
  registerMonthClosingRoutes,
  type OnMonthClosed,
} from "./modules/month-closing/month-closing.routes";
import { registerDayReportRoutes } from "./modules/reports/day-report.routes";
import { registerMonthReportRoutes } from "./modules/reports/month-reports.routes";
import { registerHealthRoutes } from "./modules/health/health.routes";
import type { SystemInfo } from "./modules/health/system-checks";
import { registerSalesRoutes } from "./modules/sales/sales.routes";
import { createSettingsStore, type SettingsStore } from "./modules/settings/settings.repository";
import { registerSettingsRoutes } from "./modules/settings/settings.routes";
import packageJson from "../package.json" with { type: "json" };

export type { SystemInfo };

export interface BuildAppOptions {
  connection: DatabaseConnection;
  /** Built web app to serve. Skipped when missing (dev uses the Vite server instead). */
  webDistDir?: string;
  logger?: boolean;
  /** The current time (ADR 0002). Tests pass a fixed clock. */
  now?: Clock;
  /**
   * FR-08: called after a day's closing is committed, after the backup and the daily export
   * (#21). Tests use it to observe closings; a no-op by default.
   */
  onDayClosed?: OnDayClosed;
  /**
   * #25: the pilot backup to OneDrive, run after every day closing (FR-31) before
   * `onDayClosed`. Defaults to a service with no folder (nothing is written).
   */
  backup?: BackupService;
  /**
   * FR-28 / FR-29 / FR-30 (#21, #28): the export queue (daily and monthly spreadsheets).
   * main.ts passes the real one; defaults to a disabled queue (nothing is queued or written),
   * like the backup's default.
   */
  exports?: ExportQueueService;
  /**
   * FR-16: called after a month's closing is committed, after the final monthly spreadsheet
   * (FR-29, #28) is written. The backup (#22) hooks in here; a no-op by default. A failure
   * never undoes the closing.
   */
  onMonthClosed?: OnMonthClosed;
  /**
   * #26: data and OneDrive folders, port, trial mode and build time, for the startup checks on
   * GET /api/health. Tests may leave it out; then only the clock checks are made.
   */
  system?: SystemInfo;
  /**
   * FR-33 (#20): the settings. main.ts passes the store that also feeds the backup folder;
   * defaults to one with no env override and no trial mode.
   */
  settings?: SettingsStore;
}

/** Creates the Fastify app without listening, so tests can call `app.inject()`. */
export async function buildApp({
  connection,
  webDistDir,
  logger = false,
  now = systemClock,
  onDayClosed = () => {},
  onMonthClosed = () => {},
  backup,
  exports,
  system,
  settings,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger });
  const backupService =
    backup ??
    createBackupService({
      sqlite: connection.sqlite,
      folder: null,
      now,
      log: { info: () => {}, error: () => {} },
    });
  const settingsStore =
    settings ?? createSettingsStore(connection, { envOneDriveFolder: null, trial: false });
  const exportQueue =
    exports ??
    createExportQueue({
      connection,
      folder: () => null,
      enabled: false,
      now,
      log: { info: () => {}, error: () => {} },
    });
  // FR-08: after each closing, queue the daily spreadsheet (FR-28) and the month's
  // spreadsheet (FR-29) first, so they are in the database as soon as possible; then the
  // backup (FR-31, #25) and the export run. Neither throws, so the hook chain goes on.
  const afterDayClosed: OnDayClosed = async (date) => {
    exportQueue.enqueueDailySpreadsheet(date);
    exportQueue.enqueueMonthlySpreadsheet(date.slice(0, 7));
    await backupService.run("day-close");
    await exportQueue.processPending();
    await onDayClosed(date);
  };
  // FR-16 / FR-29: after a month's closing, its final monthly spreadsheet, then the app's hook
  // (the backup, #22). A closed-again month overwrites the earlier file.
  const afterMonthClosed: OnMonthClosed = async (yearMonth) => {
    exportQueue.enqueueMonthlySpreadsheet(yearMonth);
    await exportQueue.processPending();
    await onMonthClosed(yearMonth);
  };
  // Shutdown: stop the 5-minute retries and let a file being written finish.
  app.addHook("onClose", async () => {
    await exportQueue.stop();
  });

  registerHostGuard(app);
  // FR-11: generate the month's fixed expenses now and on the first request of a new month.
  registerMonthGeneration(app, connection, now);
  registerHealthRoutes(app, connection, { version: packageJson.version, now, system });
  registerAuditRoutes(app, connection);
  registerBackupRoutes(app, backupService);
  registerExportRoutes(app, exportQueue);
  // FR-33: a new OneDrive folder gets today's backup (FR-31) and the pending exports (FR-30).
  registerSettingsRoutes(app, settingsStore, now, async () => {
    await backupService.folderChanged();
    await exportQueue.processAll();
  });
  registerCategoryRoutes(app, connection, now);
  registerPaymentRoutes(app, connection, now);
  registerFixedExpenseTemplateRoutes(app, connection, now);
  registerFixedExpenseRoutes(app, connection, now);
  registerSalesRoutes(app, connection, now);
  registerExpenseRoutes(app, connection, now);
  registerCashWithdrawalRoutes(app, connection, now);
  registerCashClosingRoutes(app, connection, now, afterDayClosed);
  registerContaConversionRoutes(app, connection, now, afterDayClosed);
  registerMonthClosingRoutes(app, connection, now, afterMonthClosed);
  registerDayReportRoutes(app, connection, now);
  registerMonthReportRoutes(app, connection, now);

  if (webDistDir && fs.existsSync(webDistDir)) {
    await app.register(fastifyStatic, { root: webDistDir });
    // Single-page app: unknown non-API GET routes return index.html (React Router handles them).
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "not_found" });
    });
  }

  return app;
}
