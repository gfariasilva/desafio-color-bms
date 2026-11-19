import type { Page } from "@playwright/test";
import { chars, expect, pressKeys, test } from "./fixtures";

/**
 * FR-10 (fixed-expense templates) in the real built app. Tests in a worker share one
 * database, so each test uses its own template names and never relies on the list's length.
 */

/** Opens Despesas fixas › Modelos, leaving the focus on Nome. */
async function openTemplates(page: Page) {
  await page.goto("/despesas-fixas/modelos");
  await expect(page.getByRole("heading", { name: "Gerais" })).toBeVisible();
  await expect(page.getByLabel("Nome")).toBeFocused();
}

function section(page: Page, name: string) {
  return page.locator("section", { has: page.getByRole("heading", { name }) });
}

test("RN-12: the initial templates are listed per group", async ({ page }) => {
  await openTemplates(page);
  const general = section(page, "Gerais");
  for (const name of ["Água", "Luz", "Aluguel", "Telefonia – Vivo fixo", "Empréstimos"]) {
    await expect(general.getByRole("row", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  const fees = section(page, "Taxas governo");
  for (const name of ["DAS", "DARE", "DARF", "TFE"]) {
    await expect(fees.getByRole("row", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
});

test("FR-10: adds a loan template, keyboard only", async ({ page }) => {
  await openTemplates(page);
  // Nome → Grupo → Subgrupo → Dia → Valor → Empréstimo (space) → Total → Restantes → Enter.
  // keyboard.type, not press: "é" and "ú" are typed characters, not key names.
  await page.keyboard.type("Empréstimo Itaú");
  await pressKeys(page, [
    "Tab",
    "Tab",
    "Tab",
    ...chars("5"),
    "Tab",
    ...chars("850,00"),
    "Tab",
    "Space",
    "Tab",
    ...chars("24"),
    "Tab",
    ...chars("10"),
    "Enter",
  ]);

  await expect(page.getByRole("status")).toHaveText("Modelo Empréstimo Itaú adicionado.");
  await expect(page.getByLabel("Nome")).toBeFocused();
  await expect(page.getByLabel("Nome")).toHaveValue("");

  const row = section(page, "Gerais").getByRole("row", { name: /^Empréstimo Itaú/ });
  await expect(row).toContainText("dia 5");
  await expect(row).toContainText("R$ 850,00");
  await expect(row).toContainText("10 de 24 restantes");
  await expect(row).toContainText("Ativo");
});

test("FR-10: edits a template with Editar and saves with Enter", async ({ page, api }) => {
  const created = await api.post("/api/fixed-expense-templates", {
    data: { name: "Internet E2E", group: "general", dueDay: 12 },
  });
  expect(created.status(), await created.text()).toBe(201);

  await openTemplates(page);
  await page.getByRole("button", { name: "Editar Internet E2E" }).click();
  await expect(page.getByRole("form", { name: "Editar modelo" })).toBeVisible();
  await page.getByLabel("Dia de vencimento").fill("15");
  await page.getByLabel("Valor previsto (R$)").fill("99,90");
  await page.getByLabel("Valor previsto (R$)").press("Enter");

  await expect(page.getByRole("status")).toHaveText("Modelo Internet E2E salvo.");
  await expect(page.getByRole("form", { name: "Novo modelo" })).toBeVisible();
  const row = section(page, "Gerais").getByRole("row", { name: /^Internet E2E/ });
  await expect(row).toContainText("dia 15");
  await expect(row).toContainText("R$ 99,90");
});

test("FR-10: deactivates a template; it stays listed as Inativo", async ({ page, api }) => {
  const created = await api.post("/api/fixed-expense-templates", {
    data: { name: "IPTU E2E", group: "government_fees", dueDay: 10 },
  });
  expect(created.status(), await created.text()).toBe(201);

  await openTemplates(page);
  await page.getByRole("button", { name: "Desativar IPTU E2E" }).click();
  const row = section(page, "Taxas governo").getByRole("row", { name: /^IPTU E2E/ });
  await expect(row).toContainText("Inativo");
  await expect(page.getByRole("button", { name: "Reativar IPTU E2E" })).toBeVisible();

  const active = (await (await api.get("/api/fixed-expense-templates?active=true")).json()) as {
    templates: { name: string }[];
  };
  expect(active.templates.map((template) => template.name)).not.toContain("IPTU E2E");
});

test("FR-10: a duplicate name is blocked with a pt-BR message", async ({ page }) => {
  await openTemplates(page);
  await page.getByLabel("Nome").fill("luz");
  await page.getByLabel("Dia de vencimento").fill("10");
  await page.getByLabel("Dia de vencimento").press("Enter");
  await expect(page.getByRole("alert")).toHaveText(
    "Já existe um modelo de despesa fixa com esse nome.",
  );
});
