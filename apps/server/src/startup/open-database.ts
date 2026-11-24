import type { RestoreResult } from "@color-bms/core";
import type { Clock } from "../clock";
import { openDatabase, type DatabaseConnection } from "../db/client";
import { defaultMigrationsFolder, runMigrations } from "../db/migrate";
import { migrateWithBackup } from "../modules/backup/backup-before-migrations";
import {
  abandonRestore,
  applyPendingRestore,
  finishRestore,
  rollBackRestore,
  type PendingRestore,
  type RestorePaths,
} from "../modules/backup/restore.service";

export interface OpenAppDatabaseOptions extends RestorePaths {
  now: Clock;
  log: { info: (message: string) => void; error: (message: string) => void };
  migrationsFolder?: string;
}

export interface OpenAppDatabaseResult {
  connection: DatabaseConnection;
  /** #25: the local backup made before pending migrations, if any. */
  backupFile: string | null;
  /** FR-32: the restore carried out at this start, if one was pending (ok or not). */
  restore: RestoreResult | null;
}

/**
 * Opens the database at startup and after a restore's restart (main.ts, ADR 0005):
 *
 * 1. FR-32: a pending restore puts the chosen backup in place (safety copy first);
 * 2. #25: pending migrations get a local backup first, then are applied. A restored backup
 *    is skipped here: the backup itself is the copy from before its migrations;
 * 3. FR-32: the restore is written to the restored database's audit log.
 *
 * A restore that cannot be done leaves the current database as it was, and says why; one whose
 * backup cannot be migrated puts the safety copy back.
 */
export function openAppDatabase({
  dataDir,
  databaseFile,
  localBackupDir,
  now,
  log,
  migrationsFolder = defaultMigrationsFolder(),
}: OpenAppDatabaseOptions): OpenAppDatabaseResult {
  let pending: PendingRestore | null = null;
  let restore: RestoreResult | null = null;
  try {
    pending = applyPendingRestore({ dataDir, databaseFile, localBackupDir, now, log });
  } catch (error) {
    restore = abandonRestore(dataDir, error, now, log);
  }

  if (pending) {
    let connection: DatabaseConnection | null = null;
    try {
      connection = openDatabase(databaseFile);
      runMigrations(connection.db, migrationsFolder);
      restore = finishRestore(connection, pending, dataDir, now);
      log.info(`Restore of ${pending.name} done.`);
      return { connection, backupFile: null, restore };
    } catch (error) {
      // This version cannot open or migrate the backup: put the previous database back, so
      // the system still starts (never a restart loop on a broken restore).
      connection?.sqlite.close();
      restore = rollBackRestore({
        dataDir,
        databaseFile,
        localBackupDir,
        marker: pending,
        error,
        now,
        log,
      });
    }
  }

  const connection = openDatabase(databaseFile);
  const { backupFile } = migrateWithBackup(connection, {
    backupDir: localBackupDir,
    now,
    migrationsFolder,
  });
  return { connection, backupFile, restore };
}
