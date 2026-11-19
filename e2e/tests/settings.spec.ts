import fs from "node:fs";
import { expect, test } from "./fixtures";

/**
 * FR-33 (#20) in the real built app, keyboard only. The worker's server gets its OneDrive
 * stand-in through COLOR_BMS_ONEDRIVE_DIR, which overrides the setting (read-only on screen);
 * editing the folder and the failure messages are covered by the server and component tests.
 */
test("FR-33: Testar the folder, then save the alert thresholds by keyboard", async ({
  page,
  api,
  server,
}) => {
  await page.goto("/configuracoes");

  const folder = page.getByLabel("Pasta do OneDrive");
  await expect(folder).toHaveValue(server.oneDriveDir);
  await expect(folder).toBeFocused();
  await expect(folder).toHaveAttribute("readonly", "");

  // Tab → Testar, Enter: the server writes and deletes a test file.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Testar" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(`Pasta OK: o sistema consegue gravar em ${server.oneDriveDir}.`),
  ).toBeVisible();
  expect(fs.readdirSync(server.oneDriveDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);

  // Tab → limit (selected on focus), Tab → days; Enter saves.
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Limite da diferença de caixa (R$)")).toBeFocused();
  await page.keyboard.type("5,00");
  await page.keyboard.press("Tab");
  await page.keyboard.type("5");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Configurações salvas.")).toBeVisible();
  await expect(folder).toBeFocused();
  const saved = (await (await api.get("/api/settings")).json()) as Record<string, unknown>;
  expect(saved).toMatchObject({ cashDifferenceLimitCents: 500, dueSoonDays: 5 });

  // FR-18: each changed setting is in Auditoria.
  await page.goto("/configuracoes/auditoria");
  await expect(page.getByText("Limite da diferença de caixa").first()).toBeVisible();
  await expect(page.getByText("Antecedência das contas a vencer (dias)").first()).toBeVisible();

  // Leave the worker's server as it was for the other tests.
  const reset = await api.put("/api/settings", {
    data: { oneDriveFolder: server.oneDriveDir, cashDifferenceLimitCents: 0, dueSoonDays: 3 },
  });
  expect(reset.status(), await reset.text()).toBe(200);
});
