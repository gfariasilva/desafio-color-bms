import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  BACKUP_FOLDER_NAME,
  backupFileName,
  civilDayStartInstant,
  hasBackupOn,
  latestBackupFile,
  parseBackupFileName,
  todayCivilDate,
  type BackupStatusResponse,
  type BackupTrigger,
} from "@color-bms/core";
import type { Clock } from "../../clock";

/**
 * Writes a consistent copy of the live database into `dir` and returns its path (FR-31, #25).
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
    // Two backups in the same minute: the newer snapshot replaces the older one.
    fs.renameSync(tempFile, file);
  } catch (error) {
    fs.rmSync(tempFile, { force: true });
    throw error;
  }
  return file;
}

export interface BackupLog {
  info: (message: string) => void;
  error: (message: string) => void;
}

export interface BackupService {
  /** FR-31: backs up now. Never throws: a failure is logged and kept in `status()`. */
  run(trigger: BackupTrigger): Promise<void>;
  /** FR-31: at startup, backs up only when the folder has no backup of today yet. */
  runOnStartupIfFirstToday(): Promise<void>;
  status(): BackupStatusResponse;
}

export interface BackupServiceOptions {
  sqlite: Database.Database;
  /** The OneDrive folder (spec §7.2 `<pasta>`), or null when not configured. */
  folder: string | null;
  now: Clock;
  log: BackupLog;
}

/** The instant (UTC ISO) of a backup file, from the São Paulo date and time in its name. */
function backupInstant(name: string): string {
  const parsed = parseBackupFileName(name);
  if (!parsed) throw new RangeError(`Not a backup file name: "${name}"`);
  const [hours, minutes] = parsed.time.split(":").map(Number) as [number, number];
  const start = Date.parse(civilDayStartInstant(parsed.date));
  return new Date(start + (hours * 60 + minutes) * 60_000).toISOString();
}

/** A pt-BR message the owner can act on (shown on Início). */
function failureMessage(error: unknown, folder: string, backupDir: string): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ROOT_MISSING") return `A pasta do OneDrive não existe: ${folder}`;
  if (code === "EACCES" || code === "EPERM") return `Sem permissão para gravar em ${backupDir}`;
  if (code === "EBUSY") return `O arquivo de backup está em uso em ${backupDir}`;
  if (code === "ENOSPC") return "Disco cheio: não há espaço para gravar o backup";
  const detail = error instanceof Error ? error.message : String(error);
  return `Não foi possível gravar o backup em ${backupDir} (${detail})`;
}

/**
 * The pilot backup to the OneDrive folder (#25, slice of FR-31). It runs after each day closing
 * and on the first start of the day. The status lives in memory: a failure is shown on Início
 * until a later backup succeeds; after a restart, the startup backup retries whenever today
 * has no backup yet. Retention (RN-13) and the retry queue (FR-30) come with #22.
 */
export function createBackupService({
  sqlite,
  folder,
  now,
  log,
}: BackupServiceOptions): BackupService {
  const backupDir = folder === null ? null : path.join(folder, BACKUP_FOLDER_NAME);
  let lastSuccess: BackupStatusResponse["lastSuccess"] = null;
  let lastFailure: BackupStatusResponse["lastFailure"] = null;

  /** Backup files already in the folder (empty when it cannot be read). */
  function existingNames(): string[] {
    if (backupDir === null) return [];
    try {
      return fs.readdirSync(backupDir);
    } catch {
      return [];
    }
  }

  async function run(trigger: BackupTrigger): Promise<void> {
    if (folder === null || backupDir === null) return; // Not configured: shown on Início.
    const at = now();
    try {
      // Never create the OneDrive folder itself: a missing one means a wrong setting, or
      // OneDrive not set up (spec §7.4). Only `_backup-sistema` inside it is created.
      if (!fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
        throw Object.assign(new Error(`Folder not found: ${folder}`), { code: "ROOT_MISSING" });
      }
      const file = writeBackup(sqlite, backupDir, at);
      lastSuccess = { at: at.toISOString(), file: path.basename(file) };
      lastFailure = null;
      log.info(`Backup (${trigger}) written to ${file}`);
    } catch (error) {
      lastFailure = {
        at: at.toISOString(),
        trigger,
        message: failureMessage(error, folder, backupDir),
      };
      const detail = error instanceof Error ? error.message : String(error);
      log.error(`Backup (${trigger}) failed: ${detail}`);
    }
  }

  async function runOnStartupIfFirstToday(): Promise<void> {
    const names = existingNames();
    const latest = latestBackupFile(names);
    if (latest) lastSuccess = { at: backupInstant(latest), file: latest };
    if (hasBackupOn(names, todayCivilDate(now()))) return;
    await run("startup");
  }

  return {
    run,
    runOnStartupIfFirstToday,
    status: () => ({ configured: backupDir !== null, folder: backupDir, lastSuccess, lastFailure }),
  };
}
