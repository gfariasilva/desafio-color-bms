import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { goLive, install, stop, update, type PilotContext } from "../src/pilot/commands";
import { waitForHealth, waitForStop } from "../src/pilot/health-wait";
import { APP_URL, TASK_NAME, installLayout, readMode } from "../src/pilot/layout";
import { packagePilot } from "./package-pilot";

/**
 * #26: end-to-end check of the pilot package (`npm run pilot:smoke`, after `npm run build`).
 *
 * - Windows (CI `pilot-windows`): extracts the zip given as argument (or builds one) and runs
 *   the real .cmd scripts: install, crash → restart, update, go-live reset, stop.
 * - Elsewhere: builds a package for this OS with this Node, and runs the same steps through the
 *   CLI's commands, with Task Scheduler replaced by starting the launcher directly. This proves
 *   the package is complete (node_modules, paths, migrations, web) without Windows.
 *
 * Uses port 3210, like the real installation.
 */

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-smoke-"));
const installRoot = path.join(work, "LocalAppData", "ColorBMS");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function step(message: string): void {
  console.log(`\n▶ ${message}`);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Smoke test failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

function extract(zipFile: string, into: string): string {
  const files = unzipSync(fs.readFileSync(zipFile));
  for (const [name, data] of Object.entries(files)) {
    const target = path.join(into, ...name.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
  const top = Object.keys(files)[0]!.split("/")[0]!;
  const dir = path.join(into, top);
  for (const exe of ["node", "node.exe"]) {
    const file = path.join(dir, "app", "node", exe);
    if (fs.existsSync(file)) fs.chmodSync(file, 0o755);
  }
  return dir;
}

function logText(dataDir: string): string {
  const logs = path.join(dataDir, "logs");
  if (!fs.existsSync(logs)) return "";
  return fs
    .readdirSync(logs)
    .map((name) => fs.readFileSync(path.join(logs, name), "utf8"))
    .join("");
}

/** Kills the server (not the launcher), like a crash, and checks it comes back. */
async function crashAndRecover(dataDir: string): Promise<void> {
  const pids = [...logText(dataDir).matchAll(/Server started \(pid (\d+)\)/g)];
  const pid = Number(pids.at(-1)?.[1]);
  check(pid > 0, `the log names the server's pid (${pid})`);
  process.kill(pid, "SIGKILL");
  await waitForStop(APP_URL, 10_000);
  const back = await waitForHealth(APP_URL, { timeoutMs: 30_000 });
  check(back.ok, "the server is restarted after a crash");
  check(
    /Server stopped \((signal SIGKILL|exit code 1)\); restarting/.test(logText(dataDir)),
    "the crash is in the log",
  );
}

async function smokeWindows(zipFile: string): Promise<void> {
  const usb = extract(zipFile, path.join(work, "usb"));
  const run = (script: string, ...args: string[]) =>
    execFileSync("cmd.exe", ["/c", path.join(usb, script), "/silencioso", ...args], {
      stdio: "inherit",
      env: { ...process.env, COLOR_BMS_INSTALL_DIR: installRoot },
    });
  const layout = installLayout(installRoot);

  step("instalar.cmd");
  run("instalar.cmd");
  check((await waitForHealth(APP_URL, { timeoutMs: 5_000 })).ok, "the system answers");
  check(readMode(layout) === "treino", "trial mode");

  step("crash → restart");
  await crashAndRecover(layout.trialDataDir);

  step("atualizar.cmd");
  run("atualizar.cmd");
  check(fs.existsSync(path.join(layout.trialDataDir, "color.db")), "the data was kept");
  check(fs.existsSync(layout.previousAppDir), "app.anterior kept");

  step("iniciar-uso-real.cmd");
  run("iniciar-uso-real.cmd", "--confirmar", "--sem-onedrive");
  check(readMode(layout) === "real", "real mode");
  check(fs.existsSync(path.join(layout.realDataDir, "color.db")), "a new real database");

  step("parar.cmd");
  run("parar.cmd");
  check(await waitForStop(APP_URL, 10_000), "the system stopped");
}

async function smokeElsewhere(): Promise<void> {
  step("package for this OS");
  const platform = `${process.platform}-${process.arch}`;
  const zipFile = await packagePilot({
    platform,
    node: process.execPath,
    out: path.join(work, "out"),
  });
  const usb = extract(zipFile, path.join(work, "usb"));
  const layout = installLayout(installRoot);
  let launcher: ChildProcess | undefined;

  const ctx: PilotContext = {
    layout,
    packageDir: usb,
    windows: {
      currentUser: () => "smoke",
      registerTask: () => {},
      createShortcut: () => "(no shortcut)",
      openBrowser: () => {},
      // Task Scheduler's job: start the installed launcher with the installed Node.
      runTask: () => {
        launcher = spawn(layout.nodeExe, [layout.launcherJs], { stdio: "ignore" });
      },
      endTask: () => {},
      stopProcesses: () => {
        launcher?.kill("SIGTERM");
      },
    },
    waitForHealth: (options) => waitForHealth(APP_URL, options),
    waitForStop: (timeoutMs) => waitForStop(APP_URL, timeoutMs),
    prompt: async () => "",
    print: (line) => console.log(`  ${line}`),
    now: () => new Date(),
    silent: true,
    env: {},
  };

  try {
    step("install");
    check((await install(ctx)) === 0, "installed and answering with the package's version");
    const health = (await (await fetch(new URL("api/health", APP_URL))).json()) as {
      trial: boolean;
      checks: { id: string; status: string }[];
    };
    check(health.trial, "the health page says trial");
    check(
      health.checks.find((c) => c.id === "dataFolder")?.status === "ok",
      "the data folder is writable",
    );
    const page = await fetch(APP_URL);
    check(page.ok && (await page.text()).includes('<div id="root">'), "Início is served");

    step("crash → restart");
    await crashAndRecover(layout.trialDataDir);

    step("update");
    check((await update(ctx)) === 0, "updated");
    check(fs.existsSync(path.join(layout.trialDataDir, "color.db")), "the data was kept");

    step("go-live reset");
    check((await goLive(ctx, { confirmed: true, oneDriveFolder: null })) === 0, "went live");
    check(fs.existsSync(path.join(layout.realDataDir, "color.db")), "a new real database");

    step("stop");
    check((await stop(ctx)) === 0, "stopped");
  } finally {
    launcher?.kill("SIGKILL");
  }
}

/** On failure, the server logs are the evidence (CI shows the job's output). */
function printLogs(): void {
  for (const entry of fs.readdirSync(work, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".log")) {
      const file = path.join(entry.parentPath, entry.name);
      console.error(`\n----- ${file}\n${fs.readFileSync(file, "utf8")}`);
    }
  }
}

/**
 * Never touch a real installation: the smoke test uses the real task name and port 3210, so a
 * running app would answer in its place (a false pass), and `instalar.cmd /F` would point the
 * real task at a temp folder that is deleted at the end.
 */
async function refuseOnRealInstall(): Promise<void> {
  if ((await waitForHealth(APP_URL, { timeoutMs: 1_000 })).ok) {
    throw new Error(`Something already answers on ${APP_URL}: stop it before the smoke test.`);
  }
  if (process.platform === "win32") {
    try {
      execFileSync("schtasks.exe", ["/Query", "/TN", TASK_NAME], { stdio: "ignore" });
    } catch {
      return; // No such task: safe.
    }
    throw new Error(
      `The task "${TASK_NAME}" exists on this PC: run the smoke test elsewhere (CI).`,
    );
  }
}

async function main(): Promise<void> {
  try {
    await refuseOnRealInstall();
    if (process.platform === "win32") {
      const zipFile =
        process.argv[2] ??
        (await packagePilot({
          platform: "win32-x64",
          out: path.join(serverRoot, "..", "..", "dist-pilot"),
        }));
      await smokeWindows(path.resolve(zipFile));
    } else {
      await smokeElsewhere();
    }
    console.log("\nPilot smoke test passed.");
  } catch (error) {
    printLogs();
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
