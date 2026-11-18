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
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveDataDir(env: NodeJS.ProcessEnv): string {
  if (env.COLOR_BMS_DATA_DIR) return path.resolve(env.COLOR_BMS_DATA_DIR);
  if (env.NODE_ENV === "production" && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, "ColorBMS", "data");
  }
  return path.join(serverRoot, ".data"); // development
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = resolveDataDir(env);
  return {
    host: "127.0.0.1",
    port: Number(env.PORT ?? 3210),
    dataDir,
    databaseFile: path.join(dataDir, "color.db"),
    webDistDir: env.COLOR_BMS_WEB_DIST ?? path.resolve(serverRoot, "../web/dist"),
  };
}
