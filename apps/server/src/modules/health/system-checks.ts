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
  /** The OneDrive folder (spec §7.2 `<pasta>`), or null when not configured. */
  oneDriveFolder: string | null;
  port: number;
  /** Trial mode: the training data folder, never backed up to OneDrive. */
  trial: boolean;
  /** When this version was built (ISO UTC), or null in development. */
  builtAt: string | null;
}

/** Writes and removes a small file: the only sure way to know a folder is writable. */
function probeWritable(dir: string): FolderProbe {
  const file = path.join(dir, `.teste-gravacao-${process.pid}.tmp`);
  try {
    fs.writeFileSync(file, "ok");
    fs.rmSync(file, { force: true });
    return { state: "ok", path: dir };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? (error as Error).message;
    return { state: "not-writable", path: dir, detail: code };
  }
}

function probeDataDir(dir: string): FolderProbe {
  return fs.existsSync(dir) ? probeWritable(dir) : { state: "missing", path: dir };
}

/**
 * Like the backup (#25): never create the OneDrive folder itself (a missing one is a wrong
 * setting), only `_backup-sistema` inside it, which is where the backups are written.
 */
function probeOneDrive(info: SystemInfo): FolderProbe {
  if (info.trial) return { state: "trial" };
  const folder = info.oneDriveFolder;
  if (folder === null) return { state: "not-configured" };
  const stat = fs.statSync(folder, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return { state: "missing", path: folder };
  const backupDir = path.join(folder, BACKUP_FOLDER_NAME);
  try {
    fs.mkdirSync(backupDir, { recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? (error as Error).message;
    return { state: "not-writable", path: folder, detail: code };
  }
  const probe = probeWritable(backupDir);
  // Report the OneDrive folder the owner set, not its _backup-sistema subfolder.
  if (probe.state === "not-writable") return { ...probe, path: folder };
  return { state: "ok", path: folder };
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
    folderCheck("dataFolder", probeDataDir(info.dataDir)),
    folderCheck("oneDriveFolder", probeOneDrive(info)),
  );
  return checks;
}
