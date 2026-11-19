import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { systemClock } from "../clock";
import { goLive, install, start, stop, update, type PilotContext } from "./commands";
import { waitForHealth, waitForStop } from "./health-wait";
import { APP_URL, defaultInstallRoot, installLayout } from "./layout";
import { windowsOps } from "./windows";

/**
 * #26: the pilot scripts' logic. Each `.cmd` only runs `app\node\node.exe` with this file and
 * a command, so all the logic (and every pt-BR message) lives here, in tested TypeScript.
 *
 *   cli.js instalar | atualizar | iniciar | parar | iniciar-uso-real
 *          [/silencioso] [--confirmar] [--pasta-onedrive=<pasta>|--sem-onedrive]
 */
const COMMANDS = ["instalar", "atualizar", "iniciar", "parar", "iniciar-uso-real"] as const;
type Command = (typeof COMMANDS)[number];

async function main(argv: string[]): Promise<number> {
  const command = argv[0] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) {
    console.error(`Uso: cli.js ${COMMANDS.join(" | ")} [/silencioso]`);
    return 2;
  }
  const flags = argv.slice(1);
  const silent = flags.some((flag) => flag.toLowerCase() === "/silencioso");
  const folderFlag = flags.find((flag) => flag.startsWith("--pasta-onedrive="));

  // This file is app\server\dist\pilot\cli.js; the scripts sit next to app\.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packageDir = path.resolve(here, "..", "..", "..", "..");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ctx: PilotContext = {
    layout: installLayout(defaultInstallRoot()),
    packageDir,
    windows: windowsOps,
    waitForHealth: (options) => waitForHealth(APP_URL, options),
    waitForStop: (timeoutMs) => waitForStop(APP_URL, timeoutMs),
    prompt: (question) => rl.question(question),
    print: (line) => console.log(line),
    now: systemClock,
    silent,
    env: { OneDrive: process.env.OneDrive, SystemRoot: process.env.SystemRoot },
  };
  try {
    switch (command) {
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
          confirmed: flags.includes("--confirmar") || undefined,
          oneDriveFolder: folderFlag
            ? folderFlag.slice("--pasta-onedrive=".length)
            : flags.includes("--sem-onedrive")
              ? null
              : undefined,
        });
    }
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
