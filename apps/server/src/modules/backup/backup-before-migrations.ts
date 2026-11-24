import { readMigrationFiles } from "drizzle-orm/migrator";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { defaultMigrationsFolder, runMigrations } from "../../db/migrate";
import { writeNewBackup } from "./backup.service";

/**
 * How many migrations in `migrationsFolder` are not applied yet. Drizzle applies, in order,
 * every migration newer than the last one recorded in `__drizzle_migrations`; we count the
 * same way. A brand-new database (no table yet) counts as 0: it has nothing to lose.
 */
export function pendingMigrationCount(
  { sqlite }: DatabaseConnection,
  migrationsFolder: string,
): number {
  const table = sqlite
    .prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
    .get();
  if (!table) return 0;
  const last = sqlite
    .prepare("select max(created_at) as createdAt from __drizzle_migrations")
    .get() as { createdAt: number | null };
  const lastApplied = Number(last.createdAt ?? 0);
  return readMigrationFiles({ migrationsFolder }).filter((m) => m.folderMillis > lastApplied)
    .length;
}

export interface MigrateWithBackupOptions {
  /** The local backups folder (`data\backups\`), always available, unlike OneDrive. */
  backupDir: string;
  now: Clock;
  migrationsFolder?: string;
}

/**
 * #25: applies pending migrations, but first writes a local backup, so a pilot update can always
 * be undone by restoring the copy from before it. If the backup fails, nothing is migrated and
 * the error says why (the server then does not start).
 */
export function migrateWithBackup(
  connection: DatabaseConnection,
  { backupDir, now, migrationsFolder = defaultMigrationsFolder() }: MigrateWithBackupOptions,
): { backupFile: string | null } {
  let backupFile: string | null = null;
  if (pendingMigrationCount(connection, migrationsFolder) > 0) {
    try {
      backupFile = writeNewBackup(connection.sqlite, backupDir, now());
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Backup before migrations failed (${detail}); the migrations were not applied. ` +
          `Check the folder ${backupDir} and start again.`,
        { cause: error },
      );
    }
  }
  runMigrations(connection.db, migrationsFolder);
  return { backupFile };
}
