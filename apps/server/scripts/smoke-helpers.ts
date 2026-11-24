import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { waitForHealth, waitForStop } from "../src/pilot/health-wait";
import { APP_URL, TASK_NAME } from "../src/pilot/layout";

/** #26, #24: shared by the pilot smoke test and the installer smoke test. */

export function step(message: string): void {
  console.log(`\n▶ ${message}`);
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Smoke test failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

export function logText(dataDir: string): string {
  const logs = path.join(dataDir, "logs");
  if (!fs.existsSync(logs)) return "";
  return fs
    .readdirSync(logs)
    .map((name) => fs.readFileSync(path.join(logs, name), "utf8"))
    .join("");
}

/** Kills the server (not the launcher), like a crash, and checks it comes back. */
export async function crashAndRecover(dataDir: string): Promise<void> {
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

/** On failure, the server logs are the evidence (CI shows the job's output). */
export function printLogs(work: string): void {
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
export async function refuseOnRealInstall(): Promise<void> {
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
