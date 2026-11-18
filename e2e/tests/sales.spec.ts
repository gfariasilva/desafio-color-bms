import { chars, closeDay, createFee, expect, openSales, pressKeys, test, TODAY } from "./fixtures";

/**
 * FR-01 / FR-02: registering sales in the real built app. After the page loads, the flows
 * use only the keyboard (NFR-05, ADR 0002).
 */

test("FR-01: keyboard-only cash sale (valor → aba → forma → Enter), ready for the next one", async ({
  page,
}) => {
  await openSales(page);

  // "25" · Tab · 7 = Toner · Tab · 1 = Dinheiro · Enter
  await pressKeys(page, [...chars("25"), "Tab", "7", "Tab", "1", "Enter"]);

  await expect(page.getByRole("status")).toHaveText("Venda de R$ 25,00 registrada.");
  // The form is ready for the next sale: focus on Valor, date kept, choices cleared.
  const value = page.getByLabel("Valor (R$)");
  await expect(value).toBeFocused();
  await expect(value).toHaveValue("");
  await expect(page.getByLabel("Data")).toHaveValue(TODAY);
  await expect(page.getByRole("radio", { name: /Toner/ })).toHaveAttribute("aria-checked", "false");

  // FR-05: the sale shows in the Toner tab of the day.
  const toner = page.getByRole("region", { name: /Toner/ });
  const row = toner.getByRole("row").filter({ hasText: "Dinheiro" });
  await expect(row.first()).toContainText("R$ 25,00");
});

test("FR-01 / FR-02: R$ 150,00 Toner on Crédito, Mercado Pago, 3x stores the fee in force", async ({
  page,
  api,
  catalog,
}) => {
  await createFee(api, {
    cardMachineId: catalog.machine("Mercado Pago"),
    paymentMethodId: catalog.method("Cartão de crédito"),
    installmentsFrom: 2,
    installmentsTo: 6,
    ratePpm: 37900,
    validFrom: "2026-01-01",
  });
  await openSales(page);

  // "150" · Tab · 7 = Toner · Tab · 3 = Crédito · Tab · 2 = Mercado Pago · Tab · "3" · Enter
  await pressKeys(page, [...chars("150"), "Tab", "7", "Tab", "3", "Tab", "2", "Tab", "3"]);
  await expect(page.getByTestId("fee-preview")).toHaveText(
    "Taxa 3,79% · R$ 5,69 · Líquido R$ 144,31",
  );
  await page.keyboard.press("Enter");

  await expect(page.getByRole("status")).toHaveText("Venda de R$ 150,00 registrada.");
  const row = page.getByRole("row").filter({ hasText: "Mercado Pago" }).filter({ hasText: "3x" });
  await expect(row.first()).toContainText("R$ 150,00");
  await expect(row.first()).toContainText("3,79%");
  await expect(row.first()).toContainText("R$ 5,69");
  await expect(row.first()).toContainText("R$ 144,31");
});

test("FR-01: without a fee in force the sale is blocked, with a link to the fee table", async ({
  page,
}) => {
  await openSales(page);
  // Crédito, PagSeguro, 7x: no fee row exists for it.
  await pressKeys(page, [...chars("80"), "Tab", "7", "Tab", "3", "Tab", "1", "Tab", "7", "Enter"]);

  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(
    "Cadastre a taxa de PagSeguro / Cartão de crédito / 7x antes de registrar esta venda Abrir tabela de taxas",
  );
  // The form keeps what was typed.
  await expect(page.getByLabel("Valor (R$)")).toHaveValue("80");

  // The shortcut opens the fee table, still with the keyboard.
  await page.getByRole("link", { name: "Abrir tabela de taxas" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/cadastros\/taxas$/);
});

test("FR-01: a closed day blocks the sale and says the day must be reopened", async ({
  page,
  server,
}) => {
  closeDay(server, "2026-11-17");
  await openSales(page);
  await page.getByLabel("Data").fill("2026-11-17");
  await page.getByLabel("Valor (R$)").focus();
  await pressKeys(page, [...chars("10"), "Tab", "7", "Tab", "1", "Enter"]);

  await expect(page.getByRole("alert")).toHaveText(
    "O dia 17/11/2026 está fechado. Reabra o dia para registrar ou alterar lançamentos nessa data.",
  );
});

test("RN-15: a future date is not accepted", async ({ page }) => {
  await openSales(page);
  await expect(page.getByLabel("Data")).toHaveAttribute("max", TODAY);
  await page.getByLabel("Data").fill("2026-11-19");
  await page.getByLabel("Valor (R$)").focus();
  await pressKeys(page, [...chars("10"), "Tab", "7", "Tab", "1", "Enter"]);

  await expect(page.getByRole("alert")).toHaveText(
    "Não é possível registrar lançamentos com data futura.",
  );
});
