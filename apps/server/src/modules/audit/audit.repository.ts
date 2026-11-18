import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import {
  addDays,
  civilDayStartInstant,
  type AuditAction,
  type AuditEntity,
  type AuditEntry,
  type AuditListResponse,
  type AuditQuery,
  type AuditValues,
} from "@color-bms/core";
import type { AppDatabase } from "../../db/client";
import { auditLog } from "../../db/schema";

/**
 * Anything that can run an insert: the Drizzle database itself, or the `tx` handed to a
 * `db.transaction((tx) => …)` callback.
 */
export type DbWriter = Pick<AppDatabase, "insert">;

export interface AuditInput {
  entity: AuditEntity;
  /** Id of the record. Numbers are stored as text, e.g. 42 → "42". */
  entityId: string | number;
  action: AuditAction;
  /** The record before the action (omit on creation). Money fields end in `Cents`. */
  before?: AuditValues | null;
  /** The record after the action (omit on deletion). Money fields end in `Cents`. */
  after?: AuditValues | null;
  reason?: string | null;
}

/**
 * FR-18: writes one audit row. Call it with the `tx` of the business write, so both rows are
 * saved together or not at all (ADR 0001):
 *
 * ```ts
 * db.transaction((tx) => {
 *   tx.update(sales).set({ grossCents: 500 }).where(eq(sales.id, 42)).run();
 *   recordAudit(tx, { entity: "sale", entityId: 42, action: "update",
 *                     before: { grossCents: 5000 }, after: { grossCents: 500 } });
 * });
 * ```
 *
 * Synchronous on purpose: better-sqlite3 transactions must not await anything.
 * `now` is a parameter so tests can control the time.
 */
export function recordAudit(writer: DbWriter, input: AuditInput, now: Date = new Date()): void {
  writer
    .insert(auditLog)
    .values({
      at: now.toISOString(),
      entity: input.entity,
      entityId: String(input.entityId),
      action: input.action,
      beforeJson: input.before ? JSON.stringify(input.before) : null,
      afterJson: input.after ? JSON.stringify(input.after) : null,
      reason: input.reason ?? null,
    })
    .run();
}

type AuditRow = typeof auditLog.$inferSelect;

function toEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    at: row.at,
    // Only recordAudit writes this table, and it only accepts the core enums.
    entity: row.entity as AuditEntity,
    entityId: row.entityId,
    action: row.action as AuditAction,
    before: row.beforeJson ? (JSON.parse(row.beforeJson) as AuditValues) : null,
    after: row.afterJson ? (JSON.parse(row.afterJson) as AuditValues) : null,
    reason: row.reason,
  };
}

/**
 * FR-18: reads the audit log, newest first. `from`/`to` are São Paulo civil dates (RN-15),
 * turned into UTC instants: start(from) <= at < start(to + 1 day). ISO strings from
 * `toISOString()` all have the same shape, so comparing them as text is correct.
 */
export function listAudit(db: AppDatabase, query: AuditQuery): AuditListResponse {
  const conditions: SQL[] = [];
  if (query.from) conditions.push(gte(auditLog.at, civilDayStartInstant(query.from)));
  if (query.to) conditions.push(lt(auditLog.at, civilDayStartInstant(addDays(query.to, 1))));
  if (query.entity) conditions.push(eq(auditLog.entity, query.entity));
  if (query.action) conditions.push(eq(auditLog.action, query.action));
  if (query.beforeId) conditions.push(lt(auditLog.id, query.beforeId));

  // Fetch one extra row to know whether there is another page.
  const rows = db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.id))
    .limit(query.limit + 1)
    .all();

  return {
    entries: rows.slice(0, query.limit).map(toEntry),
    hasMore: rows.length > query.limit,
  };
}
