import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export interface DatabaseConnection {
  /** Raw better-sqlite3 handle: pragmas, backups, transactions. */
  sqlite: Database.Database;
  /** Drizzle query builder on top of the same connection. */
  db: AppDatabase;
}

/**
 * Opens (or creates) the SQLite file and applies the pragmas from ADR 0001:
 * - WAL + synchronous=FULL: a confirmed transaction survives a power cut (NFR-06).
 * - foreign_keys=ON: SQLite has them OFF by default.
 * - busy_timeout: wait instead of failing if the file is briefly locked.
 */
export function openDatabase(file: string): DatabaseConnection {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = FULL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}
