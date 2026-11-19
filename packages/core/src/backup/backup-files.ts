import { z } from "zod";
import { isCivilDate, TIME_ZONE, type CivilDate } from "../time/civil-date";

/**
 * FR-31 (pilot slice, #25): names of the database backup files (spec §7.2).
 *
 * A backup is `color-AAAA-MM-DD_HHMM.db`, with the date and time in São Paulo (RN-15), inside
 * `<pasta do OneDrive>/_backup-sistema/`. The name alone tells when the backup was made, so the
 * server needs no table to know whether today already has one.
 */

export const BACKUP_FOLDER_NAME = "_backup-sistema";

const BACKUP_NAME_PATTERN = /^color-(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})\.db$/;

// "en-CA" gives "YYYY-MM-DD, HH:mm", which we split into the civil date and the time.
const nameFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * The backup file name for an instant, in São Paulo time (spec §7.2).
 *
 * @example backupFileName(new Date("2026-11-18T22:03:00Z")) // "color-2026-11-18_1903.db"
 */
export function backupFileName(now: Date): string {
  const parts: Record<string, string> = {};
  for (const part of nameFormatter.formatToParts(now)) parts[part.type] = part.value;
  return `color-${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}.db`;
}

/** The São Paulo date and time ("HH:mm") of a backup file, or null for any other file. */
export function parseBackupFileName(name: string): { date: CivilDate; time: string } | null {
  const match = BACKUP_NAME_PATTERN.exec(name);
  if (!match) return null;
  const [, date = "", hour = "", minute = ""] = match;
  if (!isCivilDate(date) || Number(hour) > 23 || Number(minute) > 59) return null;
  return { date, time: `${hour}:${minute}` };
}

/** FR-31: true when one of `names` is a backup made on `date` ("first start of the day"). */
export function hasBackupOn(names: readonly string[], date: CivilDate): boolean {
  return names.some((name) => parseBackupFileName(name)?.date === date);
}

/** The newest backup among `names` (other files are ignored), or null when there is none. */
export function latestBackupFile(names: readonly string[]): string | null {
  // The name sorts in time order: color-YYYY-MM-DD_HHMM.db.
  const backups = names.filter((name) => parseBackupFileName(name) !== null).sort();
  return backups.at(-1) ?? null;
}

/** What started a backup: the first start of the day, or a day closing (FR-31). */
export const backupTriggerSchema = z.enum(["startup", "day-close"]);
export type BackupTrigger = z.infer<typeof backupTriggerSchema>;

/** Response of GET /api/backup/status: shown on Início (#25). */
export const backupStatusResponseSchema = z.object({
  /** False when no OneDrive folder is set: no backup is written. */
  configured: z.boolean(),
  /** The `_backup-sistema` folder, when configured. */
  folder: z.string().nullable(),
  /** The newest backup known to the server (ISO-8601 UTC instant and file name). */
  lastSuccess: z.object({ at: z.string(), file: z.string() }).nullable(),
  /** Set only while the latest attempt failed; a later success clears it. Message in pt-BR. */
  lastFailure: z
    .object({ at: z.string(), trigger: backupTriggerSchema, message: z.string() })
    .nullable(),
});

export type BackupStatusResponse = z.infer<typeof backupStatusResponseSchema>;
