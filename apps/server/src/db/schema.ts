import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Key/value application settings (spec §6.1 "Configuração", FR-33).
 * Example keys (added by later features): OneDrive folder, cash-difference alert limit.
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  /** ISO-8601 UTC instant of the last change. */
  updatedAt: text("updated_at").notNull(),
});

/**
 * Audit log (spec §6.1 "RegistroAuditoria", FR-18). Insert-only: the API has no route to
 * edit or delete rows. Every business write adds its row in the same transaction
 * (see `recordAudit` in src/modules/audit/audit.repository.ts).
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** ISO-8601 UTC instant of the action. */
    at: text("at").notNull(),
    /** One of AUDIT_ENTITIES from @color-bms/core, e.g. "sale". */
    entity: text("entity").notNull(),
    /** Text so it also fits a day ("2026-11-18"), a month ("2026-11") or a setting key. */
    entityId: text("entity_id").notNull(),
    /** One of AUDIT_ACTIONS from @color-bms/core, e.g. "update". */
    action: text("action").notNull(),
    /** JSON object with the record before the action; null on creation. Money in cents. */
    beforeJson: text("before_json"),
    /** JSON object with the record after the action; null on deletion. Money in cents. */
    afterJson: text("after_json"),
    reason: text("reason"),
  },
  (table) => [
    index("audit_log_at_idx").on(table.at),
    index("audit_log_entity_at_idx").on(table.entity, table.at),
  ],
);
