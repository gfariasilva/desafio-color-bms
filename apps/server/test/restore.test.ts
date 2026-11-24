import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditListResponseSchema,
  backupListResponseSchema,
  backupStatusResponseSchema,
  backupUploadResponseSchema,
  type RestoreResult,
} from "@color-bms/core";
import { buildApp } from "../src/app";
import type { DatabaseConnection } from "../src/db/client";
import { writeBackup } from "../src/modules/backup/backup.service";
import { applyPendingRestore } from "../src/modules/backup/restore.service";
import { createExportQueue } from "../src/modules/export/export-queue.service";
import { openAppDatabase } from "../src/startup/open-database";
import { NOW } from "./sales-fixture";

/**
 * FR-32: restore a database backup. The app is started like main.ts does (openAppDatabase +
 * buildApp), so a test can "restart" it after a restore request, as the real server does.
 */

const silentLog = { info: () => {}, error: () => {}, warn: () => {} };
/** 18/11/2026 15:00 in São Paulo. */
const BACKUP_NAME = "color-2026-11-18_1500.db";

let tempDir: string;
let dataDir: string;
let oneDrive: string;
let connection: DatabaseConnection;
let app: FastifyInstance;
let restartRequested: ReturnType<typeof vi.fn>;
let current: Date;

function paths(dir = dataDir) {
  return {
    dataDir: dir,
    databaseFile: path.join(dir, "color.db"),
    localBackupDir: path.join(dir, "backups"),
  };
}

/** Starts the server like main.ts: finish a pending restore, open, migrate, build. */
async function start(dir = dataDir): Promise<RestoreResult | null> {
  const opened = openAppDatabase({ ...paths(dir), now: () => current, log: silentLog });
  connection = opened.connection;
  restartRequested = vi.fn();
  app = await buildApp({
    connection,
    now: () => current,
    exports: createExportQueue({
      connection,
      folder: () => oneDrive,
      enabled: true,
      now: () => current,
      log: silentLog,
      schedule: () => () => {},
    }),
    restore: {
      ...paths(dir),
      onRestartRequested: restartRequested,
      lastResult: opened.restore,
    },
  });
  return opened.restore;
}

/** What main.ts does after a restore request: close everything, then start again. */
async function restart(dir = dataDir): Promise<RestoreResult | null> {
  await app.close();
  connection.sqlite.close();
  return start(dir);
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-restore-"));
  dataDir = path.join(tempDir, "data");
  oneDrive = path.join(tempDir, "OneDrive");
  fs.mkdirSync(oneDrive, { recursive: true });
  current = NOW;
  await start();
});

afterEach(async () => {
  await app.close();
  connection.sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const oneDriveBackups = () => path.join(oneDrive, "_backup-sistema");

/** A note we can find again: a cash withdrawal ("sangria") is the simplest dated record. */
async function addWithdrawal(note: string, amountCents = 1000): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: "/api/cash-withdrawals",
    payload: { date: "2026-11-18", amountCents, note },
  });
  expect(response.statusCode, response.body).toBe(201);
}

function withdrawalNotes(conn = connection): string[] {
  return (
    conn.sqlite.prepare("select note from cash_withdrawals order by id").all() as {
      note: string;
    }[]
  ).map((row) => row.note);
}

function notesIn(file: string): string[] {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return (
      db.prepare("select note from cash_withdrawals order by id").all() as { note: string }[]
    ).map((row) => row.note);
  } finally {
    db.close();
  }
}

function postRestore(payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/backup/restore", payload });
}

/** A backup of the current database in the OneDrive folder, at `at`. */
function backupToOneDrive(at = current): string {
  return writeBackup(connection.sqlite, oneDriveBackups(), at);
}

