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
   * `COLOR_BMS_ONEDRIVE_DIR`, or null. Overrides the OneDrive folder set in Configurações
   * (FR-33, #20); used in development and E2E tests only, never on the shop PC.
   */
  envOneDriveFolder: string | null;
  /**
   * #25: `oneDriveFolder` from `<dataDir>/config.json`, or null. Since #20 the folder lives in
   * the settings table; this is only imported once, when the table has no folder yet.
   */
  legacyOneDriveFolder: string | null;
  /** #25: local backups made before migrations (`data\backups\`). */
  localBackupDir: string;
  /**
   * #26: trial mode (training days before go-live), set by the pilot launcher with
   * `COLOR_BMS_TRIAL=1`. Trial data never goes to OneDrive: no backup, whatever the folder.
   */
  trial: boolean;
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
    // Windows tools (PowerShell 5, older Notepad) may save UTF-8 with a byte-order mark.
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
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
  const trial = env.COLOR_BMS_TRIAL === "1";
  return {
    host: "127.0.0.1",
    port: Number(env.PORT ?? 3210),
    dataDir,
    databaseFile: path.join(dataDir, "color.db"),
    webDistDir: env.COLOR_BMS_WEB_DIST ?? path.resolve(serverRoot, "../web/dist"),
    envOneDriveFolder: fromEnv ? fromEnv : null,
    legacyOneDriveFolder: readOneDriveFolder(dataDir, warn),
    localBackupDir: path.join(dataDir, "backups"),
    trial,
  };
}
