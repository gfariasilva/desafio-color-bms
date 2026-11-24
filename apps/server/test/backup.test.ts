import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backupStatusResponseSchema,
  exportQueueStatusResponseSchema,
  type BackupStatusResponse,
  type ExportQueueStatusResponse,
} from "@color-bms/core";
import { buildApp } from "../src/app";
import { openDatabase } from "../src/db/client";
import { defaultMigrationsFolder, runMigrations } from "../src/db/migrate";
import { migrateWithBackup } from "../src/modules/backup/backup-before-migrations";
import { writeBackup } from "../src/modules/backup/backup.service";
import {
  createExportQueue,
  type ExportQueueService,
} from "../src/modules/export/export-queue.service";
import { createSale, NOW, TODAY, useSalesApp } from "./sales-fixture";
import { closeDayWithCount } from "./cash-closing-fixture";

/** 18/11/2026 15:00 in São Paulo → the backup is named color-2026-11-18_1500.db. */
const BACKUP_NAME = "color-2026-11-18_1500.db";

let tempDir: string;
let oneDrive: string;
/** What the export queue receives as the OneDrive folder in the app tests. */
let configuredFolder: string | null;
/** The clock of the queue (FR-31: the first start of the day depends on it). */
let current: Date;
let queue: ExportQueueService;
/** The queue's info log lines, when a test wants them. */
let logs: string[] = [];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-backup-"));
  oneDrive = path.join(tempDir, "OneDrive", "Color");
  fs.mkdirSync(oneDrive, { recursive: true });
  configuredFolder = oneDrive;
  current = NOW;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const ctx = useSalesApp({
  exports: (connection) => {
    queue = createExportQueue({
      connection,
      folder: () => configuredFolder,
      enabled: true,
      now: () => current,
      log: { info: (line) => logs.push(line), error: () => {} },
      // The 5-minute retries are not needed here.
      schedule: () => () => {},
    });
    return queue;
  },
});

async function getStatus(): Promise<BackupStatusResponse> {
  const response = await ctx.app.inject({ method: "GET", url: "/api/backup/status" });
  expect(response.statusCode, response.body).toBe(200);
  return backupStatusResponseSchema.parse(response.json());
}

async function getExportStatus(): Promise<ExportQueueStatusResponse> {
  const response = await ctx.app.inject({ method: "GET", url: "/api/exports/status" });
  expect(response.statusCode, response.body).toBe(200);
  return exportQueueStatusResponseSchema.parse(response.json());
}

/** Waits for the queue run that follows a closing (not awaited by the request). */
async function settled(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await queue.idle();
}

function backupFolder(): string {
  return path.join(oneDrive, "_backup-sistema");
}

