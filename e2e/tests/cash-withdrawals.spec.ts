import type { APIRequestContext, Page } from "@playwright/test";
import type { CreateCashWithdrawalInput, ExpenseCategory } from "@color-bms/core";
import { chars, closeDay, expect, pressKeys, test, TODAY } from "./fixtures";

/**
 * FR-07 (sangrias) in the real built app. Each test uses its own past date, so tests sharing a
 * worker's database never see each other's sangrias or expenses.
 */

async function addCashWithdrawal(api: APIRequestContext, input: CreateCashWithdrawalInput) {
  const response = await api.post("/api/cash-withdrawals", { data: input });
  expect(response.status(), await response.text()).toBe(201);
}

/** Opens Despesas on `date` and puts the focus on the sangria's Valor. */
async function openOn(page: Page, date: string) {
  await page.goto("/despesas");
  await expect(page.getByLabel("Data")).toHaveValue(TODAY);
  await page.getByLabel("Data").fill(date);
  await expect(page.getByRole("heading", { name: /^Sangrias de/ })).toBeVisible();
  await page.getByLabel("Valor da sangria (R$)").focus();
}

const sangrias = (page: Page) => page.getByRole("region", { name: /^Sangrias/ });

test('FR-07: a R$ 300,00 sangria "depósito no banco", keyboard only, is not an expense', async ({
  page,
  api,
}) => {
  const date = "2026-10-23";
  const { categories } = (await (await api.get("/api/expense-categories")).json()) as {
    categories: ExpenseCategory[];
  };
  const moto = categories.find((category) => category.name === "Abastecimento moto")!;
  const expense = await api.post("/api/expenses", {
    data: {
      paymentDate: date,
      expenseCategoryId: moto.id,
      amountCents: 4500,
      paymentMeans: "cash",
    },
  });
  expect(expense.status()).toBe(201);

  await openOn(page, date);
  await expect(sangrias(page).getByText("Não é despesa")).toBeVisible();
  // Valor → Tab → Observação → Enter.
  await pressKeys(page, [...chars("300"), "Tab"]);
  // keyboard.type, since "ó" is not a key name for keyboard.press.
  await page.keyboard.type("depósito no banco");
  await page.keyboard.press("Enter");

  const form = page.getByRole("form", { name: "Nova sangria" });
  await expect(form.getByRole("status")).toHaveText("Sangria de R$ 300,00 registrada.");
  await expect(page.getByLabel("Valor da sangria (R$)")).toBeFocused();
  await expect(page.getByLabel("Valor da sangria (R$)")).toHaveValue("");

  const table = page.getByRole("table", { name: "Sangrias do dia" });
  await expect(table.getByRole("row", { name: /depósito no banco/ })).toContainText("R$ 300,00");
  await expect(table.getByRole("row", { name: /Total de sangrias/ })).toContainText("R$ 300,00");

  // Not an expense: the day's expenses and the month's general expenses are unchanged.
  const expenses = page.getByRole("region", { name: /^Saídas/ });
  await expect(expenses.getByRole("row", { name: /Total do dia/ })).toContainText("R$ 45,00");
  await expect(page.getByText(/Despesas gerais do mês 10\/2026/)).toContainText("R$ 45,00");
});

test("FR-07: edit and delete a sangria on an open day, with the audit log", async ({
  page,
  api,
}) => {
  const date = "2026-10-24";
  await addCashWithdrawal(api, { date, amountCents: 30000, note: "cofre" });
  await openOn(page, date);

  await sangrias(page)
    .getByRole("button", { name: /Editar sangria/ })
    .click();
  await expect(page.getByRole("form", { name: "Editar sangria" })).toBeVisible();
  await page.getByLabel("Valor da sangria (R$)").fill("250");
  await page.keyboard.press("Enter");
  const form = page.getByRole("form", { name: "Nova sangria" });
  await expect(form.getByRole("status")).toHaveText("Sangria alterada.");
  await expect(sangrias(page).getByRole("row", { name: /cofre/ })).toContainText("R$ 250,00");

  page.once("dialog", (dialog) => void dialog.accept());
  await sangrias(page)
    .getByRole("button", { name: /Excluir sangria/ })
    .click();
  await expect(form.getByRole("status")).toHaveText("Sangria excluída.");
  await expect(sangrias(page).getByText("Nenhuma sangria neste dia.")).toBeVisible();

  const audit = (await (await api.get("/api/audit?entity=cash_withdrawal")).json()) as {
    entries: { action: string }[];
  };
  expect(audit.entries.slice(0, 3).map((entry) => entry.action)).toEqual([
    "delete",
    "update",
    "create",
  ]);
});

test("RN-14: a closed day blocks new sangrias, edits and deletes", async ({
  page,
  api,
  server,
}) => {
  const date = "2026-10-26";
  await addCashWithdrawal(api, { date, amountCents: 1000 });
  closeDay(server, date);
  await openOn(page, date);
  await expect(sangrias(page).getByText("Dia fechado")).toBeVisible();

  await sangrias(page)
    .getByRole("button", { name: /Editar sangria/ })
    .click();
  await expect(sangrias(page).getByRole("alert")).toHaveText(
    "O dia 26/10/2026 está fechado. Reabra o dia para alterar ou excluir esta sangria.",
  );

  await page.getByLabel("Valor da sangria (R$)").fill("5");
  await page.keyboard.press("Enter");
  await expect(sangrias(page).getByRole("alert")).toHaveText(
    "O dia 26/10/2026 está fechado. Reabra o dia para registrar ou alterar lançamentos nessa data.",
  );
});
