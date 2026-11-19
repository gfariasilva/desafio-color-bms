import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPORT_RETRY_MINUTES,
  exportQueueStatusResponseSchema,
  type ExportQueueStatusResponse,
} from "@color-bms/core";
import { defaultMigrationsFolder } from "../src/db/migrate";
import {
  createExportQueue,
  type ExportQueueOptions,
  type ExportQueueService,
} from "../src/modules/export/export-queue.service";
import { writeFileAtomic } from "../src/modules/export/atomic-write";
import { closeDayWithCount } from "./cash-closing-fixture";
import { createSale, NOW, TODAY, useSalesApp } from "./sales-fixture";

const silentLog = { info: () => {}, error: () => {} };
const FILE_NAME = "Diária 2026-11-18.xlsx";

let tempDir: string;
let oneDrive: string;
/** What the queue receives as the OneDrive folder (null = not configured). */
let configuredFolder: string | null;
/** Replaces the file writer in a test (e.g. to simulate a file open in Excel). */
let writeFile: ExportQueueOptions["writeFile"];
/** The queue the app was built with in the current test. */
let queue: ExportQueueService;
/** FR-30: the scheduled retry the queue registered with `start()`. */
let scheduled: { run: () => void; everyMs: number } | null;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-export-"));
  oneDrive = path.join(tempDir, "OneDrive", "Color");
  fs.mkdirSync(oneDrive, { recursive: true });
  configuredFolder = oneDrive;
  writeFile = undefined;
  scheduled = null;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function makeQueue(
  connection: Parameters<typeof createExportQueue>[0]["connection"],
  overrides: Partial<ExportQueueOptions> = {},
): ExportQueueService {
  return createExportQueue({
    connection,
    folder: () => configuredFolder,
    enabled: true,
    now: () => NOW,
    log: silentLog,
    writeFile: (file, data) => (writeFile ?? writeFileAtomic)(file, data),
    schedule: (run, everyMs) => {
      scheduled = { run, everyMs };
      return () => {
        scheduled = null;
      };
    },
    ...overrides,
  });
}

const ctx = useSalesApp({
  exports: (connection) => {
    queue = makeQueue(connection);
    return queue;
  },
});

function dailyFile(): string {
  return path.join(oneDrive, "2026", "11 - Novembro", FILE_NAME);
}

async function getStatus(): Promise<ExportQueueStatusResponse> {
  const response = await ctx.app.inject({ method: "GET", url: "/api/exports/status" });
  expect(response.statusCode, response.body).toBe(200);
  return exportQueueStatusResponseSchema.parse(response.json());
}

async function retryNow(): Promise<ExportQueueStatusResponse> {
  const response = await ctx.app.inject({ method: "POST", url: "/api/exports/retry" });
  expect(response.statusCode, response.body).toBe(200);
  return exportQueueStatusResponseSchema.parse(response.json());
}

/** Waits for the export that runs after a closing (it is not awaited by the request). */
async function settled(): Promise<void> {
  // Let the hook queue the item first (it runs right after the closing's answer).
  await new Promise((resolve) => setImmediate(resolve));
  await queue.idle();
}

async function readWorkbook(file: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  return workbook;
}

/** The value in column `column` of the row whose column A is `label`. */
function valueBeside(sheet: ExcelJS.Worksheet, label: string, column = 2): ExcelJS.CellValue {
  let found: ExcelJS.CellValue = undefined;
  sheet.eachRow((row) => {
    if (found === undefined && row.getCell(1).value === label) found = row.getCell(column).value;
  });
  return found;
}

function queueRows() {
  return ctx.connection.sqlite
    .prepare("select kind, reference, status, attempts from export_queue order by id")
    .all();
}

async function closeToday(countedCashCents: number) {
  await closeDayWithCount(ctx, TODAY, { openingCashCents: 0, countedCashCents });
  await settled();
}