/** The database backup items of the queue (FR-30). */
function backupRows() {
  return ctx.connection.sqlite
    .prepare(
      "select reference, status, attempts, last_error as lastError, last_error_cause as cause from export_queue where kind = 'db_backup' order by id",
    )
    .all();
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

async function saleAndClose(date = TODAY, grossCents = 2500): Promise<void> {
  await createSale(ctx, { date, grossCents });
  await closeDayWithCount(ctx, date, { openingCashCents: 0, countedCashCents: grossCents });
  await settled();
}

describe("FR-31: backup on day close", () => {
  it("FR-31: closing a day writes a backup in _backup-sistema that opens with the day's data", async () => {
    await saleAndClose(TODAY, 4321);

    const file = path.join(backupFolder(), BACKUP_NAME);
    expect(readBackup(file, "pragma integrity_check")).toEqual({ integrity_check: "ok" });
    expect(readBackup(file, "select gross_cents as g from sales")).toEqual({ g: 4321 });
    expect(readBackup(file, `select status from days where date = '${TODAY}'`)).toEqual({
      status: "closed",
    });
    // Atomic write: only the final file is left, no temp file.
    expect(fs.readdirSync(backupFolder())).toEqual([BACKUP_NAME]);
    // FR-30: the backup is a queue item, done.
    expect(backupRows()).toEqual([
      { reference: TODAY, status: "done", attempts: 1, lastError: null, cause: null },
    ]);
    expect(await getStatus()).toEqual({
      configured: true,
      folder: backupFolder(),
      lastSuccess: { at: NOW.toISOString(), file: BACKUP_NAME },
      lastRestore: null,
      startId: expect.any(String),
    });
    expect(ctx.dayClosedCalls).toEqual([TODAY]);
  });

  it("FR-31: the backup is written before the spreadsheets (a slow OneDrive never delays it)", async () => {
    logs = [];
    await saleAndClose();
    const written = logs.filter((line) => line.startsWith("Export "));
    expect(written).toEqual([
      "Export Backup do banco 2026-11-18 done.",
      "Export Diária 2026-11-18.xlsx done.",
      "Export Mensal 2026-11.xlsx done.",
    ]);
  });

  it("RN-13: after a backup, the retention policy deletes the old backups", async () => {
    fs.mkdirSync(backupFolder());
    const old = [
      "color-2026-09-10_1900.db", // not the last of September: deleted
      "color-2026-09-30_1900.db", // last of September: kept
      "color-2026-10-19_1900.db", // today − 30: deleted (not the last of October)
      "color-2026-10-20_1900.db", // today − 29: kept
      "color-2026-10-31_1900.db", // kept (last of October, and in the window)
      "color-2026-11-17_0800.db", // older backup of the 17th: deleted
      "color-2026-11-17_1900.db", // kept
      "color-2026-11-18_0900.db", // older backup of today: deleted
      "desktop.ini", // not a backup: never deleted
    ];
    for (const name of old) fs.writeFileSync(path.join(backupFolder(), name), "");

    await saleAndClose();

    expect(fs.readdirSync(backupFolder()).sort()).toEqual([
      "color-2026-09-30_1900.db",
      "color-2026-10-20_1900.db",
      "color-2026-10-31_1900.db",
      "color-2026-11-17_1900.db",
      BACKUP_NAME,
      "desktop.ini",
    ]);
  });

  it("FR-31 / FR-30: a missing OneDrive folder → the day still closes and the backup waits in the queue with the error", async () => {
    fs.rmSync(oneDrive, { recursive: true });

    await saleAndClose();

    expect(ctx.dayClosedCalls).toEqual([TODAY]);
    expect(backupRows()).toEqual([
      {
        reference: TODAY,
        status: "failed",
        attempts: 1,
        lastError: `A pasta do OneDrive não existe: ${oneDrive}. Verifique a pasta em Configurações`,
        cause: "folder",
      },
    ]);
    // FR-27 / FR-30: "Backup pendente" lists the backup with the spreadsheets.
    const status = await getExportStatus();
    expect(status.hasFailures).toBe(true);
    expect(status.items.map((item) => item.fileName)).toContain("Backup do banco 2026-11-18");
    // The root folder is never created (it would hide a wrong setting).
    expect(fs.existsSync(oneDrive)).toBe(false);
  });

  it("FR-30: a retry that succeeds writes the backup and clears the item", async () => {
    fs.rmSync(oneDrive, { recursive: true });
    await saleAndClose();
    fs.mkdirSync(oneDrive, { recursive: true });

    const retry = await ctx.app.inject({ method: "POST", url: "/api/exports/retry" });
    expect(retry.statusCode, retry.body).toBe(200);

    expect(fs.readdirSync(backupFolder())).toEqual([BACKUP_NAME]);
    expect(backupRows()).toEqual([
      { reference: TODAY, status: "done", attempts: 2, lastError: null, cause: null },
    ]);
    expect((await getExportStatus()).hasFailures).toBe(false);
  });

  it("FR-30: a failed backup is retried with a fresh copy; there is never more than one open backup item", async () => {
    fs.rmSync(oneDrive, { recursive: true });
    await saleAndClose("2026-11-17");
    await saleAndClose(TODAY);
    expect(backupRows()).toEqual([
      expect.objectContaining({ reference: TODAY, status: "failed", attempts: 2 }),
    ]);

    // A request on another day reuses the open item, now about that day.
    queue.enqueueBackup("2026-11-19");
    expect(backupRows()).toEqual([
      expect.objectContaining({ reference: "2026-11-19", status: "pending", attempts: 2 }),
    ]);
  });

  it("FR-31: a backup asked for while the backup item is being written keeps the newer day", async () => {
    queue.enqueueBackup(TODAY);
    const running = queue.processPending();
    // The item is in flight now (the backup waits for the event loop before copying).
    queue.enqueueBackup("2026-11-19");
    await running;
    await queue.idle();
    expect(backupRows()).toEqual([
      { reference: "2026-11-19", status: "done", attempts: 2, lastError: null, cause: null },
    ]);
  });

  it("FR-08: the closing answers before the backup is written (VACUUM never delays it)", async () => {
    await createSale(ctx);
    const closing = await ctx.app.inject({
      method: "POST",
      url: `/api/days/${TODAY}/close`,
      payload: { openingCashCents: 0, countedCashCents: 2500 },
    });
    expect(closing.statusCode, closing.body).toBe(200);
    // Answered, and the backup has not started yet.
    expect(fs.existsSync(backupFolder())).toBe(false);
    await settled();
    expect(fs.readdirSync(backupFolder())).toEqual([BACKUP_NAME]);
  });

  it('FR-31: a backup file locked by OneDrive reads as "em uso", not as a permission problem', async () => {
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith(".db")) {
        throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
      }
      return renameSync(from, to);
    });
    try {
      await saleAndClose();
    } finally {
      spy.mockRestore();
    }
    expect(backupRows()).toEqual([
      expect.objectContaining({
        status: "failed",
        cause: "file_in_use",
        lastError: `O arquivo de backup está em uso (pelo OneDrive) em ${backupFolder()}. Nova tentativa em 5 minutos`,
      }),
    ]);
    // The temp file is cleaned up.
    expect(fs.readdirSync(backupFolder())).toEqual([]);
  });

  it("FR-31: no folder configured → the backup waits in the queue and the status says it is not configured", async () => {
    configuredFolder = null;
    await saleAndClose();
    expect(backupRows()).toEqual([
      expect.objectContaining({
        status: "failed",
        cause: "folder",
        lastError: "Pasta do OneDrive não configurada. Configure-a em Configurações",
      }),
    ]);
    expect(await getStatus()).toEqual({
      configured: false,
      folder: null,
      lastSuccess: null,
      lastRestore: null,
      startId: expect.any(String),
    });
  });
});

