import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import type { APIRequestContext } from "@playwright/test";
import { expect, test, type Catalog } from "./fixtures";

/**
 * FR-29 (#28) in the real built app: closing a day writes "Mensal AAAA-MM.xlsx" (partial
 * version) next to the daily file, and closing the month, keyboard only, writes the final
 * version. It uses February 2026, a month no other test touches, and reopens it at the end,
 * so tests sharing the worker's database are never locked out. The layout is covered by the
 * core and server tests.
 */

function monthlyFile(oneDriveDir: string): string {
  return path.join(oneDriveDir, "2026", "02 - Fevereiro", "Mensal 2026-02.xlsx");
}

/** The "Resumo" sheet's value beside `label`, or null while the file is missing or partial. */
async function resumoValue(file: string, label: string): Promise<ExcelJS.CellValue | null> {
  if (!fs.existsSync(file)) return null;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(file);
  } catch {
    return null; // Being replaced right now (atomic rename): try again.
  }
  let found: ExcelJS.CellValue | null = null;
  workbook.getWorksheet("Resumo")?.eachRow((row) => {
    if (found === null && row.getCell(1).value === label) found = row.getCell(2).value;
  });
  return found;
}

async function saleAndClose(api: APIRequestContext, catalog: Catalog, date: string) {
  const sale = await api.post("/api/sales", {
    data: {
      date,
      saleCategoryId: catalog.tab("Toner"),
      paymentMethodId: catalog.method("Dinheiro"),
      grossCents: 4000,
    },
  });
  expect(sale.status(), await sale.text()).toBe(201);
  const closing = await api.post(`/api/days/${date}/close`, {
    data: { openingCashCents: 0, countedCashCents: 4000 },
  });
  expect(closing.status(), await closing.text()).toBe(200);
}

test("FR-29: closing a day writes the partial monthly spreadsheet; closing the month, the final one", async ({
  api,
  catalog,
  page,
  server,
}) => {
  const file = monthlyFile(server.oneDriveDir);
  await saleAndClose(api, catalog, "2026-02-10");
  // The export runs right after the closing answers.
  await expect.poll(() => resumoValue(file, "Situação")).toMatch(/^Versão parcial: mês aberto/);
  expect(await resumoValue(file, "Entrada mensal (bruta)")).toBe(40);

  // FR-16, keyboard only: "Fechar mês" → Enter → "Tem certeza?" → Enter.
  await page.goto("/fechamento?data=2026-02-10");
  const month = page.getByRole("region", { name: "Fechamento do mês" });
  await month.getByRole("button", { name: "Fechar mês" }).focus();
  await page.keyboard.press("Enter");
  await expect(month.getByRole("button", { name: "Confirmar fechamento" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(month.getByRole("status")).toHaveText("Mês 02/2026 fechado.");

  await expect
    .poll(() => resumoValue(file, "Situação"))
    .toMatch(/^Versão final: mês fechado em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  expect(await resumoValue(file, "Saldo mensal")).toBe(40);

  // Leave February open for any other test on this worker's database.
  const reopen = await api.post("/api/months/2026-02/reopen", { data: { reason: "fim do teste" } });
  expect(reopen.status(), await reopen.text()).toBe(200);
});
