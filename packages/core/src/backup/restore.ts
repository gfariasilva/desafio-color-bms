import { z } from "zod";
import { civilDayStartInstant, type CivilDate } from "../time/civil-date";
import { parseBackupFileName } from "./backup-files";

/**
 * FR-32: restore a database backup. The owner picks a backup from the list (the OneDrive
 * `_backup-sistema/` folder, or this PC's `data\backups\`: the copies made before updates and
 * before each restore), or a file from the computer (a new PC), confirms and gives a reason.
 */

/** Where a backup comes from. `upload`: a file chosen in the browser (new PC, FR-32). */
export const BACKUP_SOURCES = ["onedrive", "local", "upload"] as const;
export type BackupSource = (typeof BACKUP_SOURCES)[number];

/** pt-BR labels of the sources, for the list and the audit log. */
export const BACKUP_SOURCE_LABELS: Record<BackupSource, string> = {
  onedrive: "OneDrive",
  local: "Este PC",
  upload: "Arquivo escolhido",
};

export const BACKUP_RESTORE_REASON_MAX = 200;

/** The largest file accepted by "Restaurar de um arquivo" (bytes). */
export const BACKUP_UPLOAD_MAX_BYTES = 512 * 1024 * 1024;

export const RESTORE_TEXTS = {
  reasonRequired: "Informe o motivo da restauração.",
  badName: "Backup inválido. Escolha um backup da lista.",
} as const;

const reasonField = z
  .string({ message: RESTORE_TEXTS.reasonRequired })
  .trim()
  .min(1, RESTORE_TEXTS.reasonRequired)
  .max(BACKUP_RESTORE_REASON_MAX, `O motivo pode ter até ${BACKUP_RESTORE_REASON_MAX} caracteres.`);

const backupNameField = z
  .string({ message: RESTORE_TEXTS.badName })
  .refine((name) => parseBackupFileName(name) !== null, { message: RESTORE_TEXTS.badName });

/** Body of POST /api/backup/restore (spec §2: confirmation + reason). */
export const restoreRequestSchema = z.discriminatedUnion(
  "source",
  [
    z.object({
      source: z.enum(["onedrive", "local"]),
      /** A file name from the list (never a path). */
      name: backupNameField,
      reason: reasonField,
    }),
    // The file uploaded just before with PUT /api/backup/upload.
    z.object({ source: z.literal("upload"), reason: reasonField }),
  ],
  { errorMap: () => ({ message: "Escolha um backup." }) },
);
export type RestoreRequest = z.infer<typeof restoreRequestSchema>;

/** One backup in the list (FR-32: "a lista de backups disponíveis (data e hora)"). */
export const backupFileSchema = z.object({
  source: z.enum(["onedrive", "local"]),
  name: z.string(),
  /** The São Paulo date and time ("HH:mm") in the file name. */
  date: z.string(),
  time: z.string(),
  /** The same moment as an ISO-8601 UTC instant. */
  at: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});
export type BackupFile = z.infer<typeof backupFileSchema>;

/** Response of GET /api/backup/files: newest first. */
export const backupListResponseSchema = z.object({
  /** The OneDrive `_backup-sistema` folder; null when not configured (or trial mode). */
  oneDriveFolder: z.string().nullable(),
  /** This PC's `data\backups` folder. */
  localFolder: z.string(),
  backups: z.array(backupFileSchema),
});
export type BackupListResponse = z.infer<typeof backupListResponseSchema>;

/** Response of PUT /api/backup/upload: the file was checked and is ready to restore. */
export const backupUploadResponseSchema = z.object({
  name: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** The backup's moment, when the file name tells it (color-AAAA-MM-DD_HHMM.db). */
  at: z.string().nullable(),
});
export type BackupUploadResponse = z.infer<typeof backupUploadResponseSchema>;

/** Response of POST /api/backup/restore: the system restarts now. */
export const restoreResponseSchema = z.object({
  restarting: z.literal(true),
  /** The `startId` of the server that is stopping (GET /api/backup/status). */
  startId: z.string(),
});
export type RestoreResponse = z.infer<typeof restoreResponseSchema>;

/** The result of the last restore, after the restart (shown on the backup page). */
export const restoreResultSchema = z.object({
  ok: z.boolean(),
  /** ISO-8601 UTC instant of the restart. */
  at: z.string(),
  /** The restored file's name. */
  file: z.string(),
  /** pt-BR: what happened. */
  message: z.string(),
});
export type RestoreResult = z.infer<typeof restoreResultSchema>;

/** The UTC instant of a backup file name (São Paulo date and time), or null. */
export function backupFileInstant(name: string): string | null {
  const parsed = parseBackupFileName(name);
  if (!parsed) return null;
  const [hours, minutes] = parsed.time.split(":").map(Number) as [number, number];
  const start = Date.parse(civilDayStartInstant(parsed.date));
  return new Date(start + (hours * 60 + minutes) * 60_000).toISOString();
}

/** FR-32: one list entry for a backup file, or null when `name` is not a backup. */
export function describeBackupFile(
  source: "onedrive" | "local",
  name: string,
  sizeBytes: number,
): BackupFile | null {
  const parsed = parseBackupFileName(name);
  const at = backupFileInstant(name);
  if (!parsed || !at) return null;
  return { source, name, date: parsed.date as CivilDate, time: parsed.time, at, sizeBytes };
}
