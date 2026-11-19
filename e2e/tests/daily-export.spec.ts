import fs from "node:fs";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { expect, test, type Catalog } from "./fixtures";

/**
 * FR-28 / FR-30 (#21) in the real built app: closing a day writes "Diária AAAA-MM-DD.xlsx" in
 * the OneDrive folder; when the folder is missing, Início shows "Backup pendente", and
 * "Tentar agora" writes it once the folder is back. The layout and the other failure cases
 * are covered by the core and server tests.
 */

function dailyFile(oneDriveDir: string, date: string): string {
  return path.join(oneDriveDir, "2026", "06 - Junho", `Diária ${date}.xlsx`);
}

/** An .xlsx file is a zip: it starts with "PK". */
function isXlsx(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  return fs.readFileSync(file).subarray(0, 2).toString("latin1") === "PK";
}

async function saleAndClose(api: APIRequestContext, catalog: Catalog, date: string) {
  const sale = await api.post("/api/sales", {
    data: {
      date,
      saleCategoryId: catalog.tab("Toner"),
      paymentMethodId: catalog.method("Dinheiro"),
      grossCents: 2500,
    },
  });
  expect(sale.status(), await sale.text()).toBe(201);
  const closing = await api.post(`/api/days/${date}/close`, {
    data: { openingCashCents: 0, countedCashCents: 2500 },
  });
  expect(closing.status(), await closing.text()).toBe(200);
}

test("FR-28: closing a day writes its daily spreadsheet in the OneDrive folder", async ({
  api,
  catalog,
  server,
}) => {
  const date = "2026-06-03";
  await saleAndClose(api, catalog, date);
  // The export runs right after the closing answers.
  await expect.poll(() => isXlsx(dailyFile(server.oneDriveDir, date))).toBe(true);
});

test("FR-30: a missing folder shows Backup pendente on Início; Tentar agora writes the file", async ({
  api,
  catalog,
  page,
  server,
}) => {
  const date = "2026-06-04";
  const away = `${server.oneDriveDir}-renomeada`;
  // The owner renamed the OneDrive folder by mistake (spec §7.4).
  fs.renameSync(server.oneDriveDir, away);
  try {
    await saleAndClose(api, catalog, date);
    await page.goto("/");
    const notice = page.getByRole("group", { name: "Backup pendente" });
    await expect(notice).toContainText(`Diária ${date}.xlsx: A pasta do OneDrive não existe`);
    await expect(notice).toContainText("Nova tentativa a cada 5 minutos.");
    await expect(notice.getByRole("link", { name: "Verificar a pasta" })).toHaveAttribute(
      "href",
      "/configuracoes",
    );
  } finally {
    fs.renameSync(away, server.oneDriveDir);
  }

  // Keyboard only: focus the button and press Enter.
  await page.getByRole("button", { name: "Tentar agora" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("group", { name: "Backup pendente" })).toHaveCount(0);
  expect(isXlsx(dailyFile(server.oneDriveDir, date))).toBe(true);
});
