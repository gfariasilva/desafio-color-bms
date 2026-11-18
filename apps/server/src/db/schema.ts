import { sqliteTable, text } from "drizzle-orm/sqlite-core";

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