describe("FR-28: export the daily spreadsheet", () => {
  it("FR-28: closing a day creates Diária AAAA-MM-DD.xlsx in AAAA/MM - Mês of the OneDrive folder", async () => {
    await createSale(ctx, { grossCents: 4321 });
    await closeToday(4321);

    const workbook = await readWorkbook(dailyFile());
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Toner",
      "Saídas",
      "Resumo do dia",
    ]);
    const resumo = workbook.getWorksheet("Resumo do dia")!;
    expect(valueBeside(resumo, "Dinheiro contado")).toBe(43.21);
    // Atomic write: only the final file is left in the folder.
    expect(fs.readdirSync(path.dirname(dailyFile()))).toEqual([FILE_NAME]);
    // FR-30: the item is done and leaves the list.
    expect(queueRows()).toEqual([
      { kind: "daily_spreadsheet", reference: TODAY, status: "done", attempts: 1 },
    ]);
    expect(await getStatus()).toEqual({ enabled: true, items: [], hasFailures: false });
  });

  it("FR-28: the file is overwritten if it already exists", async () => {
    fs.mkdirSync(path.dirname(dailyFile()), { recursive: true });
    fs.writeFileSync(dailyFile(), "planilha antiga");
    await createSale(ctx, { grossCents: 1000 });
    await closeToday(1000);

    const resumo = (await readWorkbook(dailyFile())).getWorksheet("Resumo do dia")!;
    expect(valueBeside(resumo, "Dinheiro contado")).toBe(10);
  });

  it("FR-28: a day reopened and closed again replaces the file with the corrected version", async () => {
    await createSale(ctx, { grossCents: 1000 });
    await closeToday(1000);

    const reopen = await ctx.app.inject({
      method: "POST",
      url: `/api/days/${TODAY}/reopen`,
      payload: { reason: "Faltou uma venda" },
    });
    expect(reopen.statusCode, reopen.body).toBe(200);
    await createSale(ctx, { grossCents: 500 });
    await closeToday(1500);

    const resumo = (await readWorkbook(dailyFile())).getWorksheet("Resumo do dia")!;
    expect(valueBeside(resumo, "Dinheiro contado")).toBe(15);
    // Total do dia: gross is in column B + 3 × methods… find it via the Toner sheet instead.
    const toner = (await readWorkbook(dailyFile())).getWorksheet("Toner")!;
    expect(valueBeside(toner, "Total da aba", 6)).toBe(15);
    // Two closings, two items, both done (history).
    expect(queueRows()).toEqual([
      { kind: "daily_spreadsheet", reference: TODAY, status: "done", attempts: 1 },
      { kind: "daily_spreadsheet", reference: TODAY, status: "done", attempts: 1 },
    ]);
  });

  it("FR-28: a day without movement makes no file", async () => {
    queue.enqueueDailySpreadsheet("2026-11-17");
    await queue.processAll();
    expect(fs.readdirSync(oneDrive)).toEqual([]);
    expect(queueRows()).toEqual([
      { kind: "daily_spreadsheet", reference: "2026-11-17", status: "done", attempts: 1 },
    ]);
  });

  it("FR-28: a day reopened before its export ran makes no file (the next closing will)", async () => {
    configuredFolder = path.join(tempDir, "sem pasta");
    await createSale(ctx);
    await closeToday(2500);
    const reopen = await ctx.app.inject({
      method: "POST",
      url: `/api/days/${TODAY}/reopen`,
      payload: { reason: "Corrigir" },
    });
    expect(reopen.statusCode, reopen.body).toBe(200);

    configuredFolder = oneDrive;
    expect((await retryNow()).items).toEqual([]);
    expect(fs.existsSync(dailyFile())).toBe(false);
  });
});

