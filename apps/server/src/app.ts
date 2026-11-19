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
   * FR-08: called after a day's closing is committed, after the backup. The daily export (#21)
   * hooks in here; a no-op until then.
   */
  onDayClosed?: OnDayClosed;
  /**
   * #25: the pilot backup to OneDrive, run after every day closing (FR-31) before
   * `onDayClosed`. Defaults to a service with no folder (nothing is written).
   */
  backup?: BackupService;
  /**
   * FR-16: called after a month's closing is committed. The final monthly spreadsheet (#28)
   * and the backup (#22) hook in here; a no-op until then. A failure never undoes the closing.
   */
  onMonthClosed?: OnMonthClosed;
  /**
   * #26: data and OneDrive folders, port, trial mode and build time, for the startup checks on
   * GET /api/health. Tests may leave it out; then only the clock checks are made.
   */
  system?: SystemInfo;
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
  system,
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
  // FR-31 (#25): back up after each closing; the backup never throws, so the hook chain goes on.
  const afterDayClosed: OnDayClosed = async (date) => {
    await backupService.run("day-close");
    await onDayClosed(date);
  };

  registerHostGuard(app);
  // FR-11: generate the month's fixed expenses now and on the first request of a new month.
  registerMonthGeneration(app, connection, now);
  registerHealthRoutes(app, connection, { version: packageJson.version, now, system });
  registerAuditRoutes(app, connection);
  registerBackupRoutes(app, backupService);
  registerCategoryRoutes(app, connection);
  registerPaymentRoutes(app, connection);
  registerFixedExpenseTemplateRoutes(app, connection, now);
  registerFixedExpenseRoutes(app, connection, now);
  registerSalesRoutes(app, connection, now);
  registerExpenseRoutes(app, connection, now);
  registerCashWithdrawalRoutes(app, connection, now);
  registerCashClosingRoutes(app, connection, now, afterDayClosed);
  registerContaConversionRoutes(app, connection, now, afterDayClosed);
  registerMonthClosingRoutes(app, connection, now, onMonthClosed);
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
