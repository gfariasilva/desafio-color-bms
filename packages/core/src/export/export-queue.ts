import { z } from "zod";
import { dailySpreadsheetFileName } from "./export-files";

/**
 * FR-30 / spec §6.1 "ItemFilaExportação": the export queue. Every file the system writes to
 * the OneDrive folder is a queue item, so a failure (the file open in Excel, the folder
 * missing) is kept with its error and retried every 5 minutes and at startup.
 *
 * - `daily_spreadsheet` (FR-28, #21), reference "YYYY-MM-DD";
 * - `monthly_spreadsheet` (FR-29, #28), reference "YYYY-MM";
 * - `db_backup` (FR-31, #22).
 *
 * Status: `pending` (waiting for its first try), `failed` (the last try failed; it is retried),
 * `done` (written, or nothing to write; kept as history).
 */

export const EXPORT_KINDS = ["daily_spreadsheet", "monthly_spreadsheet", "db_backup"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_STATUSES = ["pending", "done", "failed"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** FR-30: minutes between automatic retries of failed items. */
export const EXPORT_RETRY_MINUTES = 5;

/** What went wrong, so the UI can point to the fix (§7.4). */
export const EXPORT_ERROR_CAUSES = [
  /** The file is open in Excel (or locked by OneDrive): close it. */
  "file_in_use",
  /** The OneDrive folder is missing, not a folder or not configured: see Configurações. */
  "folder",
  /** Anything else (disk full, no permission…). */
  "other",
] as const;
export type ExportErrorCause = (typeof EXPORT_ERROR_CAUSES)[number];

/** One item of the queue that still needs attention. */
export const exportQueueItemSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(EXPORT_KINDS),
  /** The date or month the item is about. */
  reference: z.string(),
  status: z.enum(EXPORT_STATUSES),
  attempts: z.number().int(),
  /** The file name the owner knows ("Diária 2026-11-18.xlsx"). */
  fileName: z.string(),
  /** pt-BR message of the last failure; null before the first try. */
  lastError: z.string().nullable(),
  lastErrorCause: z.enum(EXPORT_ERROR_CAUSES).nullable(),
  /** ISO-8601 UTC instants. */
  createdAt: z.string(),
  lastAttemptAt: z.string().nullable(),
});
export type ExportQueueItem = z.infer<typeof exportQueueItemSchema>;

/** Response of GET /api/exports/status and POST /api/exports/retry (FR-30). */
export const exportQueueStatusResponseSchema = z.object({
  /** False in trial mode (#26): nothing is exported, so nothing is pending. */
  enabled: z.boolean(),
  /** Items not done yet (pending or failed), oldest first. */
  items: z.array(exportQueueItemSchema),
  /** FR-27 "Backup pendente": true when any item failed. */
  hasFailures: z.boolean(),
});
export type ExportQueueStatusResponse = z.infer<typeof exportQueueStatusResponseSchema>;

/**
 * The file name the owner sees for a queue item: "Diária 2026-11-18.xlsx",
 * "Mensal 2026-11.xlsx" (#28), or the database backup (#22).
 */
export function exportFileName(kind: ExportKind, reference: string): string {
  switch (kind) {
    case "daily_spreadsheet":
      return dailySpreadsheetFileName(reference);
    case "monthly_spreadsheet":
      return `Mensal ${reference}.xlsx`;
    case "db_backup":
      return "Backup do banco de dados";
  }
}
