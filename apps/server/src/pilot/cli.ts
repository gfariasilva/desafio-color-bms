import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { systemClock } from "../clock";
import { COMMANDS, logToFile, parseCliArgs } from "./cli-args";
import {
  goLive,
  install,
  installOrUpdate,
  start,
  stop,
  uninstall,
  update,
  type PilotContext,
} from "./commands";
import { waitForHealth, waitForStop } from "./health-wait";
import { APP_URL, defaultInstallRoot, installLayout } from "./layout";
import { windowsOps } from "./windows";

/**
 * #26, #24: the logic of the pilot scripts and of the Windows installer. Each `.cmd` (and
 * Setup.exe) only runs `app\node\node.exe` with this file and a command, so all the logic (and
 * every pt-BR message) lives here, in tested TypeScript.
 *
 *   cli.js instalar | atualizar | iniciar | parar | iniciar-uso-real | instalador | desinstalar
 *          [/silencioso] [--raiz=<pasta>] [--registro=<arquivo>]
 *          [--confirmar] [--pasta-onedrive=<pasta>|--sem-onedrive] [--permitir-versao-anterior]
 */
async function main(argv: string[]): Promise<number> {
  const args = parseCliArgs(argv);
  if (!args) {
    console.error(`Uso: cli.js ${COMMANDS.join(" | ")} [/silencioso]`);
    return 2;
  }
  const print = logToFile((line) => console.log(line), args.logFile);
  // One header per run in the log only (the log keeps every install and update).
  logToFile(() => {}, args.logFile)(`===== ${systemClock().toISOString()} cli.js ${args.command}`);

  // This file is app\server\dist\pilot\cli.js; the scripts sit next to app\.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packageDir = path.resolve(here, "..", "..", "..", "..");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ctx: PilotContext = {
    layout: installLayout(args.root ? path.resolve(args.root) : defaultInstallRoot()),
    packageDir,
    windows: windowsOps,
    waitForHealth: (options) => waitForHealth(APP_URL, options),
    waitForStop: (timeoutMs) => waitForStop(APP_URL, timeoutMs),
    // Silent mode (CI) never waits for an answer: a missing flag fails at once.
    prompt: (question) =>
      args.silent
        ? Promise.reject(
            new Error(
              `modo silencioso sem resposta para "${question.trim()}": ` +
                "use --confirmar e --pasta-onedrive=<pasta> ou --sem-onedrive",
            ),
          )
        : rl.question(question),
    print,
    now: systemClock,
    silent: args.silent,
    env: { OneDrive: process.env.OneDrive, SystemRoot: process.env.SystemRoot },
  };
  try {
    switch (args.command) {
      case "instalar":
        return await install(ctx);
      case "atualizar":
        return await update(ctx);
      case "iniciar":
        return await start(ctx);
      case "parar":
        return await stop(ctx);
      case "iniciar-uso-real":
        return await goLive(ctx, {
          confirmed: args.confirmed || undefined,
          oneDriveFolder: args.oneDriveFolder,
        });
      case "instalador":
        return await installOrUpdate(ctx, { allowDowngrade: args.allowDowngrade });
      case "desinstalar":
        return await uninstall(ctx);
    }
  } catch (error) {
    print(`ERRO inesperado: ${error instanceof Error ? (error.stack ?? error.message) : error}`);
    return 1;
  } finally {
    rl.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("ERRO inesperado:", error);
    process.exit(1);
  },
);
