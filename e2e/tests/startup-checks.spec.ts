import { expect, test } from "./fixtures";

/**
 * #26 in the real built app: Início lists the startup checks. The worker's server runs in
 * real mode (no COLOR_BMS_TRIAL) with a writable data folder and OneDrive stand-in. Trial mode,
 * the failure cases and the pilot scripts are covered by the server tests and `npm run
 * pilot:smoke`.
 */
test("#26: Início shows the startup checks, and no TREINO badge in real use", async ({
  page,
  server,
}) => {
  await page.goto("/");
  const checks = page.getByRole("list", { name: "Verificações" });
  await expect(checks.getByRole("listitem")).toHaveCount(5);
  // The clock line's status is not asserted: catalog and payment writes still stamp their
  // audit rows with the OS clock, not COLOR_BMS_NOW (backlog #26 follow-up), so after other
  // tests in this worker it may (rightly) report records "in the future".
  await expect(checks).toContainText(/relógio do PC/i);
  await expect(checks).toContainText(`Porta ${new URL(server.baseURL).port}:`);
  await expect(checks).toContainText(`Pasta de dados gravável: ${server.dataDir}`);
  await expect(checks).toContainText(`Pasta do OneDrive gravável: ${server.oneDriveDir}`);
  await expect(page.getByRole("banner")).not.toContainText("TREINO");
});
