import type { FastifyBaseLogger } from "fastify";
import { buildApp } from "./app";
import { createClock } from "./clock";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";
import { migrateWithBackup } from "./modules/backup/backup-before-migrations";
import { createBackupService } from "./modules/backup/backup.service";

async function main(): Promise<void> {
  const config = loadConfig();
  const now = createClock();
  const connection = openDatabase(config.databaseFile);
  // #25: pending migrations (a pilot update) get a local backup first; if it fails, this
  // throws, nothing is migrated, and the error is logged below.
  const { backupFile } = migrateWithBackup(connection, { backupDir: config.localBackupDir, now });
  if (backupFile) console.info(`Backup before migrations: ${backupFile}`);

  // FR-31 (#25): the OneDrive backup, after each closing and on the first start of the day.
  // It logs through the app's logger, which exists only once the app is built.
  let log: Pick<FastifyBaseLogger, "info" | "error"> = console;
  const backup = createBackupService({
    sqlite: connection.sqlite,
    folder: config.oneDriveFolder,
    now,
    log: { info: (message) => log.info(message), error: (message) => log.error(message) },
  });

  const app = await buildApp({
    connection,
    webDistDir: config.webDistDir,
    logger: true,
    now,
    backup,
  });
  log = app.log;
  if (config.oneDriveFolder === null) {
    app.log.warn(
      "No OneDrive folder configured (config.json or COLOR_BMS_ONEDRIVE_DIR): no backup.",
    );
  }

  const shutdown = async (): Promise<void> => {
    await app.close();
    connection.sqlite.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // 127.0.0.1 only: never reachable from the network (NFR-08).
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Database: ${config.databaseFile}`);
  await backup.runOnStartupIfFirstToday();
  // FR-31: the shop PC may stay on for days; check every hour whether today has a backup.
  setInterval(() => void backup.runOnStartupIfFirstToday(), 60 * 60 * 1000).unref();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
