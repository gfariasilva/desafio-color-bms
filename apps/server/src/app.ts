import fs from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { todayCivilDate, type RestoreResult } from "@color-bms/core";
import { systemClock, type Clock } from "./clock";
import type { DatabaseConnection } from "./db/client";
import { registerHostGuard } from "./http/host-guard";
import { registerAlertRoutes } from "./modules/alerts/alerts.routes";
import { registerAuditRoutes } from "./modules/audit/audit.routes";
import { registerBackupRoutes } from "./modules/backup/backup.routes";
import { createRestoreService } from "./modules/backup/restore.service";
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
  type OnMonthReopened,
} from "./modules/month-closing/month-closing.routes";
import { registerDayReportRoutes } from "./modules/reports/day-report.routes";
import { registerMonthReportRoutes } from "./modules/reports/month-reports.routes";
import { registerDashboardRoutes } from "./modules/dashboards/dashboards.routes";
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
   * FR-28 to FR-31 (#21, #28, #22): the export queue: daily and monthly spreadsheets and the
   * database backups. main.ts passes the real one; defaults to a disabled queue (nothing is
   * queued or written: no backup either).
   */
  exports?: ExportQueueService;
  /**
   * FR-32 (#22): restoring a backup. main.ts passes its folders and restarts the server when
   * `onRestartRequested` is called; without it, only GET /api/backup/status is served.
   */
  restore?: {
    dataDir: string;
    localBackupDir: string;
    onRestartRequested: () => void;
    /** The result of the restore done at this start, shown after the restart. */
    lastResult?: RestoreResult | null;
  };
  /**
   * FR-16: called after a month's closing is committed, once the final monthly spreadsheet
   * (FR-29, #28) and the backup (FR-31, #22) are queued, and before they are written. A no-op
   * by default. A failure never undoes the closing.
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
  exports,
  restore,
  system,
  settings,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger });
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
  // FR-08: after each closing, queue the daily spreadsheet (FR-28), the month's spreadsheet
  // (FR-29) and a database backup (FR-31) first, so they are in the database as soon as
  // possible; then the queue writes them, the backup first. It never throws, so the hook
  // chain goes on.
  const afterDayClosed: OnDayClosed = async (date) => {
    exportQueue.enqueueDailySpreadsheet(date);
    exportQueue.enqueueMonthlySpreadsheet(date.slice(0, 7));
    exportQueue.enqueueBackup(todayCivilDate(now()));
    await exportQueue.processPending();
    await onDayClosed(date);
  };
  // FR-16 / FR-29 / FR-31: after a month's closing, queue its final monthly spreadsheet and a
  // backup, run the app's hook, then the export (the backup first). A closed-again month
  // overwrites the earlier file.
  const afterMonthClosed: OnMonthClosed = async (yearMonth) => {
    exportQueue.enqueueMonthlySpreadsheet(yearMonth);
    exportQueue.enqueueBackup(todayCivilDate(now()));
    try {
      await onMonthClosed(yearMonth);
    } finally {
      await exportQueue.processPending();
    }
  };
  // FR-17 / FR-29: a reopened month's file goes back to the partial version.
  const afterMonthReopened: OnMonthReopened = async (yearMonth) => {
    exportQueue.enqueueMonthlySpreadsheet(yearMonth);
    await exportQueue.processPending();
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
  registerBackupRoutes(app, {
    oneDriveFolder: () => exportQueue.oneDriveFolder(),
    restore: restore
      ? createRestoreService({
          dataDir: restore.dataDir,
          localBackupDir: restore.localBackupDir,
          oneDriveFolder: () => exportQueue.oneDriveFolder(),
          now,
        })
      : null,
    lastRestore: restore?.lastResult ?? null,
    onRestartRequested: restore?.onRestartRequested ?? (() => {}),
    now,
  });
  registerExportRoutes(app, exportQueue);
  // FR-33: a new OneDrive folder gets today's backup (FR-31) and the pending exports (FR-30).
  registerSettingsRoutes(app, settingsStore, now, () => exportQueue.folderChanged());
  registerCategoryRoutes(app, connection, now);
  registerPaymentRoutes(app, connection, now);
  registerFixedExpenseTemplateRoutes(app, connection, now);
  registerFixedExpenseRoutes(app, connection, now);
  registerSalesRoutes(app, connection, now);
  registerExpenseRoutes(app, connection, now);
  registerCashWithdrawalRoutes(app, connection, now);
  registerCashClosingRoutes(app, connection, now, afterDayClosed);
  registerContaConversionRoutes(app, connection, now, afterDayClosed);
  registerMonthClosingRoutes(app, connection, now, afterMonthClosed, afterMonthReopened);
  registerDayReportRoutes(app, connection, now);
  registerMonthReportRoutes(app, connection, now);
  registerDashboardRoutes(app, connection, now);
  // FR-27: the alerts of Início, with the FR-33 thresholds.
  registerAlertRoutes(app, connection, settingsStore, now);

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