describe("FR-30: the export queue and its retries", () => {
  it("FR-30: the folder does not exist → the item stays in the queue with the error and the alert shows", async () => {
    configuredFolder = path.join(tempDir, "OneDrive renomeado");
    await createSale(ctx);
    await closeToday(2500);

    const status = await getStatus();
    expect(status.hasFailures).toBe(true);
    expect(status.items).toEqual([
      {
        id: expect.any(Number),
        kind: "daily_spreadsheet",
        reference: TODAY,
        status: "failed",
        attempts: 1,
        fileName: FILE_NAME,
        lastError: `A pasta do OneDrive não existe: ${configuredFolder}. Verifique a pasta em Configurações`,
        lastErrorCause: "folder",
        createdAt: NOW.toISOString(),
        lastAttemptAt: NOW.toISOString(),
      },
    ]);
    // The OneDrive folder itself is never created by the export.
    expect(fs.existsSync(configuredFolder)).toBe(false);
    // The closing itself is never undone (FR-08).
    const day = ctx.connection.sqlite
      .prepare("select status from days where date = ?")
      .get(TODAY) as { status: string };
    expect(day.status).toBe("closed");
  });

  it("FR-30: the file is open in Excel → the item fails with a clear message and the closing stands", async () => {
    writeFile = () => {
      throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    };
    await createSale(ctx);
    await closeToday(2500);

    const [item] = (await getStatus()).items;
    expect(item?.status).toBe("failed");
    expect(item?.lastErrorCause).toBe("file_in_use");
    expect(item?.lastError).toBe(
      `O arquivo ${FILE_NAME} está aberto no Excel (ou em uso pelo OneDrive). Feche o arquivo`,
    );
  });

  it("FR-30: no OneDrive folder configured → the item waits with the error", async () => {
    configuredFolder = null;
    await createSale(ctx);
    await closeToday(2500);

    const [item] = (await getStatus()).items;
    expect(item?.lastError).toBe("Pasta do OneDrive não configurada. Configure-a em Configurações");
    expect(item?.lastErrorCause).toBe("folder");
  });

  it("FR-30: when a retry succeeds, the item leaves the queue and the alert goes away (Tentar agora)", async () => {
    writeFile = () => {
      throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    };
    await createSale(ctx);
    await closeToday(2500);
    expect((await getStatus()).hasFailures).toBe(true);

    writeFile = undefined; // The owner closed the file in Excel.
    const status = await retryNow();
    expect(status).toEqual({ enabled: true, items: [], hasFailures: false });
    expect(fs.existsSync(dailyFile())).toBe(true);
    expect(queueRows()).toEqual([
      { kind: "daily_spreadsheet", reference: TODAY, status: "done", attempts: 2 },
    ]);
  });

  it("FR-30: a new try is made every 5 minutes", async () => {
    configuredFolder = path.join(tempDir, "ainda não existe");
    queue.start();
    expect(scheduled?.everyMs).toBe(EXPORT_RETRY_MINUTES * 60_000);
    await createSale(ctx);
    await closeToday(2500);
    expect((await getStatus()).hasFailures).toBe(true);

    configuredFolder = oneDrive;
    scheduled!.run();
    await queue.idle();
    expect((await getStatus()).items).toEqual([]);
    expect(fs.existsSync(dailyFile())).toBe(true);
  });

  it("FR-30: a new try is made when the system opens", async () => {
    configuredFolder = path.join(tempDir, "ainda não existe");
    await createSale(ctx);
    await closeToday(2500);
    expect((await getStatus()).hasFailures).toBe(true);

    // A restart: a new queue on the same database, started like main.ts does.
    configuredFolder = oneDrive;
    const restarted = makeQueue(ctx.connection);
    restarted.start();
    await restarted.idle();
    await restarted.stop();
    expect(restarted.status().items).toEqual([]);
    expect(fs.existsSync(dailyFile())).toBe(true);
  });

  it("FR-30: closing a day again while its item failed reuses the same item", async () => {
    configuredFolder = null;
    await createSale(ctx);
    await closeToday(2500);
    await ctx.app.inject({
      method: "POST",
      url: `/api/days/${TODAY}/reopen`,
      payload: { reason: "Corrigir" },
    });
    await closeToday(2500);
    expect(queueRows()).toEqual([
      { kind: "daily_spreadsheet", reference: TODAY, status: "failed", attempts: 2 },
    ]);
  });

  it("FR-28: a day closed again while its file is being written is written again", async () => {
    await createSale(ctx);
    let writes = 0;
    writeFile = (file, data) => {
      writes += 1;
      // The day is queued again while the first file is being written.
      if (writes === 1) queue.enqueueDailySpreadsheet(TODAY);
      writeFileAtomic(file, data);
    };
    await closeToday(2500);
    expect(writes).toBe(2);
    expect(queueRows()).toEqual([
      { kind: "daily_spreadsheet", reference: TODAY, status: "done", attempts: 2 },
    ]);
  });

  it("FR-30: a day closed again while its write is failing is tried again at once", async () => {
    await createSale(ctx);
    let writes = 0;
    writeFile = () => {
      writes += 1;
      if (writes === 1) {
        // The owner closes the day again (after fixing the cause) while this write fails.
        queue.enqueueDailySpreadsheet(TODAY);
        throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
      }
    };
    await closeToday(2500);
    expect(writes).toBe(2);
    expect(queueRows()).toEqual([
      { kind: "daily_spreadsheet", reference: TODAY, status: "done", attempts: 2 },
    ]);
  });

  it("FR-30: an unknown error is shown in pt-BR; the raw error only goes to the log", async () => {
    writeFile = () => {
      throw Object.assign(new Error("EIO: i/o error, write"), { code: "EIO" });
    };
    await createSale(ctx);
    await closeToday(2500);
    const [item] = (await getStatus()).items;
    expect(item?.lastError).toBe(
      `Não foi possível gravar ${FILE_NAME}. Se continuar, avise o desenvolvedor`,
    );
    expect(item?.lastErrorCause).toBe("other");
  });

  it("FR-30: a malformed item is recorded as failed and the queue goes on", async () => {
    await createSale(ctx);
    // A corrupt row: an impossible date that is closed and has a sale (e.g. a manual DB edit).
    const sqlite = ctx.connection.sqlite;
    const columns = (sqlite.prepare("pragma table_info(sales)").all() as { name: string }[])
      .map((column) => column.name)
      .filter((name) => name !== "id");
    const values = columns.map((name) => (name === "date" ? "'2026-02-30'" : name));
    sqlite.exec(
      `insert into sales (${columns.join(", ")}) select ${values.join(", ")} from sales limit 1`,
    );
    sqlite
      .prepare("insert into days (date, status, closed_at) values ('2026-02-30', 'closed', ?)")
      .run(NOW.toISOString());
    queue.enqueueDailySpreadsheet("2026-02-30");

    await closeToday(2500);
    expect(queueRows()).toEqual([
      { kind: "daily_spreadsheet", reference: "2026-02-30", status: "failed", attempts: 1 },
      { kind: "daily_spreadsheet", reference: TODAY, status: "done", attempts: 1 },
    ]);
    expect(fs.existsSync(dailyFile())).toBe(true);
  });

  it("FR-30: changing the folder in Configurações retries at once", async () => {
    const newFolder = path.join(tempDir, "Nova pasta");
    configuredFolder = newFolder;
    await createSale(ctx);
    await closeToday(2500);
    expect((await getStatus()).hasFailures).toBe(true);

    fs.mkdirSync(newFolder);
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { oneDriveFolder: newFolder, cashDifferenceLimitCents: 0, dueSoonDays: 3 },
    });
    expect(response.statusCode, response.body).toBe(200);
    await vi.waitFor(async () => expect((await getStatus()).items).toEqual([]));
    expect(fs.existsSync(path.join(newFolder, "2026", "11 - Novembro", FILE_NAME))).toBe(true);
  });

  it("#26: trial mode queues nothing", async () => {
    const trial = makeQueue(ctx.connection, { enabled: false });
    trial.enqueueDailySpreadsheet(TODAY);
    await trial.processAll();
    expect(trial.status()).toEqual({ enabled: false, items: [], hasFailures: false });
    expect(queueRows()).toEqual([]);
  });
});

describe("FR-28: the days closed before the update get their spreadsheet", () => {
  it("FR-28: the queue_closed_days migration queues every closed day, oldest first", () => {
    const sqlite = ctx.connection.sqlite;
    sqlite
      .prepare(
        "insert into days (date, status, closed_at) values (?, 'closed', ?), (?, 'open', null), (?, 'closed', ?)",
      )
      .run("2026-11-03", NOW.toISOString(), "2026-11-04", "2026-11-02", NOW.toISOString());
    const migration = fs.readFileSync(
      path.join(defaultMigrationsFolder(), "0014_queue_closed_days.sql"),
      "utf8",
    );
    sqlite.exec(migration);
    expect(
      sqlite.prepare("select reference, status, attempts from export_queue order by id").all(),
    ).toEqual([
      { reference: "2026-11-02", status: "pending", attempts: 0 },
      { reference: "2026-11-03", status: "pending", attempts: 0 },
    ]);
  });
});
