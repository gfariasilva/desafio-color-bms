import { buildApp } from "./app";
import { createClock } from "./clock";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";
import { runMigrations } from "./db/migrate";

async function main(): Promise<void> {
  const config = loadConfig();
  const connection = openDatabase(config.databaseFile);
  runMigrations(connection.db);

  const app = await buildApp({
    connection,
    webDistDir: config.webDistDir,
    logger: true,
    now: createClock(),
  });

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
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
