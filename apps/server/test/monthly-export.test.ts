import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportQueueStatusResponseSchema, type ExportQueueStatusResponse } from "@color-bms/core";
import { defaultMigrationsFolder } from "../src/db/migrate";
import { writeFileAtomic } from "../src/modules/export/atomic-write";
import {
  createExportQueue,
  type ExportQueueOptions,
  type ExportQueueService,
} from "../src/modules/export/export-queue.service";
import { closeDayWithCount } from "./cash-closing-fixture";
import { createCashWithdrawal } from "./cash-withdrawals-fixture";
import { fixedEntry, postConvert } from "./fixed-expenses-fixture";
import { expenseCategoryId, postExpense } from "./expenses-fixture";
import { createSale, NOW, TODAY, useSalesApp } from "./sales-fixture";

/**
 * FR-29 (#28): "Mensal AAAA-MM.xlsx" is written (through the export queue, FR-30) every time a
 * day of the month is closed, and in its final version when the month is closed (FR-16).
 * The clock is 18/11/2026 15:00, so October has ended and can be closed.
 */

const silentLog = { info: () => {}, error: () => {} };

let tempDir: string;
let oneDrive: string;
/** Replaces the file writer in a test (e.g. to simulate a file open in Excel). */
let writeFile: ExportQueueOptions["writeFile"];
let queue: ExportQueueService;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-monthly-"));
  oneDrive = path.join(tempDir, "OneDrive", "Color");
  fs.mkdirSync(oneDrive, { recursive: true });
  writeFile = undefined;
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
    folder: () => oneDrive,
    enabled: true,
    now: () => NOW,
    log: silentLog,
    writeFile: (file, data) => (writeFile ?? writeFileAtomic)(file, data),
    schedule: () => () => {},
    ...overrides,
  });
}

const ctx = useSalesApp({
  exports: (connection) => {
    queue = makeQueue(connection);
    return queue;
  },
});

const NOVEMBER_FILE = () => path.join(oneDrive, "2026", "11 - Novembro", "Mensal 2026-11.xlsx");
const OCTOBER_FILE = () => path.join(oneDrive, "2026", "10 - Outubro", "Mensal 2026-10.xlsx");

/** Waits for the exports that run after a closing (not awaited by the request). */
async function settled(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await queue.idle();
}

async function readWorkbook(file: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  return workbook;
}

/** The value in column `column` of the row whose column A is `label`, in sheet `name`. */
async function valueIn(
  file: string,
  name: string,
  label: string,
  column = 2,
): Promise<ExcelJS.CellValue> {
  const sheet = (await readWorkbook(file)).getWorksheet(name);
  if (!sheet) throw new Error(`No sheet "${name}"`);
  let found: ExcelJS.CellValue = undefined;
  sheet.eachRow((row) => {
    if (found === undefined && row.getCell(1).value === label) found = row.getCell(column).value;
  });
  return found;
}

function monthlyRows() {
  return ctx.connection.sqlite
    .prepare(
      "select reference, status, attempts from export_queue where kind = 'monthly_spreadsheet' order by id",
    )
    .all();
}

async function getStatus(): Promise<ExportQueueStatusResponse> {
  const response = await ctx.app.inject({ method: "GET", url: "/api/exports/status" });
  expect(response.statusCode, response.body).toBe(200);
  return exportQueueStatusResponseSchema.parse(response.json());
}

/** A cash Toner sale on `date`, then the day closed with no opening cash. */
async function saleAndClose(date: string, grossCents: number) {
  await createSale(ctx, { date, grossCents });
  await closeDayWithCount(ctx, date, { openingCashCents: 0, countedCashCents: grossCents });
  await settled();
}

function post(url: string, payload: Record<string, unknown> = {}) {
  return ctx.app.inject({ method: "POST", url, payload });
}

async function closeOctober() {
  const response = await post("/api/months/2026-10/close");
  expect(response.statusCode, response.body).toBe(200);
}