describe("FR-32: the list of backups", () => {
  it("FR-32: lists the OneDrive and the local backups with date and time, newest first", async () => {
    backupToOneDrive(new Date("2026-11-17T22:03:00.000Z"));
    backupToOneDrive(NOW);
    writeBackup(connection.sqlite, paths().localBackupDir, new Date("2026-11-10T12:00:00.000Z"));
    fs.writeFileSync(path.join(oneDriveBackups(), "desktop.ini"), "");
    fs.writeFileSync(path.join(oneDriveBackups(), `${BACKUP_NAME}.tmp`), "");

    const response = await app.inject({ method: "GET", url: "/api/backup/files" });
    expect(response.statusCode, response.body).toBe(200);
    const list = backupListResponseSchema.parse(response.json());

    expect(list.oneDriveFolder).toBe(oneDriveBackups());
    expect(list.localFolder).toBe(paths().localBackupDir);
    expect(
      list.backups.map(({ source, name, date, time }) => ({ source, name, date, time })),
    ).toEqual([
      { source: "onedrive", name: BACKUP_NAME, date: "2026-11-18", time: "15:00" },
      { source: "onedrive", name: "color-2026-11-17_1903.db", date: "2026-11-17", time: "19:03" },
      { source: "local", name: "color-2026-11-10_0900.db", date: "2026-11-10", time: "09:00" },
    ]);
    expect(list.backups[0]?.sizeBytes).toBeGreaterThan(0);
  });

  it("FR-32: missing folders give an empty list", async () => {
    fs.rmSync(oneDrive, { recursive: true });
    const list = backupListResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/api/backup/files" })).json(),
    );
    expect(list.backups).toEqual([]);
  });
});

