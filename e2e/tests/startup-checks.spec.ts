import { expect, test } from "./fixtures";

/**
 * #26 in the real built app: Configurações lists the startup checks (on Início until #23).
 * The worker's server runs in real mode (no COLOR_BMS_TRIAL) with a writable data folder and
 * OneDrive stand-in. Trial mode, the failure cases and the pilot scripts are covered by the
 * server tests and `npm run pilot:smoke`.
 */
test("#26: Configurações shows the startup checks, and no TREINO badge in real use", async ({
  page,
  server,
}) => {
  await page.goto("/configuracoes");
  const checks = page.getByRole("list", { name: "Verificações" });
  await expect(checks.getByRole("listitem")).toHaveCount(5);
  await expect(checks).toContainText("OK: Relógio do PC: 18/11/2026 15:");
  await expect(checks).toContainText(`Porta ${new URL(server.baseURL).port}:`);
  await expect(checks).toContainText(`Pasta de dados gravável: ${server.dataDir}`);
  await expect(checks).toContainText(`Pasta do OneDrive gravável: ${server.oneDriveDir}`);
  await expect(page.getByRole("banner")).not.toContainText("TREINO");
});