describe("FR-29: the monthly spreadsheet on every day closing", () => {
  it("FR-29: closing a day creates Mensal AAAA-MM.xlsx next to the daily file, with the month reports", async () => {
    await createSale(ctx, { grossCents: 4321 });
    const expense = await postExpense(ctx, {
      paymentDate: TODAY,
      expenseCategoryId: await expenseCategoryId(ctx, "Abastecimento moto"),
      amountCents: 1000,
      paymentMeans: "pix",
      paidFromTill: false,
    });
    expect(expense.statusCode, expense.body).toBe(201);
    await closeDayWithCount(ctx, TODAY, { openingCashCents: 0, countedCashCents: 4321 });
    await settled();

    const file = NOVEMBER_FILE();
    expect(fs.readdirSync(path.dirname(file)).sort()).toEqual([
      `Diária ${TODAY}.xlsx`,
      "Mensal 2026-11.xlsx",
    ]);
    const workbook = await readWorkbook(file);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Entradas",
      "Despesas gerais",
      "Despesas fixas",
      "Resumo",
    ]);
    // §7.3: numbers, not text, so the owner's sums in Excel work.
    expect(await valueIn(file, "Entradas", "Entrada mensal (bruta)")).toBe(43.21);
    expect(await valueIn(file, "Despesas gerais", "Total geral")).toBe(10);
    expect(await valueIn(file, "Despesas gerais", "Abastecimento moto")).toBe(10);
    // November's generated bills are all pending: nothing paid yet (RN-09).
    expect(await valueIn(file, "Despesas fixas", "Total pago no mês", 4)).toBe(0);
    expect(await valueIn(file, "Resumo", "Saldo mensal")).toBe(33.21);
    expect(await valueIn(file, "Resumo", "Situação")).toBe(
      "Versão parcial: mês aberto, atualizada em 18/11/2026 15:00",
    );
    // FR-30: the daily file first, then the monthly one; both done.
    expect(
      ctx.connection.sqlite.prepare("select kind, reference, status from export_queue").all(),
    ).toEqual([
      { kind: "daily_spreadsheet", reference: TODAY, status: "done" },
      { kind: "monthly_spreadsheet", reference: "2026-11", status: "done" },
    ]);
  });

  it("FR-29: closing another day of the month overwrites the file with the new totals", async () => {
    await saleAndClose("2026-11-17", 1000);
    expect(await valueIn(NOVEMBER_FILE(), "Entradas", "Entrada mensal (bruta)")).toBe(10);

    await saleAndClose(TODAY, 2500);
    expect(await valueIn(NOVEMBER_FILE(), "Entradas", "Entrada mensal (bruta)")).toBe(35);
    expect(monthlyRows()).toEqual([
      { reference: "2026-11", status: "done", attempts: 1 },
      { reference: "2026-11", status: "done", attempts: 1 },
    ]);
  });

  it("FR-29: a day of another month updates that month's file", async () => {
    await saleAndClose("2026-10-10", 2500);
    expect(await valueIn(OCTOBER_FILE(), "Entradas", "Entrada mensal (bruta)")).toBe(25);
    expect(fs.existsSync(NOVEMBER_FILE())).toBe(false);
  });

  it("FR-29: reopening a day changes nothing until it is closed again", async () => {
    await saleAndClose(TODAY, 2500);
    const reopen = await post(`/api/days/${TODAY}/reopen`, { reason: "Faltou uma venda" });
    expect(reopen.statusCode, reopen.body).toBe(200);
    await settled();
    expect(monthlyRows()).toHaveLength(1);

    await saleAndClose(TODAY, 500);
    expect(await valueIn(NOVEMBER_FILE(), "Entradas", "Entrada mensal (bruta)")).toBe(30);
  });
});

