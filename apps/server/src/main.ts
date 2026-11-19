import type { FastifyBaseLogger } from "fastify";
import { buildApp } from "./app";
import { createClock } from "./clock";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";
import { migrateWithBackup } from "./modules/backup/backup-before-migrations";
import { createBackupService } from "./modules/backup/backup.service";
import { createExportQueue } from "./modules/export/export-queue.service";
import { runSystemChecks, type SystemInfo } from "./modules/health/system-checks";
import { isAbsoluteFolderPath } from "@color-bms/core";
import { createSettingsStore } from "./modules/settings/settings.repository";
import { ALREADY_RUNNING_EXIT_CODE } from "./pilot/exit-codes";
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

async function main(): Promise<void> {
  const config = loadConfig();
  const now = createClock();
  const connection = openDatabase(config.databaseFile);
  // #25: pending migrations (a pilot update) get a local backup first; if it fails, this
  // throws, nothing is migrated, and the error is logged below.
  const { backupFile } = migrateWithBackup(connection, { backupDir: config.localBackupDir, now });
  if (backupFile) console.info(`Backup before migrations: ${backupFile}`);

  // FR-33 (#20): the settings. The pilot's config.json folder (#25) moves in on first start.
  const settings = createSettingsStore(connection, {
    envOneDriveFolder: config.envOneDriveFolder,
    trial: config.trial,
  });
  if (settings.importLegacyOneDriveFolder(config.legacyOneDriveFolder, now())) {
    console.info(`OneDrive folder imported from config.json: ${config.legacyOneDriveFolder}`);
  } else if (
    config.legacyOneDriveFolder !== null &&
    !isAbsoluteFolderPath(config.legacyOneDriveFolder)
  ) {
    console.warn(
      `Not imported from config.json: "${config.legacyOneDriveFolder}" is not a full path. Set the folder in Configurações.`,
    );
  }

  // FR-31 (#25): the OneDrive backup, after each closing and on the first start of the day.
  // It logs through the app's logger, which exists only once the app is built.
  let log: Pick<FastifyBaseLogger, "info" | "error"> = console;
  const backup = createBackupService({
    sqlite: connection.sqlite,
    folder: () => settings.backupFolder(),
    now,
    log: { info: (message) => log.info(message), error: (message) => log.error(message) },
  });

  // FR-28 / FR-30 (#21): the daily spreadsheets for the OneDrive folder, with retries.
  // Trial mode never exports (#26), like the backup.
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
  const app = await buildApp({
    connection,
    webDistDir: config.webDistDir,
    logger: true,
    now,
    backup,
    exports,
    system,
    settings,
  });
  log = app.log;
  if (config.trial) {
    app.log.info("Trial mode (training data): no OneDrive backup.");
  } else if (settings.backupFolder() === null) {
    app.log.warn("No OneDrive folder configured (Configurações): no backup.");
  }

  const shutdown = async (): Promise<void> => {
    await app.close();
    connection.sqlite.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

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
  await backup.runOnStartupIfFirstToday();
  // FR-30: retry the pending exports now ("ao abrir o sistema"), then every 5 minutes.
  exports.start();
  // FR-31: the shop PC may stay on for days; check every hour whether today has a backup.
  setInterval(() => void backup.runOnStartupIfFirstToday(), 60 * 60 * 1000).unref();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
