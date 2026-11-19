import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { systemClock } from "../clock";
import { createDailyLog } from "./log-file";
import { appFiles, dataDirFor, installLayout, readMode } from "./layout";
import { superviseServer } from "./supervisor";

/**
 * #26: started by the Task Scheduler task at logon (hidden, through `conhost --headless`).
 * Runs the server as a child process, writes its output to `<data>\logs\`, and restarts it
 * after a crash (supervisor.ts). The data folder follows `instalacao.json` (trial or real).
 */
const here = path.dirname(fileURLToPath(import.meta.url)); // app\server\dist\pilot
const appDir = path.resolve(here, "..", "..", "..");
const layout = installLayout(path.dirname(appDir));
const mode = readMode(layout);
const dataDir = dataDirFor(layout, mode);
const log = createDailyLog({ dir: path.join(dataDir, "logs"), now: systemClock });

let stopping = false;
let child: ReturnType<typeof spawn> | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
}

log.write(`${systemClock().toISOString()} [launcher] Starting (mode ${mode}, data ${dataDir}).\n`);
const code = await superviseServer({
  spawnServer: () => {
    child = spawn(process.execPath, ["--enable-source-maps", appFiles(appDir).serverMain], {
      cwd: appDir,
      env: {
        ...process.env,
        NODE_ENV: "production",
        COLOR_BMS_DATA_DIR: dataDir,
        COLOR_BMS_TRIAL: mode === "treino" ? "1" : "",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    return child;
  },
  log,
  now: systemClock,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  shouldStop: () => stopping,
});
process.exit(code);
