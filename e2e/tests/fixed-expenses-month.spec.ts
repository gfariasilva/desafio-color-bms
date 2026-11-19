import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * FR-11 (the month's fixed expenses) in the real built app. The server starts on 18/11/2026
 * (TEST_NOW), so November was generated when it started. Tests in a worker share one
 * database: each test uses its own names and never relies on the list's length.
 */

async function openMonth(page: Page) {
  await page.goto("/despesas-fixas");
  await page.getByRole("link", { name: /Contas do mês/ }).click();
  await expect(page.getByRole("heading", { name: "Contas de novembro de 2026" })).toBeVisible();
  await expect(page.getByLabel("Conta", { exact: true })).toBeFocused();
}

function section(page: Page, name: string) {
  return page.locator("section", { has: page.getByRole("heading", { name }) });
}

test("FR-11: the month's bills were generated from the templates when the system opened", async ({
  page,
}) => {
  await openMonth(page);
  const general = section(page, "Gerais");
  for (const name of ["Água", "Luz", "Aluguel", "Telefonia – Vivo fixo", "Empréstimos"]) {
    const row = general.getByRole("row", { name: new RegExp(name) });
    await expect(row).toContainText("Pendente");
    // Q-05: the seeded templates have no due day yet.
    await expect(row).toContainText("Sem vencimento");
  }
  for (const name of ["DAS", "DARE", "DARF", "TFE"]) {
    await expect(section(page, "Taxas governo").getByRole("row", { name })).toContainText(
      "Pendente",
    );
  }
});

test("FR-11: opening the app again generates nothing twice", async ({ page, api }) => {
  await openMonth(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Contas de novembro de 2026" })).toBeVisible();
  const { expenses } = (await (await api.get("/api/fixed-expenses?month=2026-11")).json()) as {
    expenses: { label: string; oneOff: boolean }[];
  };
  const generatedLuz = expenses.filter((entry) => entry.label === "Luz" && !entry.oneOff);
  expect(generatedLuz).toHaveLength(1);
});

test("FR-11: adds a one-off bill with the keyboard and Enter", async ({ page, api }) => {
  await openMonth(page);
  await page.keyboard.type("Seguro carro E2E");
  await page.getByLabel("Vencimento", { exact: true }).fill("2026-12-05"); // RN-15: a future due date is fine
  await page.getByLabel("Valor previsto (R$)", { exact: true }).focus();
  await page.keyboard.type("1.250,90");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("status")).toHaveText("Conta avulsa Seguro carro E2E adicionada.");
  await expect(page.getByLabel("Conta", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Conta", { exact: true })).toHaveValue("");

  const row = section(page, "Gerais").getByRole("row", { name: /Seguro carro E2E/ });
  await expect(row).toContainText("05/12/2026");
  await expect(row).toContainText("R$ 1.250,90");
  await expect(row).toContainText("Avulsa");
  await expect(row).toContainText("Pendente");

  const audit = (await (await api.get("/api/audit?entity=expense&action=create")).json()) as {
    entries: { after: Record<string, unknown> }[];
  };
  expect(audit.entries.map((entry) => entry.after.description)).toContain("Seguro carro E2E");
});

test("FR-11: navigates to the previous month and back, never into the future", async ({ page }) => {
  await openMonth(page);
  await expect(page.getByRole("button", { name: "Próximo mês" })).toBeDisabled();
  await page.getByRole("button", { name: "Mês anterior" }).click();
  await expect(page.getByRole("heading", { name: "Contas de outubro de 2026" })).toBeVisible();
  await expect(page.getByText(/não foram geradas/)).toBeVisible();
  await page.getByRole("button", { name: "Próximo mês" }).click();
  await expect(page.getByRole("heading", { name: "Contas de novembro de 2026" })).toBeVisible();
});
