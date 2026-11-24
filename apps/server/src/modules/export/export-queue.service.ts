import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  BACKUP_FOLDER_NAME,
  dailySpreadsheetPath,
  EXPORT_RETRY_MINUTES,
  exportFileName,
  type CivilDate,
  type ExportErrorCause,
  type ExportKind,
  type ExportQueueItem,
  type ExportQueueStatusResponse,
  monthlySpreadsheetPath,
  type SpreadsheetModel,
  todayCivilDate,
  type YearMonth,
} from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { exportQueue } from "../../db/schema";
import { hasBackupToday, writeOneDriveBackup } from "../backup/backup.service";
import { writeFileAtomic } from "./atomic-write";
import { getDailySpreadsheet } from "./daily-spreadsheet.repository";
import { getMonthlySpreadsheet } from "./monthly-spreadsheet.repository";
import { renderXlsx } from "./xlsx-writer";

/**
 * FR-28 / FR-29 / FR-30 / FR-31: the export queue. Every file for the OneDrive folder (the
 * spreadsheets and the database backups, #22) is a row of
 * `export_queue`; this service writes them, keeps failures with a pt-BR error ("Backup
 * pendente" on Início), and retries them every 5 minutes, at startup, when the folder changes
 * in Configurações, and on "Tentar agora".
 *
 * Only one run at a time: a request during a run (a new closing, "Tentar agora") makes the
 * run go through the queue once more instead of starting a second one. A closing only asks
 * for the new items (`processPending`), so an item that just failed is not tried again at
 * once; the explicit retries (`processAll`) try every open item.
 */
export interface ExportQueueService {
  /**
   * FR-28: queues the daily spreadsheet of a closed day. A day that already has an open item
   * reuses it (closing again after a failure: it is pending again); if that item is being
   * written right now, it is written once more, so the file always has the latest closing.
   * Synchronous.
   */
  enqueueDailySpreadsheet(date: CivilDate): void;
  /**
   * FR-29: queues the monthly spreadsheet of a month (after a day of it is closed, and when
   * the month is closed). Same reuse rules as the daily one. Synchronous.
   */
  enqueueMonthlySpreadsheet(yearMonth: YearMonth): void;
  /**
   * FR-31: queues a database backup (day closing, month closing, first start of the day).
   * There is at most one open backup item: a new request reuses it, now about `date`, since a
   * backup always copies the database as it is when written. Synchronous.
   */
  enqueueBackup(date: CivilDate): void;
  /**
   * FR-31: "a primeira abertura do sistema no dia": backs up when the OneDrive folder has no
   * backup of today yet. Called at startup and every hour (a PC left on overnight). Nothing
   * is queued when no folder is configured (Início says so). Never throws.
   */
  backupIfFirstToday(): Promise<void>;
  /**
   * FR-33: the folder changed in Configurações: today's backup if the new folder has none,
   * then every open item (FR-30). Never throws.
   */
  folderChanged(): Promise<void>;
  /** The OneDrive folder the queue writes to; null when not configured or disabled. */
  oneDriveFolder(): string | null;
  /** FR-28: writes the items not tried yet (after a closing). Never throws. */
  processPending(): Promise<void>;
  /**
   * FR-30: tries every open item now, failed ones included ("Tentar agora", every 5 minutes,
   * at startup, new folder). Never throws: failures stay in the queue.
   */
  processAll(): Promise<void>;
  /** Resolves when no run is in progress (tests, shutdown). */
  idle(): Promise<void>;
  /** FR-30: the startup try, then a try every 5 minutes (main.ts). */
  start(): void;
  /** Stops the 5-minute retries and waits for a run in progress (server shutdown). */
  stop(): Promise<void>;
  /** GET /api/exports/status: the open items, for "Backup pendente" (FR-27). */
  status(): ExportQueueStatusResponse;
}

