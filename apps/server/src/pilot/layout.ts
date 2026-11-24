import fs from "node:fs";
import path from "node:path";

/**
 * #26: the pilot installation on the shop PC, under `%LOCALAPPDATA%\ColorBMS\` (ADR 0001, 0004):
 *
 * ```
 * ColorBMS\
 *   app\            the program (replaced by atualizar.cmd)
 *   app.anterior\   the previous program, kept by the last update
 *   data-treino\    trial data (training days before go-live)
 *   data\           real data (created by the go-live reset)
 *   arquivo\        archived trial folders
 *   instalacao.json which data folder is in use: { "mode": "treino" | "real" }
 *   iniciar.cmd, parar.cmd, iniciar-uso-real.cmd, LEIA-ME.txt
 * ```
 *
 * The USB folder (the extracted zip) has the same `app\` + scripts shape, so every script calls
 * `%~dp0app\node\node.exe` wherever it runs from.
 */
export const TASK_NAME = "Color BMS";
export const APP_PORT = 3210;
export const APP_URL = `http://127.0.0.1:${APP_PORT}/`;

/** Copied next to `app\` on install and update; instalar/atualizar run only from the USB stick. */
export const SUPPORT_FILES = ["iniciar.cmd", "parar.cmd", "iniciar-uso-real.cmd", "LEIA-ME.txt"];

export type Mode = "treino" | "real";

export interface InstallLayout {
  root: string;
  appDir: string;
  previousAppDir: string;
  /** Where atualizar.cmd copies the new program before swapping it in. */
  newAppDir: string;
  trialDataDir: string;
  realDataDir: string;
  archiveDir: string;
  settingsFile: string;
  nodeExe: string;
  launcherJs: string;
}

/** The program files inside an `app\` folder. */
export function appFiles(appDir: string, platform: NodeJS.Platform = process.platform) {
  return {
    nodeExe: path.join(appDir, "node", platform === "win32" ? "node.exe" : "node"),
    launcherJs: path.join(appDir, "server", "dist", "pilot", "launcher.js"),
    serverMain: path.join(appDir, "server", "dist", "main.js"),
    packageJson: path.join(appDir, "server", "package.json"),
  };
}

export function installLayout(
  root: string,
  platform: NodeJS.Platform = process.platform,
): InstallLayout {
  const appDir = path.join(root, "app");
  const { nodeExe, launcherJs } = appFiles(appDir, platform);
  return {
    root,
    appDir,
    previousAppDir: path.join(root, "app.anterior"),
    newAppDir: path.join(root, "app.novo"),
    trialDataDir: path.join(root, "data-treino"),
    realDataDir: path.join(root, "data"),
    archiveDir: path.join(root, "arquivo"),
    settingsFile: path.join(root, "instalacao.json"),
    nodeExe,
    launcherJs,
  };
}

/** `%LOCALAPPDATA%\ColorBMS`; `COLOR_BMS_INSTALL_DIR` overrides it (CI smoke test). */
export function defaultInstallRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COLOR_BMS_INSTALL_DIR) return path.resolve(env.COLOR_BMS_INSTALL_DIR);
  if (!env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is not set: is this Windows?");
  return path.join(env.LOCALAPPDATA, "ColorBMS");
}

/**
 * The data folder in use. Without a readable `instalacao.json` (it should always exist), the
 * real folder wins if it exists, so real data is never hidden behind the trial folder.
 */
export function readMode(layout: InstallLayout): Mode {
  try {
    const parsed = JSON.parse(fs.readFileSync(layout.settingsFile, "utf8")) as { mode?: unknown };
    if (parsed.mode === "treino" || parsed.mode === "real") return parsed.mode;
  } catch {
    // Fall through.
  }
  return fs.existsSync(layout.realDataDir) ? "real" : "treino";
}

export function writeMode(layout: InstallLayout, mode: Mode): void {
  fs.writeFileSync(layout.settingsFile, `${JSON.stringify({ mode }, null, 2)}\n`);
}

export function dataDirFor(layout: InstallLayout, mode: Mode): string {
  return mode === "real" ? layout.realDataDir : layout.trialDataDir;
}

/** The version in `app\server\package.json`, or null when there is no app there. */
export function appVersion(appDir: string): string | null {
  try {
    const { version } = JSON.parse(fs.readFileSync(appFiles(appDir).packageJson, "utf8")) as {
      version?: unknown;
    };
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * Compares two `x.y.z` versions: negative when `a` is older than `b`, 0 when equal, positive
 * when newer. Null when either is not `x.y.z` (an unknown version never blocks anything).
 */
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  }
  return 0;
}
