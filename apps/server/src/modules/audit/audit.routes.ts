import type { FastifyInstance } from "fastify";
import { auditQuerySchema, type AuditListResponse } from "@color-bms/core";
import type { DatabaseConnection } from "../../db/client";
import { listAudit } from "./audit.repository";

/**
 * GET /api/audit: read-only audit log (FR-18).
 * There is deliberately no PUT/PATCH/DELETE: audit rows cannot be edited or deleted.
 */
export function registerAuditRoutes(app: FastifyInstance, { db }: DatabaseConnection): void {
  app.get("/api/audit", async (request, reply): Promise<AuditListResponse | void> => {
    const parsed = auditQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Filtro inválido.";
      return reply.code(400).send({ error: message });
    }
    return listAudit(db, parsed.data);
  });
}
