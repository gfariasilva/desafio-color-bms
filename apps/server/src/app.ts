import fs from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { systemClock, type Clock } from "./clock";
import type { DatabaseConnection } from "./db/client";
import { registerHostGuard } from "./http/host-guard";
import { registerAuditRoutes } from "./modules/audit/audit.routes";
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
import { registerHealthRoutes } from "./modules/health/health.routes";
import { registerSalesRoutes } from "./modules/sales/sales.routes";
import packageJson from "../package.json" with { type: "json" };

export interface BuildAppOptions {
  connection: DatabaseConnection;
  /** Built web app to serve. Skipped when missing (dev uses the Vite server instead). */
  webDistDir?: string;
  logger?: boolean;
  /** The current time (ADR 0002). Tests pass a fixed clock. */
  now?: Clock;
  /**
   * FR-08: called after a day's closing is committed. The pilot backup (#25) and the daily
   * export (#21) hook in here; a no-op until then.
   */
  onDayClosed?: OnDayClosed;
}

/** Creates the Fastify app without listening, so tests can call `app.inject()`. */
export async function buildApp({
  connection,
  webDistDir,
  logger = false,
  now = systemClock,
  onDayClosed = () => {},
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger });

  registerHostGuard(app);
  // FR-11: generate the month's fixed expenses now and on the first request of a new month.
  registerMonthGeneration(app, connection, now);
  registerHealthRoutes(app, connection, packageJson.version);
  registerAuditRoutes(app, connection);
  registerCategoryRoutes(app, connection);
  registerPaymentRoutes(app, connection);
  registerFixedExpenseTemplateRoutes(app, connection, now);
  registerFixedExpenseRoutes(app, connection, now);
  registerSalesRoutes(app, connection, now);
  registerExpenseRoutes(app, connection, now);
  registerCashWithdrawalRoutes(app, connection, now);
  registerCashClosingRoutes(app, connection, now, onDayClosed);
  registerContaConversionRoutes(app, connection, now, onDayClosed);

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
