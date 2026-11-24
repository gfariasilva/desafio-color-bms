import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { createClock, type Clock } from "./clock";
import { loadConfig, type AppConfig } from "./config";
import type { DatabaseConnection } from "./db/client";
import { createExportQueue } from "./modules/export/export-queue.service";
import { runSystemChecks, type SystemInfo } from "./modules/health/system-checks";
import { isAbsoluteFolderPath } from "@color-bms/core";
import { createSettingsStore } from "./modules/settings/settings.repository";
import { ALREADY_RUNNING_EXIT_CODE } from "./pilot/exit-codes";
import { openAppDatabase } from "./startup/open-database";
import { identifyPortOwner } from "./startup/port-conflict";
import packageJson from "../package.json" with { type: "json" };

/** #26: set by tsup at build time (tsup.config.ts); undefined when run from source. */
declare const __COLOR_BMS_BUILD_TIME__: string | undefined;
/**
 * Not used under the test clock (ADR 0002): a fixed COLOR_BMS_NOW is earlier than any later
 * build, and the clock check would always fail in E2E runs and screenshots.
 */
const builtAt =
  typeof __COLOR_BMS_BUILD_TIME__ === "string" &&
  !(process.env.NODE_ENV === "test" && process.env.COLOR_BMS_NOW)
    ? __COLOR_BMS_BUILD_TIME__
    : null;

/** The server that is running now (replaced at each restart). */
let current: { app: FastifyInstance; connection: DatabaseConnection } | null = null;

/**
 * Starts the server once: opens the database (finishing a pending restore, FR-32), builds the
 * app and listens. Resolves when a restore asks for a restart, after everything is closed.
 */
async function runServer(config: AppConfig, now: Clock, firstStart: boolean): Promise<"restart"> {
  // FR-32: a staged restore is carried out first; then #25: pending migrations (a pilot
  // update) get a local backup first. If that backup fails, this throws and nothing is
  // migrated (the error is logged below).
  const { connection, backupFile, restore } = openAppDatabase({
    dataDir: config.dataDir,
    databaseFile: config.databaseFile,
    localBackupDir: config.localBackupDir,
    now,
    log: console,
  });
  if (backupFile) console.info(`Backup before migrations: ${backupFile}`);
  if (restore) console.info(`Restore: ${restore.message}`);

  // FR-33 (#20): the settings. The pilot's config.json folder (#25) moves in on first start.
  const settings = createSettingsStore(connection, {
    envOneDriveFolder: config.envOneDriveFolder,
    trial: config.trial,
  });
  if (settings.importLegacyOneDriveFolder(config.legacyOneDriveFolder, now())) {
    console.info(`OneDrive folder imported from config.json: ${config.legacyOneDriveFolder}`);
  } else if (
    firstStart &&
    config.legacyOneDriveFolder !== null &&
    !isAbsoluteFolderPath(config.legacyOneDriveFolder)
  ) {
    console.warn(
      `Not imported from config.json: "${config.legacyOneDriveFolder}" is not a full path. Set the folder in Configurações.`,
    );
  }

  // FR-28 to FR-31 (#21, #28, #22): the spreadsheets and database backups for the OneDrive
  // folder, with retries. Trial mode never exports nor backs up to OneDrive (#26).
  // It logs through the app's logger, which exists only once the app is built.
  let log: Pick<FastifyBaseLogger, "info" | "error"> = console;
  const exports = createExportQueue({
    connection,
    folder: () => settings.backupFolder(),
    enabled: !config.trial,
    now,
    log: { info: (message) => log.info(message), error: (message) => log.error(message) },
  });

  // #26: shown on Início (startup checks) and logged below.
  const system: SystemInfo = {
    dataDir: config.dataDir,
    oneDriveFolder: () => settings.backupFolder(),
    port: config.port,
    trial: config.trial,
    builtAt,
  };
  // FR-32: a staged restore resolves this; the server then closes and starts again.
  let requestRestart = () => {};
  const restartRequested = new Promise<void>((resolve) => {
    requestRestart = resolve;
  });
  const app = await buildApp({
    connection,
    webDistDir: config.webDistDir,
    logger: true,
    now,
    exports,
    system,
    settings,
    restore: {
      dataDir: config.dataDir,
      localBackupDir: config.localBackupDir,
      onRestartRequested: () => requestRestart(),
      lastResult: restore,
    },
  });
  current = { app, connection };
  log = app.log;
  if (config.trial) {
    app.log.info("Trial mode (training data): no OneDrive backup.");
  } else if (settings.backupFolder() === null) {
    app.log.warn("No OneDrive folder configured (Configurações): no backup.");
  }

  // 127.0.0.1 only: never reachable from the network (NFR-08).
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    // #26: started twice (e.g. iniciar.cmd while the task runs): the other instance serves.
    if ((await identifyPortOwner(config.port)) === "color-bms") {
      app.log.info(`Port ${config.port}: this system is already running; exiting.`);
      await app.close();
      connection.sqlite.close();
      process.exit(ALREADY_RUNNING_EXIT_CODE);
    }
    throw new Error(
      `Port ${config.port} is in use by another program: stop it, or set PORT to another port.`,
      { cause: error },
    );
  }
  app.log.info(`Version ${packageJson.version}, database: ${config.databaseFile}`);
  // #26: the startup checks, also on Início; problems go to the log as warnings/errors.
  for (const check of runSystemChecks(connection.sqlite, now(), system)) {
    if (check.status === "error") app.log.error(`Startup check ${check.id}: ${check.message}`);
    else if (check.status === "warning")
      app.log.warn(`Startup check ${check.id}: ${check.message}`);
  }
  // FR-31: the first start of the day backs up (through the queue, FR-30).
  await exports.backupIfFirstToday();
  // FR-30: retry the pending exports now ("ao abrir o sistema"), then every 5 minutes.
  exports.start();
  // FR-31: the shop PC may stay on for days; check every hour whether today has a backup.
  const hourly = setInterval(() => void exports.backupIfFirstToday(), 60 * 60 * 1000);
  hourly.unref();

  await restartRequested;
  // FR-32: stop taking requests, let the queue finish, close the database; then start again.
  app.log.info("Restore requested: restarting.");
  clearInterval(hourly);
  current = null;
  await app.close();
  connection.sqlite.close();
  return "restart";
}

async function main(): Promise<void> {
  const config = loadConfig();
  const now = createClock();

  const shutdown = async (): Promise<void> => {
    if (current) {
      await current.app.close();
      current.connection.sqlite.close();
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // FR-32 (ADR 0005): a restore restarts the server in this same process.
  for (let firstStart = true; ; firstStart = false) {
    await runServer(config, now, firstStart);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