describe("FR-29 / FR-16: the final version when the month is closed", () => {
  it("FR-29: closing the month writes the final version", async () => {
    await saleAndClose("2026-10-10", 2500);
    expect(await valueIn(OCTOBER_FILE(), "Resumo", "Situação")).toMatch(/^Versão parcial/);

    await closeOctober();
    await vi.waitFor(() => expect(monthlyRows()).toHaveLength(2));
    await settled();
    expect(monthlyRows()).toEqual([
      { reference: "2026-10", status: "done", attempts: 1 },
      { reference: "2026-10", status: "done", attempts: 1 },
    ]);
    expect(await valueIn(OCTOBER_FILE(), "Resumo", "Situação")).toBe(
      "Versão final: mês fechado em 18/11/2026 15:00",
    );
    expect(await valueIn(OCTOBER_FILE(), "Resumo", "Entrada mensal (bruta)")).toBe(25);
    // The app's own hook (the backup, #22) still runs.
    expect(ctx.monthClosedCalls).toEqual(["2026-10"]);
  });

  it("FR-16: the app's hook (the backup, #22) runs before the export is written", async () => {
    let fileWhenHookRan: boolean | null = null;
    ctx.afterMonthClosed = () => {
      fileWhenHookRan = fs.existsSync(OCTOBER_FILE());
    };
    await closeOctober();
    await vi.waitFor(() => expect(ctx.monthClosedCalls).toEqual(["2026-10"]));
    await settled();
    expect(fileWhenHookRan).toBe(false);
    expect(fs.existsSync(OCTOBER_FILE())).toBe(true);
  });

  it("FR-16: a failing hook still writes the final file", async () => {
    ctx.afterMonthClosed = () => {
      throw new Error("backup failed");
    };
    await closeOctober();
    await vi.waitFor(() =>
      expect(monthlyRows()).toEqual([{ reference: "2026-10", status: "done", attempts: 1 }]),
    );
    expect(await valueIn(OCTOBER_FILE(), "Resumo", "Situação")).toMatch(/^Versão final/);
  });

  it("FR-29: a month reopened, corrected and closed again overwrites the final file", async () => {
    await saleAndClose("2026-10-10", 2500);
    await closeOctober();
    await vi.waitFor(() => expect(ctx.monthClosedCalls).toEqual(["2026-10"]));
    await settled();

    // FR-17: reopening the month rewrites the file as the partial version.
    const reopenMonth = await post("/api/months/2026-10/reopen", { reason: "Venda esquecida" });
    expect(reopenMonth.statusCode, reopenMonth.body).toBe(200);
    await vi.waitFor(() => expect(monthlyRows()).toHaveLength(3));
    await settled();
    expect(await valueIn(OCTOBER_FILE(), "Resumo", "Situação")).toBe(
      "Versão parcial: mês aberto, atualizada em 18/11/2026 15:00",
    );

    const reopenDay = await post("/api/days/2026-10-10/reopen", { reason: "Venda esquecida" });
    expect(reopenDay.statusCode, reopenDay.body).toBe(200);
    await createSale(ctx, { date: "2026-10-10", grossCents: 1000 });
    await closeDayWithCount(ctx, "2026-10-10", { openingCashCents: 0, countedCashCents: 3500 });
    await settled();
    expect(await valueIn(OCTOBER_FILE(), "Resumo", "Situação")).toMatch(/^Versão parcial/);

    await closeOctober();
    await vi.waitFor(() => expect(ctx.monthClosedCalls).toEqual(["2026-10", "2026-10"]));
    await settled();
    expect(await valueIn(OCTOBER_FILE(), "Resumo", "Entrada mensal (bruta)")).toBe(35);
    expect(await valueIn(OCTOBER_FILE(), "Resumo", "Situação")).toMatch(/^Versão final/);
  });

  it("FR-16: a failing export never undoes the month closing", async () => {
    writeFile = () => {
      throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    };
    await closeOctober();
    await vi.waitFor(() => expect(ctx.monthClosedCalls).toEqual(["2026-10"]));
    await settled();
    const month = ctx.connection.sqlite
      .prepare("select status from months where year_month = '2026-10'")
      .get() as { status: string };
    expect(month.status).toBe("closed");
    expect(monthlyRows()).toEqual([{ reference: "2026-10", status: "failed", attempts: 1 }]);
  });
});

describe("FR-29: other day closings", () => {
  it("#13: converting a CONTA: sangria of a closed day rewrites the month's file", async () => {
    const day = "2026-11-10";
    await createSale(ctx, { date: day, grossCents: 50000 });
    const conta = await createCashWithdrawal(ctx, {
      date: day,
      amountCents: 18743,
      note: "CONTA: Luz outubro",
    });
    await closeDayWithCount(ctx, day, { openingCashCents: 0, countedCashCents: 31257 });
    await settled();
    expect(await valueIn(NOVEMBER_FILE(), "Despesas fixas", "Total pago no mês", 4)).toBe(0);

    const luz = await fixedEntry(ctx, "Luz");
    const response = await postConvert(ctx, conta.id, {
      target: "existing",
      fixedExpenseId: luz.id,
    });
    expect(response.statusCode, response.body).toBe(200);
    await settled();
    // The re-closing (afterDayClosed) wrote the month again, with the bill paid (RN-09).
    expect(await valueIn(NOVEMBER_FILE(), "Despesas fixas", "Total pago no mês", 4)).toBe(187.43);
  });
});