export interface ExportQueueOptions {
  connection: DatabaseConnection;
  /**
   * The OneDrive folder (spec §7.2 `<pasta>`), or null when not configured. Read at every try,
   * so a change in Configurations (FR-33) applies at once.
   */
  folder: () => string | null;
  /** False in trial mode (#26) and in tests that do not need it: nothing is queued. */
  enabled: boolean;
  now: Clock;
  log: { info: (message: string) => void; error: (message: string) => void };
  /** Writes a finished file; tests replace it to simulate a file open in Excel. */
  writeFile?: (file: string, data: Uint8Array) => void;
  /** Runs `run` every `everyMs`; returns a cancel function. Tests replace it. */
  schedule?: (run: () => void, everyMs: number) => () => void;
}

/** An error with the cause the owner must fix (spec §7.4) and a pt-BR message. */
class ExportError extends Error {
  constructor(
    message: string,
    readonly reason: ExportErrorCause,
  ) {
    super(message);
  }
}

const checkFolderHint = "Verifique a pasta em Configurações";

/** §7.4: the pt-BR message and cause of a failed write. */
function describeFailure(
  error: unknown,
  kind: ExportKind,
  fileName: string,
  dir: string | null,
): { message: string; cause: ExportErrorCause } {
  if (error instanceof ExportError) return { message: error.message, cause: error.reason };
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EBUSY" && kind === "db_backup") {
    // Nobody opens a backup in Excel: OneDrive is still syncing the file of the same minute.
    return {
      message: `O arquivo de backup está em uso (pelo OneDrive) em ${dir}. Nova tentativa em ${EXPORT_RETRY_MINUTES} minutos`,
      cause: "file_in_use",
    };
  }
  if (code === "EBUSY") {
    return {
      message: `O arquivo ${fileName} está aberto no Excel (ou em uso pelo OneDrive). Feche o arquivo`,
      cause: "file_in_use",
    };
  }
  if (code === "EACCES" || code === "EPERM") {
    return { message: `Sem permissão para gravar em ${dir}. ${checkFolderHint}`, cause: "folder" };
  }
  if (code === "ENOSPC") {
    return { message: `Disco cheio: não há espaço para gravar ${fileName}`, cause: "other" };
  }
  // The raw error (in English) goes to the log only; the owner reads pt-BR (CLAUDE.md).
  return {
    message: `Não foi possível gravar ${fileName}. Se continuar, avise o desenvolvedor`,
    cause: "other",
  };
}

/** The OneDrive folder, checked. It is never created here: a missing one is a wrong setting. */
function requireRootFolder(folder: string | null): string {
  if (folder === null) {
    throw new ExportError(
      "Pasta do OneDrive não configurada. Configure-a em Configurações",
      "folder",
    );
  }
  const stat = fs.statSync(folder, { throwIfNoEntry: false });
  if (!stat) {
    throw new ExportError(
      `A pasta do OneDrive não existe: ${folder}. ${checkFolderHint}`,
      "folder",
    );
  }
  if (!stat.isDirectory()) {
    throw new ExportError(
      `O caminho do OneDrive não é uma pasta: ${folder}. ${checkFolderHint}`,
      "folder",
    );
  }
  return folder;
}

const defaultSchedule = (run: () => void, everyMs: number) => {
  const timer = setInterval(run, everyMs);
  // The retries never keep the process alive on their own.
  timer.unref();
  return () => clearInterval(timer);
};

