import fs from "node:fs";
import path from "node:path";
import { expect, startServer, test, type StartedServer } from "./fixtures";

/**
 * FR-32 in the real built app: restore a backup from Configurações › Backup e restauração,
 * keyboard only. A restore replaces the whole database, so this test runs its own server
 * (not the worker's shared one). The server restarts in its own process (ADR 0005).
 */

let server: StartedServer;

// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern here
test.beforeEach(async ({}, testInfo) => {
  server = await startServer(3400 + testInfo.workerIndex);
});

test.afterEach(async ({ context }) => {
  // Close the browser first: `afterEach` runs before the page fixture closes, and a socket
  // Chromium opened ahead of time (no request yet) keeps the server's close() waiting.
  await context.close();
  await server.stop();
});

test("FR-32: restore a backup from the list and see the earlier state", async ({
  page,
  playwright,
}) => {
  const api = await playwright.request.newContext({ baseURL: server.baseURL });
  try {
    // The first start of the day wrote a backup (FR-31). A withdrawal made after it…
    const backupDir = path.join(server.oneDriveDir, "_backup-sistema");
    await expect
      .poll(() => fs.existsSync(path.join(backupDir, "color-2026-11-18_1500.db")))
      .toBe(true);
    const withdrawal = await api.post("/api/cash-withdrawals", {
      data: { date: "2026-11-18", amountCents: 5000, note: "depois do backup" },
    });
    expect(withdrawal.status(), await withdrawal.text()).toBe(201);

    // …is gone once that backup is restored.
    await page.goto(`${server.baseURL}/configuracoes/backup`);
    const restore = page.getByRole("button", {
      name: "Restaurar o backup de 18/11/2026 15:00 (OneDrive)",
    });
    await restore.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Motivo da restauração")).toBeFocused();
    await page.keyboard.type("Sangria lançada por engano");
    await page.keyboard.press("Enter");

    await expect(page.getByText("Backup de 18/11/2026 15:00 restaurado.")).toBeVisible({
      timeout: 15_000,
    });
    const list = await api.get("/api/days/2026-11-18/cash-withdrawals");
    expect(JSON.stringify(await list.json())).not.toContain("depois do backup");
    // The safety copy of the database from before the restore is listed (Este PC).
    await expect(
      page.getByRole("button", { name: "Restaurar o backup de 18/11/2026 15:00 (Este PC)" }),
    ).toBeVisible();

    // FR-18: the restore is in the audit log, with its reason.
    await page.goto(`${server.baseURL}/configuracoes/auditoria`);
    await expect(page.getByRole("cell", { name: "Restauração" })).toBeVisible();
    await expect(page.getByText("Sangria lançada por engano")).toBeVisible();
  } finally {
    await api.dispose();
  }
});
