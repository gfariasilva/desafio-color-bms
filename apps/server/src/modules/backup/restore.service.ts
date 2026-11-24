import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  BACKUP_FOLDER_NAME,
  BACKUP_SOURCE_LABELS,
  backupFileInstant,
  describeBackupFile,
  formatInstant,
  parseBackupFileName,
  type BackupFile,
  type BackupSource,
  type BackupUploadResponse,
  type RestoreRequest,
  type RestoreResult,
} from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { defaultMigrationsFolder } from "../../db/migrate";
import { BusinessError } from "../../http/route-helpers";
import { recordAudit } from "../audit/audit.repository";
import { writeFileAtomic } from "../export/atomic-write";
import { writeNewBackup } from "./backup.service";

/**
 * FR-32: restore a database backup (ADR 0005).
 *
 * 1. The request (`stageRestore`) copies the chosen backup into `<data>/restore/incoming.db`,
 *    checks it, and writes the marker `<data>/restore/pending.json`. The live database is not
 *    touched; the server then restarts (main.ts).
 * 2. At the restart, before the database is opened (`applyPendingRestore`): a safety copy of
 *    the current database goes to `<data>/backups/`, then `incoming.db` replaces `color.db`.
 * 3. Once opened and migrated (`finishRestore`), the restore is written to the audit log of the
 *    restored database, and the marker is removed.
 *
 * The marker says how far it got, so a crash at any point is finished (or undone) at the next
 * start, and a failure never leaves a half-restored database.
 */

const RESTORE_FOLDER = "restore";
const INCOMING_FILE = "incoming.db";
const UPLOAD_FILE = "upload.db";
const UPLOAD_INFO_FILE = "upload.json";
const MARKER_FILE = "pending.json";

/** A table every Color database has (any version): tells our backups from other files. */
const COLOR_TABLES = ["__drizzle_migrations", "audit_log", "settings"];

export const RESTORE_ERRORS = {
  notColor: "Este arquivo não é um backup do sistema Color. Escolha outro arquivo.",
  damaged: "Este backup está danificado. Escolha outro backup.",
  newer:
    "Este backup foi feito por uma versão mais nova do sistema. Atualize o sistema antes de restaurar.",
  busy: "Uma restauração já está em andamento. Aguarde.",
  noUpload: "Escolha o arquivo de backup antes de restaurar.",
  notFound: (name: string) => `Backup não encontrado: ${name}. Atualize a lista.`,
} as const;

/** What `pending.json` holds (FR-32). */
export interface PendingRestore {
  source: BackupSource;
  /** The backup's file name (for an upload, the name of the chosen file). */
  name: string;
  reason: string;
  /** ISO-8601 UTC instant of the request. */
  requestedAt: string;
  /** The safety copy's file name in `<data>/backups/`, once written. */
  safetyCopy: string | null;
  /** True once `incoming.db` has replaced `color.db`. */
  swapped: boolean;
}

export interface RestorePaths {
  dataDir: string;
  /** `<data>/color.db`. */
  databaseFile: string;
  /** `<data>/backups/`: local backups (before migrations) and the safety copies. */
  localBackupDir: string;
}

interface Log {
  info: (message: string) => void;
  error: (message: string) => void;
}

const restoreDir = (dataDir: string) => path.join(dataDir, RESTORE_FOLDER);
const markerFile = (dataDir: string) => path.join(restoreDir(dataDir), MARKER_FILE);

function readMarker(dataDir: string): PendingRestore | null {
  let text: string;
  try {
    text = fs.readFileSync(markerFile(dataDir), "utf8");
  } catch {
    return null;
  }
  return JSON.parse(text) as PendingRestore;
}

function writeMarker(dataDir: string, marker: PendingRestore): void {
  writeFileAtomic(markerFile(dataDir), new TextEncoder().encode(JSON.stringify(marker, null, 2)));
}

/** Removes everything in `<data>/restore/` (the staged files and the marker). */
function clearRestoreFolder(dataDir: string): void {
  const dir = restoreDir(dataDir);
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    fs.rmSync(path.join(dir, name), { force: true, recursive: true });
  }
}

/** The newest migration this version of the app knows (its `folderMillis`). */
function latestKnownMigration(migrationsFolder: string): number {
  return Math.max(0, ...readMigrationFiles({ migrationsFolder }).map((m) => m.folderMillis));
}

