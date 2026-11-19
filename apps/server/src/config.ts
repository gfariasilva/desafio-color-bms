import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  /** Always 127.0.0.1: the server is reachable only from this PC (NFR-08). */
  host: string;
  port: number;
  /** Folder that holds the live SQLite file. Never inside OneDrive (ADR 0001). */
  dataDir: string;
  databaseFile: string;
  /** Built web app (apps/web/dist). Served when it exists. */
  webDistDir: string;
  /**
   * #25: the OneDrive folder (spec §7.2 `<pasta>`) that receives `_backup-sistema/`, or null
   * when not set. From `COLOR_BMS_ONEDRIVE_DIR`, else `oneDriveFolder` in `<dataDir>/config.json`.
   * Moves into the Settings screen with #20.
   */
  oneDriveFolder: string | null;
  /** #25: local backups made before migrations (`data\backups\`). */
  localBackupDir: string;
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveDataDir(env: NodeJS.ProcessEnv): string {
  if (env.COLOR_BMS_DATA_DIR) return path.resolve(env.COLOR_BMS_DATA_DIR);
  if (env.NODE_ENV === "production" && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, "ColorBMS", "data");
  }
  return path.join(serverRoot, ".data"); // development
}

/**
 * Reads `oneDriveFolder` from `<dataDir>/config.json`. A missing file means "not configured";
 * a broken one is reported with `warn` and ignored, so a typo never stops the shop's system.
 */
function readOneDriveFolder(dataDir: string, warn: (message: string) => void): string | null {
  const file = path.join(dataDir, "config.json");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    warn(`Ignoring ${file}: invalid JSON (${(error as Error).message}).`);
    return null;
  }
  const value = (parsed as { oneDriveFolder?: unknown } | null)?.oneDriveFolder;
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") {
    warn(`Ignoring oneDriveFolder in ${file}: it must be a non-empty text.`);
    return null;
  }
  return value.trim();
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = console.warn,
): AppConfig {
  const dataDir = resolveDataDir(env);
  const fromEnv = env.COLOR_BMS_ONEDRIVE_DIR?.trim();
  return {
    host: "127.0.0.1",
    port: Number(env.PORT ?? 3210),
    dataDir,
    databaseFile: path.join(dataDir, "color.db"),
    webDistDir: env.COLOR_BMS_WEB_DIST ?? path.resolve(serverRoot, "../web/dist"),
    oneDriveFolder: fromEnv ? fromEnv : readOneDriveFolder(dataDir, warn),
    localBackupDir: path.join(dataDir, "backups"),
  };
}
