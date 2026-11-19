import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backupStatusResponseSchema, type BackupStatusResponse } from "@color-bms/core";
import { openDatabase } from "../src/db/client";
import { defaultMigrationsFolder, runMigrations } from "../src/db/migrate";
import { migrateWithBackup } from "../src/modules/backup/backup-before-migrations";
import { createBackupService, writeBackup } from "../src/modules/backup/backup.service";
import { createSale, NOW, TODAY, useSalesApp } from "./sales-fixture";
import { closeDayWithCount } from "./cash-closing-fixture";

/** 18/11/2026 15:00 in São Paulo → the backup is named color-2026-11-18_1500.db. */
const BACKUP_NAME = "color-2026-11-18_1500.db";
const silentLog = { info: () => {}, error: () => {} };

let tempDir: string;
let oneDrive: string;
/** What `createBackupService` receives as the OneDrive folder in the app tests. */
let configuredFolder: string | null;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-backup-"));
  oneDrive = path.join(tempDir, "OneDrive", "Color");
  fs.mkdirSync(oneDrive, { recursive: true });
  configuredFolder = oneDrive;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const ctx = useSalesApp({
  backup: ({ sqlite }) =>
    createBackupService({ sqlite, folder: configuredFolder, now: () => NOW, log: silentLog }),
});

async function getStatus(): Promise<BackupStatusResponse> {
  const response = await ctx.app.inject({ method: "GET", url: "/api/backup/status" });
  expect(response.statusCode, response.body).toBe(200);
  return backupStatusResponseSchema.parse(response.json());
}

function backupFolder(): string {
  return path.join(oneDrive, "_backup-sistema");
}

/** Reads one value from a SQLite file opened read-only (proves the backup is a valid DB). */
function readBackup<T>(file: string, sql: string): T {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(sql).get() as T;
  } finally {
    db.close();
  }
}

describe("FR-31 (#25): backup on day close", () => {
  it("FR-31: closing a day writes a backup in _backup-sistema that opens with the day's data", async () => {
    await createSale(ctx, { grossCents: 4321 });
    await closeDayWithCount(ctx, TODAY, { openingCashCents: 0, countedCashCents: 4321 });

    const file = path.join(backupFolder(), BACKUP_NAME);
    await vi.waitFor(() => expect(fs.existsSync(file)).toBe(true));

    expect(readBackup(file, "pragma integrity_check")).toEqual({ integrity_check: "ok" });
    expect(readBackup(file, "select gross_cents as g from sales")).toEqual({ g: 4321 });
    expect(readBackup(file, `select status from days where date = '${TODAY}'`)).toEqual({
      status: "closed",
    });
    // Atomic write: only the final file is left, no temp file.
    expect(fs.readdirSync(backupFolder())).toEqual([BACKUP_NAME]);

    await vi.waitFor(async () =>
      expect((await getStatus()).lastSuccess).toEqual({ at: NOW.toISOString(), file: BACKUP_NAME }),
    );
    expect((await getStatus()).lastFailure).toBeNull();
  });

  it("#25: missing OneDrive folder → the day still closes and the failure shows on the status", async () => {
    fs.rmSync(oneDrive, { recursive: true });
    await createSale(ctx);

    const closing = await ctx.app.inject({
      method: "POST",
      url: `/api/days/${TODAY}/close`,
      payload: { openingCashCents: 0, countedCashCents: 2500 },
    });
    expect(closing.statusCode, closing.body).toBe(200);

    await vi.waitFor(async () => expect((await getStatus()).lastFailure).not.toBeNull());
    const status = await getStatus();
    expect(status.configured).toBe(true);
    expect(status.lastFailure).toEqual({
      at: NOW.toISOString(),
      trigger: "day-close",
      message: `A pasta do OneDrive não existe: ${oneDrive}`,
    });
    // The root folder is never created by the backup (it would hide a wrong setting).
    expect(fs.existsSync(oneDrive)).toBe(false);
    // The day-closed hook chain went on (the daily export of #21 hooks in after the backup).
    expect(ctx.dayClosedCalls).toEqual([TODAY]);
  });

  it("a later successful backup clears the failure", async () => {
    fs.rmSync(oneDrive, { recursive: true });
    await createSale(ctx);
    await closeDayWithCount(ctx, TODAY, { openingCashCents: 0, countedCashCents: 2500 });
    await vi.waitFor(async () => expect((await getStatus()).lastFailure).not.toBeNull());

    fs.mkdirSync(oneDrive, { recursive: true });
    const reopen = await ctx.app.inject({
      method: "POST",
      url: `/api/days/${TODAY}/reopen`,
      payload: { reason: "conferir" },
    });
    expect(reopen.statusCode, reopen.body).toBe(200);
    await closeDayWithCount(ctx, TODAY, { openingCashCents: 0, countedCashCents: 2500 });

    await vi.waitFor(async () => expect((await getStatus()).lastFailure).toBeNull());
    expect((await getStatus()).lastSuccess?.file).toBe(BACKUP_NAME);
  });

  it("#25: no folder configured → the status says so and nothing is written", async () => {
    configuredFolder = null;
    // The app was built before this test changed the folder: build a service directly.
    const service = createBackupService({
      sqlite: ctx.connection.sqlite,
      folder: null,
      now: () => NOW,
      log: silentLog,
    });
    await service.run("day-close");
    expect(service.status()).toEqual({
      configured: false,
      folder: null,
      lastSuccess: null,
      lastFailure: null,
    });
  });
});