/**
 * FR-32: checks that `file` is a Color database this version can open: a valid SQLite file,
 * not damaged, with our tables, and no migration newer than the app's. Throws a BusinessError
 * with a pt-BR message otherwise. Opens the file read-only.
 */
export function inspectBackupFile(file: string, migrationsFolder = defaultMigrationsFolder()) {
  let db: Database.Database;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    throw new BusinessError(400, RESTORE_ERRORS.notColor);
  }
  try {
    let tables: string[];
    try {
      tables = (
        db.prepare("select name from sqlite_master where type = 'table'").all() as {
          name: string;
        }[]
      ).map((row) => row.name);
    } catch {
      // "file is not a database"
      throw new BusinessError(400, RESTORE_ERRORS.notColor);
    }
    if (!COLOR_TABLES.every((table) => tables.includes(table))) {
      throw new BusinessError(400, RESTORE_ERRORS.notColor);
    }
    const check = db.pragma("quick_check", { simple: true });
    if (check !== "ok") throw new BusinessError(400, RESTORE_ERRORS.damaged);
    const { latest } = db
      .prepare("select max(created_at) as latest from __drizzle_migrations")
      .get() as { latest: number | null };
    if (Number(latest ?? 0) > latestKnownMigration(migrationsFolder)) {
      throw new BusinessError(400, RESTORE_ERRORS.newer);
    }
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError(400, RESTORE_ERRORS.damaged);
  } finally {
    db.close();
  }
}

