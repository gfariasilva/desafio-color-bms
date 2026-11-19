import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  BACKUP_FOLDER_NAME,
  clockCheck,
  folderCheck,
  portCheck,
  timeZoneCheck,
  type FolderProbe,
  type StartupCheck,
} from "@color-bms/core";

/** #26: what the server knows about where it runs; given by main.ts (absent in unit tests). */
export interface SystemInfo {
  dataDir: string;
  /**
   * The OneDrive folder (spec §7.2 `<pasta>`), or null when not configured. A function is read
   * at every check, so a change in Configurações (FR-33, #20) shows at once.
   */
  oneDriveFolder: string | null | (() => string | null);
  port: number;
  /** Trial mode: the training data folder, never backed up to OneDrive. */
  trial: boolean;
  /** When this version was built (ISO UTC), or null in development. */
  builtAt: string | null;
}

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? (error as Error).message;
}

/**
 * Whether a folder exists and may be written, without writing anything: this runs on every
 * GET /api/health, and a probe file inside OneDrive would be synced (or held by the OneDrive
 * client and fail to delete). The backup itself reports real write failures (#25). Never
 * throws: one check must never break the health page.
 */
function probeFolder(dir: string, reportPath = dir): FolderProbe {
  try {
    const stat = fs.statSync(dir, { throwIfNoEntry: false });
    if (!stat) return { state: "missing", path: reportPath };
    if (!stat.isDirectory()) return { state: "not-writable", path: reportPath, detail: "ENOTDIR" };
    fs.accessSync(dir, fs.constants.W_OK);
    return { state: "ok", path: reportPath };
  } catch (error) {
    return { state: "not-writable", path: reportPath, detail: errorCode(error) };
  }
}

/**
 * Like the backup (#25): the OneDrive folder itself must exist (a missing one is a wrong
 * setting). Backups go to its `_backup-sistema`, which the backup creates when missing; when it
 * already exists, that is the folder to check.
 */
function probeOneDrive(info: SystemInfo): FolderProbe {
  if (info.trial) return { state: "trial" };
  const folder =
    typeof info.oneDriveFolder === "function" ? info.oneDriveFolder() : info.oneDriveFolder;
  if (folder === null) return { state: "not-configured" };
  const root = probeFolder(folder);
  if (root.state !== "ok") return root;
  const backupDir = path.join(folder, BACKUP_FOLDER_NAME);
  return fs.existsSync(backupDir) ? probeFolder(backupDir, folder) : root;
}

/**
 * #26: the startup checks. The clock ones always run; the port and folder ones need
 * `SystemInfo`. Cheap enough to run on every GET /api/health, so Início is always current.
 */
export function runSystemChecks(
  sqlite: Database.Database,
  now: Date,
  info: SystemInfo | undefined,
): StartupCheck[] {
  const latestRecordedAt = sqlite.prepare("select max(at) from audit_log").pluck().get() as
    string | null;
  const checks: StartupCheck[] = [
    timeZoneCheck({
      now,
      systemTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      // getTimezoneOffset() is minutes *west* of UTC; the check wants minutes east.
      systemOffsetMinutes: -now.getTimezoneOffset(),
    }),
    clockCheck({ now, latestRecordedAt, builtAt: info?.builtAt ?? null }),
  ];
  if (!info) return checks;
  checks.push(
    portCheck(info.port),
    folderCheck("dataFolder", probeFolder(info.dataDir)),
    folderCheck("oneDriveFolder", probeOneDrive(info)),
  );
  return checks;
}
