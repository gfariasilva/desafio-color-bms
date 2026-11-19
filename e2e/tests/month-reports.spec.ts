import type { APIRequestContext } from "@playwright/test";
import type { ExpenseCategory } from "@color-bms/core";
import { expect, test } from "./fixtures";

/**
 * FR-20 / FR-21 (month reports) in the real built app (ADR 0002), reached with the keyboard.
 * Its own month (May), so other tests sharing the worker's database never touch it.
 */

const MONTH = "2026-05";

async function post(api: APIRequestContext, url: string, data: unknown) {
  const response = await api.post(url, { data });
  expect(response.status(), await response.text()).toBe(201);
}

test("FR-20 / FR-21: the month reports add up, keyboard-first", async ({ page, api, catalog }) => {
  const sale = (day: string, tab: string, method: string, grossCents: number) =>
    post(api, "/api/sales", {
      date: `${MONTH}-${day}`,
      saleCategoryId: catalog.tab(tab),
      paymentMethodId: catalog.method(method),
      grossCents,
    });
  await sale("04", "Toner", "Dinheiro", 5000);
  await sale("04", "Papelaria", "PIX/Depósito", 2000);
  await sale("20", "Toner", "Dinheiro", 1500);

  const { categories } = (await (await api.get("/api/expense-categories")).json()) as {
    categories: ExpenseCategory[];
  };
  const category = (name: string) => categories.find((c) => c.name === name)!.id;
  await post(api, "/api/expenses", {
    paymentDate: `${MONTH}-06`,
    expenseCategoryId: category("Kalunga"),
    amountCents: 30000,
    paymentMeans: "boleto",
    description: "papel A4",
  });
  await post(api, "/api/expenses", {
    paymentDate: `${MONTH}-07`,
    expenseCategoryId: category("Alimentação"),
    amountCents: 2500,
    paymentMeans: "cash",
  });

  // Alt+6 opens Relatórios; the "Mês – Entradas" link, then Enter.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
  await page.keyboard.press("Alt+6");
  await expect(page.getByRole("heading", { level: 1, name: "Relatórios" })).toBeVisible();
  await page.getByRole("link", { name: /Mês – Entradas/ }).focus();
  await page.keyboard.press("Enter");

  // The month starts on the current one and is focused.
  const month = page.getByLabel("Mês");
  await expect(month).toBeFocused();
  await expect(month).toHaveValue("2026-11");
  await month.fill(MONTH);
  await expect(page).toHaveURL(new RegExp(`mes=${MONTH}`));

  // FR-20: the grid and its totals (RN-06).
  const grid = page.getByRole("table", { name: "Entradas por dia e aba" });
  await expect(grid.getByRole("row", { name: /04\/05\/2026/ })).toContainText("R$ 70,00");
  await expect(grid.getByRole("row", { name: /Total do mês/ })).toContainText("R$ 65,00");
  await expect(page.getByTestId("grid-total")).toHaveText("R$ 85,00");
  await expect(page.getByTestId("month-gross")).toHaveText("R$ 85,00");
  await expect(page.getByTestId("month-fee")).toHaveText("R$ 0,00");
  await expect(page.getByTestId("month-net")).toHaveText("R$ 85,00");
  const methods = page.getByRole("table", { name: "Totais por forma de pagamento" });
  await expect(methods.getByRole("row", { name: /Dinheiro/ })).toContainText("R$ 65,00");

  // FR-21: back to Relatórios, then "Mês – Despesas gerais".
  await page.keyboard.press("Alt+6");
  await page.getByRole("link", { name: /Mês – Despesas gerais/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Mês")).toBeFocused();
  await page.getByLabel("Mês").fill(MONTH);

  await expect(page.getByTestId("suppliers-subtotal")).toHaveText("R$ 300,00");
  await expect(page.getByTestId("general-expenses-total")).toHaveText("R$ 325,00");

  // Drill-down with the keyboard: focus the category's button, Enter opens its entries.
  await page.getByRole("button", { name: "Ver lançamentos de Kalunga" }).focus();
  await page.keyboard.press("Enter");
  const entries = page.getByRole("table", { name: "Lançamentos de Kalunga" });
  await expect(entries).toContainText("papel A4");
  await expect(entries).toContainText("06/05/2026");
});
