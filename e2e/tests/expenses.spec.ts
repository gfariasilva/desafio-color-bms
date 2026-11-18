import type { APIRequestContext, Page } from "@playwright/test";
import type { CreateExpenseInput, ExpenseCategory } from "@color-bms/core";
import { chars, closeDay, expect, pressKeys, test, TODAY } from "./fixtures";

/**
 * FR-06 (general expenses, "saídas diárias") in the real built app. Tests that add data on
 * the API use their own past date, so tests sharing a worker's database do not see each
 * other's expenses; only the keyboard test uses today.
 */

async function categoryId(api: APIRequestContext, name: string): Promise<number> {
  const { categories } = (await (await api.get("/api/expense-categories")).json()) as {
    categories: ExpenseCategory[];
  };
  const found = categories.find((category) => category.name === name);
  if (!found) throw new Error(`"${name}" not found`);
  return found.id;
}

async function addExpense(api: APIRequestContext, input: CreateExpenseInput) {
  const response = await api.post("/api/expenses", { data: input });
  expect(response.status(), await response.text()).toBe(201);
}

/** The expense form ("Nova despesa" / "Editar despesa"); the sangria form is below it (FR-07). */
function expenseForm(page: Page) {
  return page.getByRole("form", { name: /despesa$/ });
}

/** Opens Despesas on `date` (today by default), leaving the focus on Valor. */
async function openExpenses(page: Page, date = TODAY) {
  await page.goto("/despesas");
  await expect(page.getByLabel("Valor (R$)")).toBeFocused();
  await expect(page.getByRole("option", { name: "Abastecimento moto" })).toBeAttached();
  await expect(page.getByLabel("Data")).toHaveValue(TODAY);
  if (date !== TODAY) {
    await page.getByLabel("Data").fill(date);
    await page.getByLabel("Valor (R$)").focus();
  }
}

test("FR-06: R$ 45,00 in Abastecimento moto, cash from the till, keyboard only", async ({
  page,
}) => {
  await openExpenses(page);
  // Valor → Tab → Categoria (type-ahead) → Tab → Meio (digit 1 = Dinheiro) → Enter.
  await pressKeys(page, [...chars("45"), "Tab", ...chars("Abast"), "Tab", "1"]);
  await expect(page.getByLabel("Pago com dinheiro do caixa")).toBeChecked();
  await page.keyboard.press("Enter");

  await expect(expenseForm(page).getByRole("status")).toHaveText("Despesa de R$ 45,00 registrada.");
  await expect(page.getByLabel("Valor (R$)")).toBeFocused();
  await expect(page.getByLabel("Valor (R$)")).toHaveValue("");
  await expect(page.getByLabel("Data")).toHaveValue(TODAY);

  const table = page.getByRole("table");
  const row = table.getByRole("row", { name: /Abastecimento moto/ });
  await expect(row).toContainText("Dinheiro");
  await expect(row).toContainText("Sim");
  await expect(row).toContainText("R$ 45,00");
  await expect(table.getByRole("row", { name: /Pago do caixa/ })).toContainText("R$ 45,00");
  await expect(table.getByRole("row", { name: /Total do dia/ })).toContainText("R$ 45,00");
  // RN-08: it enters the month's general expenses.
  await expect(page.getByText(/Despesas gerais do mês 11\/2026/)).toContainText("R$ 45,00");
});

test("FR-06: a PIX expense does not count as paid from the till", async ({ page, api }) => {
  const date = "2026-10-20";
  await addExpense(api, {
    paymentDate: date,
    expenseCategoryId: await categoryId(api, "Abastecimento moto"),
    amountCents: 4500,
    paymentMeans: "cash",
  });
  await openExpenses(page, date);
  await page.getByLabel("Valor (R$)").fill("12,50");
  await page.getByLabel("Categoria").selectOption({ label: "Kalunga" });
  await page.getByRole("radio", { name: /PIX/ }).click();
  await expect(page.getByLabel("Pago com dinheiro do caixa")).toBeDisabled();
  await expect(page.getByLabel("Pago com dinheiro do caixa")).not.toBeChecked();
  await page.getByLabel("Descrição").fill("papel A4");
  await page.getByLabel("Descrição").press("Enter");

  await expect(expenseForm(page).getByRole("status")).toHaveText("Despesa de R$ 12,50 registrada.");
  const table = page.getByRole("table");
  await expect(table.getByRole("row", { name: /papel A4/ })).toContainText("Não");
  await expect(table.getByRole("row", { name: /Pago do caixa/ })).toContainText("R$ 45,00");
  await expect(table.getByRole("row", { name: /Total do dia/ })).toContainText("R$ 57,50");
});

test("FR-06 (as FR-03): edit and delete an expense on an open day", async ({ page, api }) => {
  const date = "2026-10-21";
  await addExpense(api, {
    paymentDate: date,
    expenseCategoryId: await categoryId(api, "Alimentação"),
    amountCents: 1800,
    paymentMeans: "cash",
    description: "lanche",
  });
  await openExpenses(page, date);

  await page.getByRole("button", { name: /Editar despesa/ }).click();
  await expect(page.getByRole("form", { name: "Editar despesa" })).toBeVisible();
  await expect(page.getByLabel("Valor (R$)")).toBeFocused();
  await page.getByLabel("Valor (R$)").fill("20");
  await page.keyboard.press("Enter");
  await expect(expenseForm(page).getByRole("status")).toHaveText("Despesa alterada.");
  await expect(page.getByRole("table").getByRole("row", { name: /lanche/ })).toContainText(
    "R$ 20,00",
  );

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: /Excluir despesa/ }).click();
  await expect(expenseForm(page).getByRole("status")).toHaveText("Despesa excluída.");
  await expect(
    page.getByText("Nenhuma despesa neste dia. Registre a primeira com Enter."),
  ).toBeVisible();

  // FR-18: both changes are in the audit log.
  const audit = (await (await api.get("/api/audit?entity=expense")).json()) as {
    entries: { action: string; entityId: string }[];
  };
  expect(audit.entries.slice(0, 3).map((entry) => entry.action)).toEqual([
    "delete",
    "update",
    "create",
  ]);
});

test("RN-14: a closed day blocks new expenses, edits and deletes", async ({
  page,
  api,
  server,
}) => {
  const date = "2026-10-22";
  await addExpense(api, {
    paymentDate: date,
    expenseCategoryId: await categoryId(api, "Diversos"),
    amountCents: 990,
    paymentMeans: "pix",
  });
  closeDay(server, date);
  await openExpenses(page, date);
  await expect(
    page.getByRole("region", { name: /^Saídas/ }).getByText("Dia fechado"),
  ).toBeVisible();

  await page.getByRole("button", { name: /Editar despesa/ }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "O dia 22/10/2026 está fechado. Reabra o dia para alterar ou excluir esta despesa.",
  );
  await expect(page.getByRole("form", { name: "Nova despesa" })).toBeVisible();

  await page.getByLabel("Valor (R$)").fill("5");
  await page.getByLabel("Categoria").selectOption({ label: "Diversos" });
  await page.getByRole("radio", { name: /Dinheiro/ }).click();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText(
    "O dia 22/10/2026 está fechado. Reabra o dia para registrar ou alterar lançamentos nessa data.",
  );
});