describe("FR-31 (#25): backup on the first start of the day", () => {
  it("FR-31: startup backs up when the folder has no backup of today", async () => {
    const service = createBackupService({
      sqlite: ctx.connection.sqlite,
      folder: oneDrive,
      now: () => NOW,
      log: silentLog,
    });
    fs.mkdirSync(backupFolder());
    fs.writeFileSync(path.join(backupFolder(), "color-2026-11-17_1903.db"), "");

    await service.runOnStartupIfFirstToday();

    expect(fs.readdirSync(backupFolder()).sort()).toEqual([
      "color-2026-11-17_1903.db",
      BACKUP_NAME,
    ]);
    expect(service.status().lastSuccess).toEqual({ at: NOW.toISOString(), file: BACKUP_NAME });
  });

  it("FR-31: startup skips the backup when today already has one, and reports it as the last", async () => {
    const service = createBackupService({
      sqlite: ctx.connection.sqlite,
      folder: oneDrive,
      now: () => NOW,
      log: silentLog,
    });
    fs.mkdirSync(backupFolder());
    fs.writeFileSync(path.join(backupFolder(), "color-2026-11-18_0805.db"), "");

    await service.runOnStartupIfFirstToday();

    expect(fs.readdirSync(backupFolder())).toEqual(["color-2026-11-18_0805.db"]);
    // 08:05 in São Paulo = 11:05Z.
    expect(service.status().lastSuccess).toEqual({
      at: "2026-11-18T11:05:00.000Z",
      file: "color-2026-11-18_0805.db",
    });
  });

  it("startup with a missing folder records the failure (never throws)", async () => {
    const service = createBackupService({
      sqlite: ctx.connection.sqlite,
      folder: path.join(tempDir, "nao-existe"),
      now: () => NOW,
      log: silentLog,
    });
    await expect(service.runOnStartupIfFirstToday()).resolves.toBeUndefined();
    expect(service.status().lastFailure?.trigger).toBe("startup");
  });
});

describe("#25: writeBackup is atomic", () => {
  it("replaces a stale temp file left by an earlier crash", () => {
    const dir = path.join(tempDir, "local");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, `${BACKUP_NAME}.tmp`), "half-written");

    const file = writeBackup(ctx.connection.sqlite, dir, NOW);

    expect(file).toBe(path.join(dir, BACKUP_NAME));
    expect(fs.readdirSync(dir)).toEqual([BACKUP_NAME]);
    expect(readBackup(file, "pragma integrity_check")).toEqual({ integrity_check: "ok" });
  });
});

describe("#25: backup before migrations (pilot updates)", () => {
  /** A copy of the migrations folder whose journal lists only the first `count` migrations. */
  function partialMigrations(count: number): string {
    const folder = path.join(tempDir, "old-migrations");
    fs.cpSync(defaultMigrationsFolder(), folder, { recursive: true });
    const journalFile = path.join(folder, "meta", "_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, count);
    fs.writeFileSync(journalFile, JSON.stringify(journal));
    return folder;
  }

  function appliedCount(file: string): number {
    return readBackup<{ n: number }>(file, "select count(*) as n from __drizzle_migrations").n;
  }

  it("#25: with pending migrations, writes a local backup before migrating", () => {
    const dbFile = path.join(tempDir, "data", "color.db");
    const connection = openDatabase(dbFile);
    try {
      runMigrations(connection.db, partialMigrations(3));
      const backupDir = path.join(tempDir, "data", "backups");

      const result = migrateWithBackup(connection, { backupDir, now: () => NOW });

      expect(result.backupFile).toBe(path.join(backupDir, BACKUP_NAME));
      // The backup has the schema from before the update; the live DB is fully migrated.
      expect(appliedCount(result.backupFile!)).toBe(3);
      expect(appliedCount(dbFile)).toBeGreaterThan(3);
    } finally {
      connection.sqlite.close();
    }
  });

  it("#25: if the pre-migration backup fails, migrations are not applied", () => {
    const dbFile = path.join(tempDir, "data", "color.db");
    const connection = openDatabase(dbFile);
    try {
      runMigrations(connection.db, partialMigrations(3));
      // A file where the backups folder should be: mkdir fails.
      const backupDir = path.join(tempDir, "data", "backups");
      fs.writeFileSync(backupDir, "not a folder");

      expect(() => migrateWithBackup(connection, { backupDir, now: () => NOW })).toThrow(
        /backup before migrations failed.*not applied/i,
      );
      expect(appliedCount(dbFile)).toBe(3);
    } finally {
      connection.sqlite.close();
    }
  });

  it("no backup when nothing is pending", () => {
    const connection = openDatabase(path.join(tempDir, "data", "color.db"));
    try {
      runMigrations(connection.db);
      const backupDir = path.join(tempDir, "data", "backups");
      expect(migrateWithBackup(connection, { backupDir, now: () => NOW })).toEqual({
        backupFile: null,
      });
      expect(fs.existsSync(backupDir)).toBe(false);
    } finally {
      connection.sqlite.close();
    }
  });

  it("no backup for a brand-new database (nothing to lose)", () => {
    const connection = openDatabase(path.join(tempDir, "data", "color.db"));
    try {
      const backupDir = path.join(tempDir, "data", "backups");
      expect(migrateWithBackup(connection, { backupDir, now: () => NOW })).toEqual({
        backupFile: null,
      });
      expect(fs.existsSync(backupDir)).toBe(false);
      // …and the database was migrated.
      expect(
        connection.sqlite.prepare("select name from sqlite_master where name = 'sales'").get(),
      ).toEqual({ name: "sales" });
    } finally {
      connection.sqlite.close();
    }
  });
});