/** The backup files of one folder, as list entries (a missing folder has none). */
function backupsIn(source: "onedrive" | "local", dir: string | null): BackupFile[] {
  if (dir === null) return [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const files: BackupFile[] = [];
  for (const name of names) {
    let size: number;
    try {
      const stat = fs.statSync(path.join(dir, name));
      if (!stat.isFile()) continue;
      size = stat.size;
    } catch {
      continue;
    }
    const entry = describeBackupFile(source, name, size);
    if (entry) files.push(entry);
  }
  return files;
}

export interface RestoreServiceOptions extends Pick<RestorePaths, "dataDir" | "localBackupDir"> {
  /** The OneDrive folder (spec §7.2 `<pasta>`), or null: read at every use. */
  oneDriveFolder: () => string | null;
  now: Clock;
  migrationsFolder?: string;
}

export interface RestoreService {
  /** FR-32: the backups on OneDrive and on this PC, newest first. */
  list(): { oneDriveFolder: string | null; localFolder: string; backups: BackupFile[] };
  /** FR-32 (new PC): keeps a file chosen in the browser, once checked. */
  saveUpload(data: Buffer, name: string): BackupUploadResponse;
  /** FR-32: stages the restore; the caller then restarts the server. */
  stage(request: RestoreRequest): PendingRestore;
  /** True once a restore was staged (the server is about to restart). */
  isStaged(): boolean;
}

export function createRestoreService({
  dataDir,
  localBackupDir,
  oneDriveFolder,
  now,
  migrationsFolder = defaultMigrationsFolder(),
}: RestoreServiceOptions): RestoreService {
  const oneDriveBackupDir = () => {
    const root = oneDriveFolder();
    return root === null ? null : path.join(root, BACKUP_FOLDER_NAME);
  };
  let staged = false;

  /** Copies `from` into the restore folder as `name` and checks it; removes it when bad. */
  function copyAndCheck(from: string | Buffer, name: string): string {
    const dir = restoreDir(dataDir);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    // A local copy first: a OneDrive file may be cloud-only, and it is what gets swapped in.
    if (typeof from === "string") fs.copyFileSync(from, file);
    else writeFileAtomic(file, from);
    try {
      inspectBackupFile(file, migrationsFolder);
    } catch (error) {
      fs.rmSync(file, { force: true });
      throw error;
    }
    return file;
  }

  return {
    list() {
      const oneDrive = oneDriveBackupDir();
      const backups = [...backupsIn("onedrive", oneDrive), ...backupsIn("local", localBackupDir)];
      // Newest first; for the same minute, OneDrive before this PC.
      backups.sort((a, b) =>
        a.at === b.at ? a.source.localeCompare(b.source) * -1 : a.at < b.at ? 1 : -1,
      );
      return { oneDriveFolder: oneDrive, localFolder: localBackupDir, backups };
    },

    saveUpload(data, name) {
      if (staged) throw new BusinessError(409, RESTORE_ERRORS.busy);
      const dir = restoreDir(dataDir);
      fs.rmSync(path.join(dir, UPLOAD_INFO_FILE), { force: true });
      copyAndCheck(data, UPLOAD_FILE);
      const displayName = path.basename(name.replaceAll("\\", "/")) || "backup.db";
      fs.writeFileSync(path.join(dir, UPLOAD_INFO_FILE), JSON.stringify({ name: displayName }));
      return { name: displayName, sizeBytes: data.length, at: backupFileInstant(displayName) };
    },

    stage(request) {
      if (staged) throw new BusinessError(409, RESTORE_ERRORS.busy);
      const dir = restoreDir(dataDir);
      let name: string;
      if (request.source === "upload") {
        const upload = path.join(dir, UPLOAD_FILE);
        const info = path.join(dir, UPLOAD_INFO_FILE);
        if (!fs.existsSync(upload) || !fs.existsSync(info)) {
          throw new BusinessError(400, RESTORE_ERRORS.noUpload);
        }
        name = (JSON.parse(fs.readFileSync(info, "utf8")) as { name: string }).name;
        // Checked again: the file could have been replaced since the upload.
        copyAndCheck(upload, INCOMING_FILE);
        fs.rmSync(upload, { force: true });
        fs.rmSync(info, { force: true });
      } else {
        const folder = request.source === "onedrive" ? oneDriveBackupDir() : localBackupDir;
        // The name was validated as color-AAAA-MM-DD_HHMM.db: never a path.
        const from = folder === null ? null : path.join(folder, request.name);
        if (from === null || !fs.statSync(from, { throwIfNoEntry: false })?.isFile()) {
          throw new BusinessError(404, RESTORE_ERRORS.notFound(request.name));
        }
        copyAndCheck(from, INCOMING_FILE);
        name = request.name;
      }
      const marker: PendingRestore = {
        source: request.source,
        name,
        reason: request.reason,
        requestedAt: now().toISOString(),
        safetyCopy: null,
        swapped: false,
      };
      writeMarker(dataDir, marker);
      staged = true;
      return marker;
    },

    isStaged: () => staged,
  };
}

/**
 * FR-32, at startup, before the database is opened: carries out a staged restore.
 *
 * 1. A safety copy of the current database goes to `<data>/backups/` (never replacing a file);
 * 2. the old database's WAL is folded into it, so its `-wal`/`-shm` files are empty and can be
 *    removed (a WAL replayed onto the restored file would corrupt it);
 * 3. the backup is moved over `color.db`.
 *
 * Returns the marker (null when no restore is pending); `finishRestore` completes it once the
 * database is open. Throws when the restore cannot be done: the database is then untouched.
 * Once the file is moved, nothing throws: the restore is finished at this or the next start.
 */
export function applyPendingRestore({
  dataDir,
  databaseFile,
  localBackupDir,
  now,
  log,
}: RestorePaths & { now: Clock; log: Log }): PendingRestore | null {
  const marker = readMarker(dataDir);
  if (!marker || marker.swapped) return marker;
  const incoming = path.join(restoreDir(dataDir), INCOMING_FILE);
  // Only the move removes `incoming.db` while the marker exists: without it, the move was done
  // and the power went out before the marker was updated.
  if (!fs.existsSync(incoming)) return markSwapped(dataDir, marker, log);

  if (fs.existsSync(databaseFile)) {
    const current = new Database(databaseFile);
    try {
      if (marker.safetyCopy === null) {
        let safetyCopy: string;
        try {
          safetyCopy = writeNewBackup(current, localBackupDir, now());
        } catch (error) {
          throw Object.assign(new Error(`Safety copy failed: ${String(error)}`), {
            safetyCopyFailed: true,
            cause: error,
          });
        }
        marker.safetyCopy = path.basename(safetyCopy);
        writeMarker(dataDir, marker);
        log.info(`Restore: safety copy of the current database at ${safetyCopy}`);
      }
      current.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      current.close();
    }
  }
  // Empty after the checkpoint: removing them can never lose data, even if the move fails.
  fs.rmSync(`${databaseFile}-wal`, { force: true });
  fs.rmSync(`${databaseFile}-shm`, { force: true });
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  fs.renameSync(incoming, databaseFile);
  log.info(`Restore: ${marker.name} is now the database.`);
  return markSwapped(dataDir, marker, log);
}

/** The backup is in place: record it. A failure to write the marker is not a failure. */
function markSwapped(dataDir: string, marker: PendingRestore, log: Log): PendingRestore {
  marker.swapped = true;
  try {
    writeMarker(dataDir, marker);
  } catch (error) {
    log.error(`Restore: could not update the marker (${String(error)}); finishing anyway.`);
  }
  return marker;
}

/**
 * FR-32: the restored backup could not be opened or migrated by this version. The safety copy
 * goes back in place (with no safety copy, a new PC, the empty database is started again), the
 * staged files go, and the failure is reported.
 */
export function rollBackRestore({
  dataDir,
  databaseFile,
  localBackupDir,
  marker,
  error,
  now,
  log,
}: RestorePaths & {
  marker: PendingRestore;
  error: unknown;
  now: Clock;
  log: Log;
}): RestoreResult {
  log.error(`Restore of ${marker.name} failed after the swap: ${String(error)}`);
  fs.rmSync(`${databaseFile}-wal`, { force: true });
  fs.rmSync(`${databaseFile}-shm`, { force: true });
  if (marker.safetyCopy) {
    const temp = `${databaseFile}.tmp`;
    fs.copyFileSync(path.join(localBackupDir, marker.safetyCopy), temp);
    fs.renameSync(temp, databaseFile);
  } else {
    fs.rmSync(databaseFile, { force: true });
  }
  clearRestoreFolder(dataDir);
  return {
    ok: false,
    at: now().toISOString(),
    file: marker.name,
    message: marker.safetyCopy
      ? "Não foi possível preparar o backup escolhido para esta versão do sistema. O banco anterior foi mantido. Avise o desenvolvedor."
      : "Não foi possível preparar o backup escolhido para esta versão do sistema. Avise o desenvolvedor.",
  };
}

/** The pt-BR "Backup de 18/11/2026 19:03" (or the file name when it has no date). */
function backupLabel(name: string): string {
  const at = backupFileInstant(name);
  return at ? `Backup de ${formatInstant(at)}` : `Backup ${name}`;
}

/**
 * FR-32: the last step, with the restored database open and migrated: the restore goes to
 * its audit log (the old database's log is in the safety copy), and the marker is removed.
 */
export function finishRestore(
  { db }: DatabaseConnection,
  marker: PendingRestore,
  dataDir: string,
  now: Clock,
): RestoreResult {
  const at = now();
  const parsed = parseBackupFileName(marker.name);
  recordAudit(
    db,
    {
      entity: "backup",
      entityId: marker.name,
      action: "restore",
      before: marker.safetyCopy ? { safetyCopy: marker.safetyCopy } : null,
      after: {
        file: marker.name,
        backupSource: BACKUP_SOURCE_LABELS[marker.source],
        ...(parsed ? { backupDate: parsed.date, backupTime: parsed.time } : {}),
      },
      reason: marker.reason,
    },
    at,
  );
  clearRestoreFolder(dataDir);
  return {
    ok: true,
    at: at.toISOString(),
    file: marker.name,
    message: `${backupLabel(marker.name)} restaurado.`,
  };
}

/** FR-32: a restore that could not be done: the staged files go, the database is the old one. */
export function abandonRestore(
  dataDir: string,
  error: unknown,
  now: Clock,
  log: Log,
): RestoreResult | null {
  let marker: PendingRestore | null = null;
  try {
    marker = readMarker(dataDir);
  } catch {
    // A broken marker: drop it too.
  }
  clearRestoreFolder(dataDir);
  const detail = error instanceof Error ? error.message : String(error);
  log.error(`Restore failed; the database was not changed: ${detail}`);
  const safetyCopyFailed = (error as { safetyCopyFailed?: boolean } | null)?.safetyCopyFailed;
  return {
    ok: false,
    at: now().toISOString(),
    file: marker?.name ?? "",
    message: safetyCopyFailed
      ? "Não foi possível salvar a cópia de segurança do banco atual. Nada foi alterado. Verifique o espaço em disco e tente de novo."
      : "Não foi possível restaurar o backup. Nada foi alterado. Tente de novo; se continuar, avise o desenvolvedor.",
  };
}