export function createExportQueue({
  connection,
  folder,
  enabled,
  now,
  log,
  writeFile = writeFileAtomic,
  schedule = defaultSchedule,
}: ExportQueueOptions): ExportQueueService {
  const { db } = connection;
  let running: Promise<void> | null = null;
  /** What was asked for during the current run: another pass over the pending or all items. */
  let nextPass: "pending" | "all" | null = null;
  let cancelSchedule: (() => void) | null = null;
  /** The item being written right now, and whether it was queued again meanwhile. */
  let inFlight: { id: number; requeued: boolean; reference: string } | null = null;

  function enqueue(kind: ExportKind, reference: string): void {
    if (!enabled) return;
    const open = db
      .select({ id: exportQueue.id })
      .from(exportQueue)
      .where(
        and(
          eq(exportQueue.kind, kind),
          // FR-31: any open backup is reused, whatever day it was asked for.
          kind === "db_backup" ? undefined : eq(exportQueue.reference, reference),
          ne(exportQueue.status, "done"),
        ),
      )
      .get();
    if (open) {
      if (inFlight?.id === open.id) {
        inFlight.requeued = true;
        // FR-31: the backup is written again, now about the newer day.
        inFlight.reference = reference;
      }
      // A new request for a failed item: it is tried with the other new items.
      else
        db.update(exportQueue)
          .set({ status: "pending", reference })
          .where(eq(exportQueue.id, open.id))
          .run();
      return;
    }
    db.insert(exportQueue)
      .values({ kind, reference, status: "pending", createdAt: now().toISOString() })
      .run();
  }

  /**
   * The spreadsheet of one item and its path inside the OneDrive folder (§7.2), or a null
   * model when there is nothing to write.
   */
  function spreadsheetOf(
    kind: ExportKind,
    reference: string,
    at: Date,
  ): { model: SpreadsheetModel | null; target: [string, string, string] } {
    switch (kind) {
      case "daily_spreadsheet":
        // No movement, or reopened: no file (FR-28, FR-09).
        return {
          model: getDailySpreadsheet(db, reference, at),
          target: dailySpreadsheetPath(reference),
        };
      case "monthly_spreadsheet":
        // FR-29: always written; partial while the month is open, final once it is closed.
        return {
          model: getMonthlySpreadsheet(db, reference, at),
          target: monthlySpreadsheetPath(reference),
        };
      case "db_backup":
        // Written by exportItem (it is not a spreadsheet).
        throw new RangeError("db_backup has no spreadsheet");
    }
  }

  /** Writes one item's file. Returns normally when written or when there is nothing to write. */
  async function exportItem(kind: ExportKind, reference: string, at: Date): Promise<void> {
    if (kind === "db_backup") {
      // Yield first: after a closing this runs before Fastify sends the answer, and the
      // synchronous VACUUM INTO must never delay it (FR-08).
      await new Promise((resolve) => setImmediate(resolve));
      // FR-31: a consistent copy of the database as it is now, then RN-13.
      const { file, deleted } = writeOneDriveBackup(
        connection.sqlite,
        requireRootFolder(folder()),
        at,
        log,
      );
      log.info(`Backup written to ${file}.`);
      if (deleted.length > 0) log.info(`RN-13: deleted old backups ${deleted.join(", ")}.`);
      return;
    }
    const { model, target } = spreadsheetOf(kind, reference, at);
    if (model === null) return;
    const data = await renderXlsx(model);
    // Checked after rendering, right before writing: the folder may have changed meanwhile.
    const root = requireRootFolder(folder());
    const [year, month, fileName] = target;
    const dir = path.join(root, year, month);
    fs.mkdirSync(dir, { recursive: true });
    writeFile(path.join(dir, fileName), data);
  }

  async function attempt(item: {
    id: number;
    kind: ExportKind;
    reference: string;
    attempts: number;
  }) {
    const at = now();
    const fileName = exportFileName(item.kind, item.reference);
    const attempts = item.attempts + 1;
    const lastAttemptAt = at.toISOString();
    inFlight = { id: item.id, requeued: false, reference: item.reference };
    try {
      await exportItem(item.kind, item.reference, at);
      if (inFlight.requeued) {
        // Closed again while being written: write it once more with the latest data.
        db.update(exportQueue)
          .set({
            status: "pending",
            reference: inFlight.reference,
            attempts,
            lastAttemptAt,
            lastError: null,
            lastErrorCause: null,
          })
          .where(eq(exportQueue.id, item.id))
          .run();
        nextPass ??= "pending";
      } else {
        db.update(exportQueue)
          .set({
            status: "done",
            attempts,
            lastAttemptAt,
            doneAt: lastAttemptAt,
            lastError: null,
            lastErrorCause: null,
          })
          .where(eq(exportQueue.id, item.id))
          .run();
        log.info(`Export ${fileName} done.`);
      }
    } catch (error) {
      const root = folder();
      let dir = root;
      try {
        if (root && item.kind === "daily_spreadsheet") {
          const [year, month] = dailySpreadsheetPath(item.reference);
          dir = path.join(root, year, month);
        } else if (root && item.kind === "monthly_spreadsheet") {
          const [year, month] = monthlySpreadsheetPath(item.reference);
          dir = path.join(root, year, month);
        } else if (root && item.kind === "db_backup") {
          dir = path.join(root, BACKUP_FOLDER_NAME);
        }
      } catch {
        // A malformed reference: still record the failure below and go on with the queue.
      }
      const { message, cause } = describeFailure(error, item.kind, fileName, dir);
      // Closed again while this try failed: a new request, tried with the next new items.
      const requeued = inFlight.requeued;
      if (requeued) nextPass ??= "pending";
      db.update(exportQueue)
        .set({
          status: requeued ? "pending" : "failed",
          reference: inFlight.reference,
          attempts,
          lastAttemptAt,
          lastError: message,
          lastErrorCause: cause,
        })
        .where(eq(exportQueue.id, item.id))
        .run();
      const detail = error instanceof Error ? error.message : String(error);
      log.error(`Export ${fileName} failed: ${detail}`);
    } finally {
      inFlight = null;
    }
  }

  async function processItems(which: "pending" | "all"): Promise<void> {
    const items = db
      .select()
      .from(exportQueue)
      .where(which === "all" ? ne(exportQueue.status, "done") : eq(exportQueue.status, "pending"))
      // FR-31: backups first, so a slow OneDrive (or Excel) never delays them.
      .orderBy(
        sql`case when ${exportQueue.kind} = 'db_backup' then 0 else 1 end`,
        asc(exportQueue.id),
      )
      .all();
    for (const item of items) await attempt(item);
  }

  function run(which: "pending" | "all"): Promise<void> {
    if (!enabled) return Promise.resolve();
    if (running) {
      if (nextPass !== "all") nextPass = which;
      return running;
    }
    running = (async () => {
      try {
        let pass: "pending" | "all" | null = which;
        while (pass) {
          nextPass = null;
          await processItems(pass);
          pass = nextPass;
        }
      } catch (error) {
        // E.g. the database was closed at shutdown: never an unhandled rejection.
        log.error(
          `Export queue run failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function status(): ExportQueueStatusResponse {
    if (!enabled) return { enabled: false, items: [], hasFailures: false };
    const items: ExportQueueItem[] = db
      .select()
      .from(exportQueue)
      .where(ne(exportQueue.status, "done"))
      .orderBy(asc(exportQueue.id))
      .all()
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        reference: row.reference,
        status: row.status,
        attempts: row.attempts,
        fileName: exportFileName(row.kind, row.reference),
        lastError: row.lastError,
        lastErrorCause: row.lastErrorCause,
        createdAt: row.createdAt,
        lastAttemptAt: row.lastAttemptAt,
      }));
    return { enabled: true, items, hasFailures: items.some((item) => item.status === "failed") };
  }

  async function backupIfFirstToday(): Promise<void> {
    if (!enabled) return;
    const root = folder();
    if (root === null) return;
    const at = now();
    if (hasBackupToday(root, at)) return;
    enqueue("db_backup", todayCivilDate(at));
    await run("pending");
  }

  return {
    enqueueDailySpreadsheet: (date) => enqueue("daily_spreadsheet", date),
    enqueueMonthlySpreadsheet: (yearMonth) => enqueue("monthly_spreadsheet", yearMonth),
    enqueueBackup: (date) => enqueue("db_backup", date),
    backupIfFirstToday,
    async folderChanged() {
      await backupIfFirstToday();
      await run("all");
    },
    oneDriveFolder: () => (enabled ? folder() : null),
    processPending: () => run("pending"),
    processAll: () => run("all"),
    idle: async () => {
      await running;
    },
    start() {
      if (!enabled || cancelSchedule) return;
      void run("all");
      cancelSchedule = schedule(() => void run("all"), EXPORT_RETRY_MINUTES * 60_000);
    },
    async stop() {
      cancelSchedule?.();
      cancelSchedule = null;
      await running;
    },
    status,
  };
}
