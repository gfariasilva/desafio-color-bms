import type { APIRequestContext } from "@playwright/test";
import type { ExpenseCategory } from "@color-bms/core";
import { expect, test, TODAY } from "./fixtures";

/**
 * FR-19 (day report) in the real built app (ADR 0002): a closed day's matrix, expenses,
 * sangrias and cash closing, reached with the keyboard. Its own date (August),
 * so other tests sharing the worker's database never touch it.
 */

const DATE = "2026-08-12";

async function post(api: APIRequestContext, url: string, data: unknown, status = 201) {
  const response = await api.post(url, { data });
  expect(response.status(), await response.text()).toBe(status);
}

test("FR-19: the report of a closed day matches its records, keyboard-first", async ({
  page,
  api,
  catalog,
}) => {
  const sale = (tab: string, method: string, grossCents: number) =>
    post(api, "/api/sales", {
      date: DATE,
      saleCategoryId: catalog.tab(tab),
      paymentMethodId: catalog.method(method),
      grossCents,
    });
  await sale("Toner", "Dinheiro", 5000);
  await sale("Toner", "PIX/Depósito", 2000);
  await sale("Papelaria", "Dinheiro", 1500);
  const { categories } = (await (await api.get("/api/expense-categories")).json()) as {
    categories: ExpenseCategory[];
  };
  const moto = categories.find((category) => category.name === "Abastecimento moto")!;
  await post(api, "/api/expenses", {
    paymentDate: DATE,
    expenseCategoryId: moto.id,
    amountCents: 4500,
    paymentMeans: "cash",
    description: "gasolina",
  });
  await post(api, "/api/cash-withdrawals", { date: DATE, amountCents: 1000, note: "banco" });
  // RN-07: 20,00 + 65,00 − 45,00 − 10,00 = 30,00 expected; 31,00 counted → sobra de 1,00.
  await post(
    api,
    `/api/days/${DATE}/close`,
    { openingCashCents: 2000, countedCashCents: 3100 },
    200,
  );

  // Alt+6 opens Relatórios; the day report link, then Enter.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
  await page.keyboard.press("Alt+6");
  await expect(page.getByRole("heading", { level: 1, name: "Relatórios" })).toBeVisible();
  await page.getByRole("link", { name: /Relatório do dia/ }).focus();
  await page.keyboard.press("Enter");

  // The date starts on today and is focused. Its segment order (dd/mm or mm/dd) depends on the
  // browser build, so the day is set with fill(), as in the other specs.
  const date = page.getByLabel("Data");
  await expect(date).toBeFocused();
  await expect(date).toHaveValue(TODAY);
  await date.fill(DATE);
  await expect(date).toHaveValue(DATE);
  await expect(page).toHaveURL(new RegExp(`data=${DATE}`));
  await expect(page.getByText("Dia fechado")).toBeVisible();

  // RN-05: the matrix and its totals.
  const matrix = page.getByRole("table", { name: "Matriz aba × forma de pagamento" });
  await expect(matrix.getByRole("row", { name: /Toner Bruto/ })).toContainText("R$ 70,00");
  await expect(page.getByTestId("day-total-gross")).toHaveText("R$ 85,00");
  await expect(page.getByTestId("day-total-fee")).toHaveText("R$ 0,00");
  await expect(page.getByTestId("day-total-net")).toHaveText("R$ 85,00");

  // The day's expenses and sangrias.
  await expect(page.getByRole("table", { name: "Saídas do dia" })).toContainText("gasolina");
  await expect(page.getByTestId("expenses-total")).toHaveText("R$ 45,00");
  await expect(page.getByTestId("withdrawals-total")).toHaveText("R$ 10,00");

  // RN-07: the stored cash closing.
  await expect(page.getByTestId("opening-cash")).toHaveText("R$ 20,00");
  await expect(page.getByTestId("cash-sales")).toHaveText("R$ 65,00");
  await expect(page.getByTestId("expected-cash")).toHaveText("R$ 30,00");
  await expect(page.getByTestId("counted-cash")).toHaveText("R$ 31,00");
  await expect(page.getByTestId("difference")).toHaveText("Sobra de R$ 1,00");
});