describe("FR-30: the monthly file in the export queue", () => {
  it("FR-30: a monthly file open in Excel stays in the queue as Mensal AAAA-MM.xlsx, and Tentar agora writes it", async () => {
    writeFile = (file, data) => {
      if (path.basename(file).startsWith("Mensal")) {
        throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
      }
      writeFileAtomic(file, data);
    };
    await saleAndClose(TODAY, 2500);

    const status = await getStatus();
    expect(status.hasFailures).toBe(true);
    expect(status.items).toEqual([
      expect.objectContaining({
        kind: "monthly_spreadsheet",
        reference: "2026-11",
        status: "failed",
        fileName: "Mensal 2026-11.xlsx",
        lastError:
          "O arquivo Mensal 2026-11.xlsx está aberto no Excel (ou em uso pelo OneDrive). Feche o arquivo",
        lastErrorCause: "file_in_use",
      }),
    ]);

    writeFile = undefined; // The owner closed the file in Excel.
    const retry = await post("/api/exports/retry");
    expect(retry.statusCode, retry.body).toBe(200);
    expect(exportQueueStatusResponseSchema.parse(retry.json()).items).toEqual([]);
    expect(fs.existsSync(NOVEMBER_FILE())).toBe(true);
  });

  it("FR-30: a missing OneDrive folder is reported for the monthly file", async () => {
    fs.rmSync(oneDrive, { recursive: true });
    await saleAndClose(TODAY, 2500);
    const monthly = (await getStatus()).items.find((item) => item.kind === "monthly_spreadsheet");
    expect(monthly?.lastError).toBe(
      `A pasta do OneDrive não existe: ${oneDrive}. Verifique a pasta em Configurações`,
    );
    expect(monthly?.lastErrorCause).toBe("folder");
  });

  it("FR-30: a monthly item queued again while it fails reuses the same item", async () => {
    fs.rmSync(oneDrive, { recursive: true });
    await saleAndClose("2026-11-17", 1000);
    await saleAndClose(TODAY, 2500);
    expect(monthlyRows()).toEqual([{ reference: "2026-11", status: "failed", attempts: 2 }]);
  });

  it("#26: trial mode writes no monthly file", async () => {
    const trial = makeQueue(ctx.connection, { enabled: false });
    trial.enqueueMonthlySpreadsheet("2026-11");
    await trial.processAll();
    expect(monthlyRows()).toEqual([]);
    expect(fs.readdirSync(oneDrive)).toEqual([]);
  });
});

describe("FR-29: the months before the update get their spreadsheet", () => {
  it("FR-29: the queue_monthly_spreadsheets migration queues one item per month with a closed day or closed, oldest first", () => {
    const sqlite = ctx.connection.sqlite;
    const closedAt = NOW.toISOString();
    sqlite
      .prepare(
        `insert into days (date, status, closed_at) values
          ('2026-11-03', 'closed', ?), ('2026-11-04', 'closed', ?),
          ('2026-10-30', 'closed', ?), ('2026-12-01', 'open', null)`,
      )
      .run(closedAt, closedAt, closedAt);
    sqlite
      .prepare(
        "insert into months (year_month, status, closed_at) values ('2026-09', 'closed', ?) on conflict do nothing",
      )
      .run(closedAt);
    const migration = fs.readFileSync(
      path.join(defaultMigrationsFolder(), "0015_queue_monthly_spreadsheets.sql"),
      "utf8",
    );
    sqlite.exec(migration);
    expect(monthlyRows()).toEqual([
      { reference: "2026-09", status: "pending", attempts: 0 },
      { reference: "2026-10", status: "pending", attempts: 0 },
      { reference: "2026-11", status: "pending", attempts: 0 },
    ]);
  });
});
