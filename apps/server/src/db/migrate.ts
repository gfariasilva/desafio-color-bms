import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { AppDatabase } from "./client";

/**
 * The migrations folder sits next to src/ and dist/, so the same relative path works
 * when running from source (src/db/migrate.ts → ../../migrations) and from the bundle
 * (dist/main.js → ../migrations). We pick whichever exists.
 */
function defaultMigrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fromBundle = path.resolve(here, "../migrations");
  const fromSource = path.resolve(here, "../../migrations");
  return here.endsWith(`${path.sep}dist`) ? fromBundle : fromSource;
}

/** Applies pending migrations in order. Already-applied ones are skipped. */
export function runMigrations(db: AppDatabase, migrationsFolder = defaultMigrationsFolder()): void {
  migrate(db, { migrationsFolder });
}
