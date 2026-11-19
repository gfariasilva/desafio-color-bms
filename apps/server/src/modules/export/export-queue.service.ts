import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, ne } from "drizzle-orm";
import {
  dailySpreadsheetPath,
  EXPORT_RETRY_MINUTES,
  exportFileName,
  type CivilDate,
  type ExportErrorCause,
  type ExportKind,
  type ExportQueueItem,
  type ExportQueueStatusResponse,
} from "@color-bms/core";
import type { Clock } from "../../clock";
import type { DatabaseConnection } from "../../db/client";
import { exportQueue } from "../../db/schema";
import { writeFileAtomic } from "./atomic-write";
import { getDailySpreadsheet } from "./daily-spreadsheet.repository";
import { renderXlsx } from "./xlsx-writer";

/**
 * FR-28 / FR-30: the export queue. Every file for the OneDrive folder is a row of
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
  fileName: string,
  dir: string | null,
): { message: string; cause: ExportErrorCause } {
  if (error instanceof ExportError) return { message: error.message, cause: error.reason };
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
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
  const detail = error instanceof Error ? error.message : String(error);
  return { message: `Não foi possível gravar ${fileName} (${detail})`, cause: "other" };
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
  connection: { db },
  folder,
  enabled,
  now,
  log,
  writeFile = writeFileAtomic,
  schedule = defaultSchedule,
}: ExportQueueOptions): ExportQueueService {
  let running: Promise<void> | null = null;
  /** What was asked for during the current run: another pass over the pending or all items. */
  let nextPass: "pending" | "all" | null = null;
  let cancelSchedule: (() => void) | null = null;
  /** The item being written right now, and whether it was queued again meanwhile. */
  let inFlight: { id: number; requeued: boolean } | null = null;

  function enqueue(kind: ExportKind, reference: string): void {
    if (!enabled) return;
    const open = db
      .select({ id: exportQueue.id })
      .from(exportQueue)
      .where(
        and(
          eq(exportQueue.kind, kind),
          eq(exportQueue.reference, reference),
          ne(exportQueue.status, "done"),
        ),
      )
      .get();
    if (open) {
      if (inFlight?.id === open.id) inFlight.requeued = true;
      // A new request for a failed item: it is tried with the other new items.
      else
        db.update(exportQueue).set({ status: "pending" }).where(eq(exportQueue.id, open.id)).run();
      return;
    }
    db.insert(exportQueue)
      .values({ kind, reference, status: "pending", createdAt: now().toISOString() })
      .run();
  }

  /** Writes one item's file. Returns normally when written or when there is nothing to write. */
  async function exportItem(kind: ExportKind, reference: string, at: Date): Promise<void> {
    if (kind !== "daily_spreadsheet") {
      // #28 (monthly) and #22 (DB backup) add their writers here.
      throw new ExportError(`Exportação ainda não disponível: ${kind}`, "other");
    }
    const model = getDailySpreadsheet(db, reference, at);
    if (model === null) return; // No movement, or reopened: no file (FR-28, FR-09).
    const data = await renderXlsx(model);
    // Checked after rendering, right before writing: the folder may have changed meanwhile.
    const root = requireRootFolder(folder());
    const [year, month, fileName] = dailySpreadsheetPath(reference);
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
    inFlight = { id: item.id, requeued: false };
    try {
      await exportItem(item.kind, item.reference, at);
      if (inFlight.requeued) {
        // Closed again while being written: write it once more with the latest data.
        db.update(exportQueue)
          .set({
            status: "pending",
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
      const [year, month] =
        item.kind === "daily_spreadsheet" ? dailySpreadsheetPath(item.reference) : [];
      const dir = root && year && month ? path.join(root, year, month) : root;
      const { message, cause } = describeFailure(error, fileName, dir);
      db.update(exportQueue)
        .set({
          status: "failed",
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
      .orderBy(asc(exportQueue.id))
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

  return {
    enqueueDailySpreadsheet: (date) => enqueue("daily_spreadsheet", date),
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