describe("FR-32: restore a backup from the list", () => {
  it("FR-32: saves a safety copy, swaps the database for the backup, restarts and audits it", async () => {
    await addWithdrawal("antes do backup");
    backupToOneDrive();
    await addWithdrawal("depois do backup");

    const response = await postRestore({
      source: "onedrive",
      name: BACKUP_NAME,
      reason: "  Lançamentos errados  ",
    });
    expect(response.statusCode, response.body).toBe(202);
    const { startId } = backupStatusResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/api/backup/status" })).json(),
    );
    expect(response.json()).toEqual({ restarting: true, startId });
    // The swap happens at the restart, never under the open connection.
    await vi.waitFor(() => expect(restartRequested).toHaveBeenCalledTimes(1));
    expect(withdrawalNotes()).toEqual(["antes do backup", "depois do backup"]);

    current = new Date("2026-11-18T18:05:00.000Z");
    const result = await restart();

    // The system is back to the backup's state.
    expect(withdrawalNotes()).toEqual(["antes do backup"]);
    // The safety copy has the state from before the restore.
    const safetyCopy = path.join(paths().localBackupDir, "color-2026-11-18_1505.db");
    expect(notesIn(safetyCopy)).toEqual(["antes do backup", "depois do backup"]);
    // The restore is in the audit log (of the restored database).
    const audit = auditListResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/api/audit?entity=backup" })).json(),
    );
    expect(audit.entries).toEqual([
      expect.objectContaining({
        entity: "backup",
        entityId: BACKUP_NAME,
        action: "restore",
        at: "2026-11-18T18:05:00.000Z",
        reason: "Lançamentos errados",
        before: { safetyCopy: "color-2026-11-18_1505.db" },
        after: {
          file: BACKUP_NAME,
          backupSource: "OneDrive",
          backupDate: "2026-11-18",
          backupTime: "15:00",
        },
      }),
    ]);
    // The result is shown after the restart.
    expect(result).toEqual({
      ok: true,
      at: "2026-11-18T18:05:00.000Z",
      file: BACKUP_NAME,
      message: "Backup de 18/11/2026 15:00 restaurado.",
    });
    const status = backupStatusResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/api/backup/status" })).json(),
    );
    expect(status.lastRestore).toEqual(result);
    // A new start: the UI knows the restart is over.
    expect(status.startId).not.toBe(startId);
    // Nothing is left in the staging folder.
    expect(fs.readdirSync(path.join(dataDir, "restore"))).toEqual([]);
  });

  it("FR-32: a local backup (a safety copy) can be restored to undo a restore", async () => {
    await addWithdrawal("estado local");
    writeBackup(connection.sqlite, paths().localBackupDir, NOW);
    await addWithdrawal("depois");

    const response = await postRestore({ source: "local", name: BACKUP_NAME, reason: "desfazer" });
    expect(response.statusCode, response.body).toBe(202);
    current = new Date("2026-11-18T18:01:00.000Z");
    await restart();

    expect(withdrawalNotes()).toEqual(["estado local"]);
  });

  it("FR-32: the reason is required", async () => {
    backupToOneDrive();
    const response = await postRestore({ source: "onedrive", name: BACKUP_NAME, reason: " " });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Informe o motivo da restauração." });
    expect(restartRequested).not.toHaveBeenCalled();
  });

  it("FR-32: a backup that is not in the folder is refused", async () => {
    const response = await postRestore({ source: "onedrive", name: BACKUP_NAME, reason: "x" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Backup não encontrado: color-2026-11-18_1500.db. Atualize a lista.",
    });
  });

  it("FR-32: a file that is not a database is refused, and nothing changes", async () => {
    fs.mkdirSync(oneDriveBackups(), { recursive: true });
    fs.writeFileSync(path.join(oneDriveBackups(), BACKUP_NAME), "isto não é um banco");
    const response = await postRestore({ source: "onedrive", name: BACKUP_NAME, reason: "x" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Este arquivo não é um backup do sistema Color. Escolha outro arquivo.",
    });
    expect(restartRequested).not.toHaveBeenCalled();
    expect(fs.readdirSync(path.join(dataDir, "restore"))).toEqual([]);
  });

  it("FR-32: a SQLite database of another program is refused", async () => {
    fs.mkdirSync(oneDriveBackups(), { recursive: true });
    const other = new Database(path.join(oneDriveBackups(), BACKUP_NAME));
    other.exec("create table notas (id integer primary key)");
    other.close();
    const response = await postRestore({ source: "onedrive", name: BACKUP_NAME, reason: "x" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe(
      "Este arquivo não é um backup do sistema Color. Escolha outro arquivo.",
    );
  });

  it("FR-32: a backup made by a newer version of the system is refused", async () => {
    const file = backupToOneDrive();
    const db = new Database(file);
    db.prepare("insert into __drizzle_migrations (hash, created_at) values ('futuro', ?)").run(
      Date.UTC(2099, 0, 1),
    );
    db.close();
    const response = await postRestore({ source: "onedrive", name: BACKUP_NAME, reason: "x" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe(
      "Este backup foi feito por uma versão mais nova do sistema. Atualize o sistema antes de restaurar.",
    );
  });

  it("FR-32: a second restore while the system restarts is refused", async () => {
    backupToOneDrive();
    const first = await postRestore({ source: "onedrive", name: BACKUP_NAME, reason: "x" });
    expect(first.statusCode).toBe(202);
    const second = await postRestore({ source: "onedrive", name: BACKUP_NAME, reason: "x" });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("Uma restauração já está em andamento. Aguarde.");
  });

  it("FR-32: restoring an uploaded file needs the upload first", async () => {
    const response = await postRestore({ source: "upload", reason: "PC novo" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Escolha o arquivo de backup antes de restaurar.");
  });
});

describe("FR-32: restore on a new PC", () => {
  it("FR-32: a new install restored from a chosen file has exactly the backup's state", async () => {
    // The old PC: some data, then its backup file.
    await addWithdrawal("loja antiga", 4321);
    const backupFile = backupToOneDrive();

    // The new PC: a fresh data folder, no OneDrive backups.
    await app.close();
    connection.sqlite.close();
    const newDataDir = path.join(tempDir, "pc-novo");
    oneDrive = path.join(tempDir, "OneDrive-novo");
    await start(newDataDir);
    expect(withdrawalNotes()).toEqual([]);

    const upload = await app.inject({
      method: "PUT",
      url: `/api/backup/upload?name=${encodeURIComponent(BACKUP_NAME)}`,
      headers: { "content-type": "application/octet-stream" },
      payload: fs.readFileSync(backupFile),
    });
    expect(upload.statusCode, upload.body).toBe(200);
    expect(backupUploadResponseSchema.parse(upload.json())).toEqual({
      name: BACKUP_NAME,
      sizeBytes: fs.statSync(backupFile).size,
      at: NOW.toISOString(),
    });
    const response = await postRestore({ source: "upload", reason: "PC novo" });
    expect(response.statusCode, response.body).toBe(202);
    await restart(newDataDir);

    // Every table has exactly the backup's rows, except the restore's own audit row.
    const backup = new Database(backupFile, { readonly: true });
    try {
      const tables = (
        backup
          .prepare(
            "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'",
          )
          .all() as { name: string }[]
      ).map((row) => row.name);
      expect(tables.length).toBeGreaterThan(10);
      for (const table of tables) {
        const order = table === "settings" ? "key" : "rowid";
        const rows = (db: Database.Database) =>
          db.prepare(`select * from "${table}" order by ${order}`).all();
        const restored = rows(connection.sqlite);
        if (table === "audit_log") {
          expect(restored.slice(0, -1)).toEqual(rows(backup));
          expect(restored.at(-1)).toMatchObject({ entity: "backup", action: "restore" });
        } else {
          expect(restored, table).toEqual(rows(backup));
        }
      }
    } finally {
      backup.close();
    }
    expect(withdrawalNotes()).toEqual(["loja antiga"]);
  });

  it("FR-32: an uploaded file that is not a backup is refused with a clear message", async () => {
    const upload = await app.inject({
      method: "PUT",
      url: "/api/backup/upload?name=planilha.xlsx",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("PK planilha"),
    });
    expect(upload.statusCode).toBe(400);
    expect(upload.json().error).toBe(
      "Este arquivo não é um backup do sistema Color. Escolha outro arquivo.",
    );
    const restore = await postRestore({ source: "upload", reason: "x" });
    expect(restore.statusCode).toBe(400);
  });
});

describe("FR-32: a restore interrupted by a crash", () => {
  it("FR-32: a restore staged before a crash is finished at the next start", async () => {
    await addWithdrawal("no backup");
    backupToOneDrive();
    await addWithdrawal("perdido");
    expect(
      (await postRestore({ source: "onedrive", name: BACKUP_NAME, reason: "x" })).statusCode,
    ).toBe(202);
    // Crash: the server dies before its restart (no clean close of the app).
    connection.sqlite.close();
    await app.close().catch(() => {});

    await start();
    expect(withdrawalNotes()).toEqual(["no backup"]);
  });

  it("FR-32: a crash after the swap, before the audit row, finishes the audit once", async () => {
    await addWithdrawal("no backup");
    backupToOneDrive();
    expect(
      (await postRestore({ source: "onedrive", name: BACKUP_NAME, reason: "x" })).statusCode,
    ).toBe(202);
    await app.close();
    connection.sqlite.close();
    // The file part of the restart ran, then the PC lost power.
    expect(applyPendingRestore({ ...paths(), now: () => current, log: silentLog })).not.toBeNull();

    await start();
    const rows = connection.sqlite
      .prepare("select count(*) as n from audit_log where entity = 'backup' and action = 'restore'")
      .get();
    expect(rows).toEqual({ n: 1 });
    await restart();
    expect(
      connection.sqlite
        .prepare(
          "select count(*) as n from audit_log where entity = 'backup' and action = 'restore'",
        )
        .get(),
    ).toEqual({ n: 1 });
  });

  it("FR-32: if the safety copy cannot be written, nothing is restored and the reason is shown", async () => {
    await addWithdrawal("continua");
    backupToOneDrive();
    expect(
      (await postRestore({ source: "onedrive", name: BACKUP_NAME, reason: "x" })).statusCode,
    ).toBe(202);
    // The local backups folder cannot be created.
    fs.writeFileSync(paths().localBackupDir, "não é uma pasta");

    const result = await restart();

    expect(withdrawalNotes()).toEqual(["continua"]);
    expect(result).toEqual({
      ok: false,
      at: NOW.toISOString(),
      file: BACKUP_NAME,
      message: expect.stringMatching(
        /^Não foi possível salvar a cópia de segurança do banco atual\. Nada foi alterado\./,
      ),
    });
    expect(fs.readdirSync(path.join(dataDir, "restore"))).toEqual([]);
  });
});