const renameSync = fs.renameSync.bind(fs);

describe("FR-31: backup on month close", () => {
  it("FR-31: closing a month writes a backup", async () => {
    current = new Date("2026-11-03T18:00:00.000Z");
    await saleAndClose("2026-10-15");
    fs.rmSync(backupFolder(), { recursive: true });
    current = NOW;

    const closing = await ctx.app.inject({ method: "POST", url: "/api/months/2026-10/close" });
    expect(closing.statusCode, closing.body).toBe(200);
    await settled();

    expect(fs.readdirSync(backupFolder())).toEqual([BACKUP_NAME]);
    expect(
      readBackup(
        path.join(backupFolder(), BACKUP_NAME),
        "select status from months where year_month = '2026-10'",
      ),
    ).toEqual({ status: "closed" });
    expect(ctx.monthClosedCalls).toEqual(["2026-10"]);
  });
});

describe("FR-31: backup on the first start of the day", () => {
  it("FR-31: startup backs up when the folder has no backup of today", async () => {
    fs.mkdirSync(backupFolder());
    fs.writeFileSync(path.join(backupFolder(), "color-2026-11-17_1903.db"), "");

    await queue.backupIfFirstToday();

    expect(fs.readdirSync(backupFolder()).sort()).toEqual([
      "color-2026-11-17_1903.db",
      BACKUP_NAME,
    ]);
    expect((await getStatus()).lastSuccess).toEqual({ at: NOW.toISOString(), file: BACKUP_NAME });
  });

  it("FR-31: startup skips the backup when today already has one, and reports it as the last", async () => {
    fs.mkdirSync(backupFolder());
    fs.writeFileSync(path.join(backupFolder(), "color-2026-11-18_0805.db"), "");

    await queue.backupIfFirstToday();

    expect(fs.readdirSync(backupFolder())).toEqual(["color-2026-11-18_0805.db"]);
    expect(backupRows()).toEqual([]);
    // 08:05 in São Paulo = 11:05Z.
    expect((await getStatus()).lastSuccess).toEqual({
      at: "2026-11-18T11:05:00.000Z",
      file: "color-2026-11-18_0805.db",
    });
  });

  it("FR-31: a server left running backs up again on the next day (hourly check)", async () => {
    await queue.backupIfFirstToday();
    await queue.backupIfFirstToday(); // same day: nothing new
    current = new Date("2026-11-19T12:00:00.000Z"); // 09:00 next day in São Paulo
    await queue.backupIfFirstToday();
    expect(fs.readdirSync(backupFolder()).sort()).toEqual([
      BACKUP_NAME,
      "color-2026-11-19_0900.db",
    ]);
  });

  it("FR-31: a missing folder at startup is queued with the error (never throws)", async () => {
    configuredFolder = path.join(tempDir, "nao-existe");
    await expect(queue.backupIfFirstToday()).resolves.toBeUndefined();
    expect(backupRows()).toEqual([expect.objectContaining({ status: "failed", cause: "folder" })]);
  });

  it("no folder configured → nothing is queued at startup (Início says it is not configured)", async () => {
    configuredFolder = null;
    await queue.backupIfFirstToday();
    expect(backupRows()).toEqual([]);
  });

  it("FR-33: a new folder in Configurações gets today's backup at once", async () => {
    const other = path.join(tempDir, "Outra");
    fs.mkdirSync(other);
    configuredFolder = other;
    await queue.folderChanged();
    expect(fs.readdirSync(path.join(other, "_backup-sistema"))).toEqual([BACKUP_NAME]);
  });
});

describe("buildApp without an export queue (trial mode, tests)", () => {
  it("GET /api/backup/status says the backup is not configured", async () => {
    const connection = openDatabase(path.join(tempDir, "default.db"));
    runMigrations(connection.db);
    const app = await buildApp({ connection, now: () => NOW });
    try {
      const response = await app.inject({ method: "GET", url: "/api/backup/status" });
      expect(response.statusCode, response.body).toBe(200);
      expect(backupStatusResponseSchema.parse(response.json())).toEqual({
        configured: false,
        folder: null,
        lastSuccess: null,
        lastRestore: null,
        startId: expect.any(String),
      });
    } finally {
      await app.close();
      connection.sqlite.close();
    }
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
