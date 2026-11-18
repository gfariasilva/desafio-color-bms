import fs from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { DatabaseConnection } from "./db/client";
import { registerHostGuard } from "./http/host-guard";
import { registerAuditRoutes } from "./modules/audit/audit.routes";
import { registerHealthRoutes } from "./modules/health/health.routes";
import packageJson from "../package.json" with { type: "json" };

export interface BuildAppOptions {
  connection: DatabaseConnection;
  /** Built web app to serve. Skipped when missing (dev uses the Vite server instead). */
  webDistDir?: string;
  logger?: boolean;
}

/** Creates the Fastify app without listening, so tests can call `app.inject()`. */
export async function buildApp({
  connection,
  webDistDir,
  logger = false,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger });

  registerHostGuard(app);
  registerHealthRoutes(app, connection, packageJson.version);
  registerAuditRoutes(app, connection);

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
