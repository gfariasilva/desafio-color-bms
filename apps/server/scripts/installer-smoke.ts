import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { waitForHealth, waitForStop } from "../src/pilot/health-wait";
import { installerFileName } from "../src/pilot/installer";
import { APP_URL, TASK_NAME, installLayout, readMode } from "../src/pilot/layout";
import { check, crashAndRecover, printLogs, refuseOnRealInstall, step } from "./smoke-helpers";

/**
 * #24: end-to-end check of the real Windows installer (`npm run installer:smoke [Setup.exe]`,
 * Windows only; CI `installer-windows`). Uses the real task name and port 3210, in a temp
 * install folder (`/DIR=`):
 *
 * 1. Setup.exe /VERYSILENT on a clean PC → trial mode, logon task, desktop shortcut, answering;
 * 2. crash → restart;
 * 3. Setup.exe again (the update path) → data kept, app.anterior;
 * 4. the go-live reset from the installed folder;
 * 5. uninstall → stopped, task and shortcut gone, every data folder kept;
 * 6. Setup.exe again → still real mode with the same data; then uninstall to clean up.
 */

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-installer-"));
const root = path.join(work, "LocalAppData", "ColorBMS");
const layout = installLayout(root);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let setupRuns = 0;

function runSetup(setupExe: string): void {
  setupRuns += 1;
  // Throws on a non-zero exit code (9 = cli.js instalador failed, see the .iss).
  execFileSync(
    setupExe,
    [
      "/VERYSILENT",
      "/SUPPRESSMSGBOXES",
      "/NORESTART",
      `/DIR=${root}`,
      `/LOG=${path.join(work, `setup-${setupRuns}.log`)}`,
    ],
    { stdio: "inherit" },
  );
}

/** The uninstaller copies itself to %TEMP% and may return before it is done: wait for it. */
async function runUninstaller(): Promise<void> {
  const uninstaller = path.join(root, "unins000.exe");
  check(fs.existsSync(uninstaller), "the uninstaller is in the install folder");
  execFileSync(uninstaller, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"], {
    stdio: "inherit",
  });
  for (let i = 0; i < 120 && (fs.existsSync(uninstaller) || fs.existsSync(layout.appDir)); i++) {
    await sleep(500);
  }
}

function taskExists(): boolean {
  try {
    execFileSync("schtasks.exe", ["/Query", "/TN", TASK_NAME], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function desktopShortcutExists(): boolean {
  const desktop = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"],
    { encoding: "utf8" },
  ).trim();
  return ["Sistema Color.lnk", "Sistema Color.url"].some((name) =>
    fs.existsSync(path.join(desktop, name)),
  );
}

async function health(): Promise<{ version: string; trial: boolean }> {
  return (await (await fetch(new URL("api/health", APP_URL))).json()) as {
    version: string;
    trial: boolean;
  };
}

async function smoke(setupExe: string): Promise<void> {
  const version = (
    JSON.parse(fs.readFileSync(path.join(serverRoot, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  const installerLog = path.join(root, "instalador.log");

  step(`${path.basename(setupExe)} on a clean PC`);
  runSetup(setupExe);
  check((await waitForHealth(APP_URL, { version, timeoutMs: 5_000 })).ok, `answers ${version}`);
  check(readMode(layout) === "treino", "trial mode");
  check((await health()).trial, "the health page says trial");
  check(taskExists(), `the logon task "${TASK_NAME}" exists (FR-34)`);
  check(desktopShortcutExists(), "the desktop shortcut exists (FR-34)");
  check(fs.existsSync(path.join(root, "iniciar.cmd")), "the support scripts are installed");
  check(
    fs.readFileSync(installerLog, "utf8").includes("Instalação concluída"),
    "instalador.log records the install",
  );

  step("crash → restart");
  await crashAndRecover(layout.trialDataDir);

  step("the installer again (update path)");
  runSetup(setupExe);
  check((await waitForHealth(APP_URL, { version, timeoutMs: 5_000 })).ok, "answers again");
  check(fs.existsSync(path.join(layout.trialDataDir, "color.db")), "the data was kept");
  check(fs.existsSync(layout.previousAppDir), "app.anterior kept");

  step("go-live reset (Começar o uso real)");
  execFileSync(
    "cmd.exe",
    ["/c", path.join(root, "iniciar-uso-real.cmd"), "/silencioso", "--confirmar", "--sem-onedrive"],
    { stdio: "inherit", env: { ...process.env, COLOR_BMS_INSTALL_DIR: root } },
  );
  check(readMode(layout) === "real", "real mode");
  const realDb = path.join(layout.realDataDir, "color.db");
  check(fs.existsSync(realDb), "a new real database");

  step("uninstall");
  await runUninstaller();
  check(await waitForStop(APP_URL, 10_000), "the system stopped");
  check(!fs.existsSync(layout.appDir), "app\\ removed");
  check(!taskExists(), "the logon task was deleted");
  check(!desktopShortcutExists(), "the desktop shortcut was deleted");
  check(fs.existsSync(realDb), "data\\ kept");
  check(fs.existsSync(layout.archiveDir), "arquivo\\ (the trial data) kept");
  check(fs.existsSync(layout.settingsFile), "instalacao.json kept");

  step("reinstall after the uninstall");
  runSetup(setupExe);
  check((await waitForHealth(APP_URL, { version, timeoutMs: 5_000 })).ok, "answers");
  check(readMode(layout) === "real", "still real mode");
  check(!(await health()).trial, "the health page says real");

  step("clean up");
  await runUninstaller();
  check(!taskExists(), "no task left on this PC");
}

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("The installer smoke test runs on Windows only (CI installer-windows).");
  }
  const version = (
    JSON.parse(fs.readFileSync(path.join(serverRoot, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  const setupExe = path.resolve(
    process.argv[2] ??
      path.join(serverRoot, "..", "..", "dist-installer", installerFileName(version)),
  );
  try {
    await refuseOnRealInstall();
    await smoke(setupExe);
    console.log("\nInstaller smoke test passed.");
  } catch (error) {
    printLogs(work);
    throw error;
  } finally {
    await sleep(500);
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
