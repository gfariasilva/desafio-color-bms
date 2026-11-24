import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  BACKUP_FOLDER_NAME,
  backupFileInstant,
  backupFileName,
  backupsToDelete,
  hasBackupOn,
  latestBackupFile,
  todayCivilDate,
  type BackupStatusResponse,
} from "@color-bms/core";

/**
 * Writes a consistent copy of the live database into `dir` and returns its path (FR-31, #25).
 * Used for the OneDrive backups, the local backups before migrations, and the safety copy
 * before a restore (FR-32).
 *
 * - `VACUUM INTO` makes a consistent snapshot even while the app is running (ADR 0001); the
 *   live `color.db` file is never copied directly (with WAL it may be incomplete).
 * - Atomic (NFR-06, spec §7.4): the snapshot goes to `<name>.tmp`, is flushed to disk, and only
 *   then renamed to its final name, so a power cut never leaves a half-written backup.
 *
 * Throws on any failure; the caller decides what a failure means.
 */
export function writeBackup(sqlite: Database.Database, dir: string, now: Date): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, backupFileName(now));
  const tempFile = `${file}.tmp`;
  // VACUUM INTO refuses an existing file: remove a temp file left by an earlier crash.
  fs.rmSync(tempFile, { force: true });
  try {
    sqlite.prepare("VACUUM INTO ?").run(tempFile);
    const fd = fs.openSync(tempFile, "r+");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // Two backups in the same minute: the newer snapshot replaces the older one. On Windows,
    // replacing a file that OneDrive is still syncing fails with EPERM/EBUSY: the file is in use.
    try {
      fs.renameSync(tempFile, file);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EBUSY")
        throw Object.assign(error as Error, { code: "EBUSY" });
      throw error;
    }
  } catch (error) {
    fs.rmSync(tempFile, { force: true });
    throw error;
  }
  return file;
}

/**
 * FR-31: writes a backup into `<OneDrive>/_backup-sistema/` and applies the retention policy
 * (RN-13). Called by the export queue (FR-30), which owns every file written to OneDrive and
 * retries a failure. `root` must already be checked as an existing folder; only
 * `_backup-sistema` inside it is created. Throws when the backup fails; a file that cannot be
 * deleted by the retention is only logged (it is tried again after the next backup).
 */
export function writeOneDriveBackup(
  sqlite: Database.Database,
  root: string,
  at: Date,
  log: { error: (message: string) => void },
): { file: string; deleted: string[] } {
  const dir = path.join(root, BACKUP_FOLDER_NAME);
  const file = writeBackup(sqlite, dir, at);
  const deleted: string[] = [];
  for (const name of backupsToDelete(fs.readdirSync(dir), todayCivilDate(at))) {
    try {
      fs.rmSync(path.join(dir, name));
      deleted.push(name);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log.error(`RN-13: could not delete the old backup ${name}: ${detail}`);
    }
  }
  return { file, deleted };
}

/** FR-31: the backup files in `<root>/_backup-sistema/` (empty when it cannot be read). */
export function oneDriveBackupNames(root: string): string[] {
  try {
    return fs.readdirSync(path.join(root, BACKUP_FOLDER_NAME));
  } catch {
    return [];
  }
}

/** FR-31: true when `<root>/_backup-sistema/` already has a backup made today (São Paulo). */
export function hasBackupToday(root: string, now: Date): boolean {
  return hasBackupOn(oneDriveBackupNames(root), todayCivilDate(now));
}

/**
 * GET /api/backup/status (Início, the backup page): whether the backup is configured, the
 * newest file in `_backup-sistema/`, and the result of a restore at the last restart (FR-32).
 */
export function readBackupStatus(
  root: string | null,
  lastRestore: BackupStatusResponse["lastRestore"],
  startId: string,
): BackupStatusResponse {
  if (root === null) {
    return { configured: false, folder: null, lastSuccess: null, lastRestore, startId };
  }
  const latest = latestBackupFile(oneDriveBackupNames(root));
  const at = latest ? backupFileInstant(latest) : null;
  return {
    configured: true,
    folder: path.join(root, BACKUP_FOLDER_NAME),
    lastSuccess: latest && at ? { at, file: latest } : null,
    lastRestore,
    startId,
  };
}
