import type { APIRequestContext } from "@playwright/test";
import type { ExpenseCategory, FixedExpense } from "@color-bms/core";
import { expect, test } from "./fixtures";

/**
 * FR-22 / FR-23 (fixed expenses report and monthly summary) in the real built app (ADR 0002),
 * reached with the keyboard. Its own months (March and April), so other tests sharing the
 * worker's database never touch them. The bills are one-off entries (FR-11), because only the
 * current month is generated from the templates.
 */

const MONTH = "2026-04";

async function post<T>(api: APIRequestContext, url: string, data: unknown, status = 201) {
  const response = await api.post(url, { data });
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}

/** A one-off bill of `referenceMonth`, paid on `paymentDate` when given (FR-12). */
async function bill(
  api: APIRequestContext,
  input: {
    referenceMonth: string;
    description: string;
    group: "general" | "government_fees";
    expectedAmountCents: number;
    paid?: { amountCents: number; paymentDate: string };
  },
) {
  const created = await post<FixedExpense>(api, "/api/fixed-expenses", {
    referenceMonth: input.referenceMonth,
    description: input.description,
    group: input.group,
    dueDate: `${input.referenceMonth}-10`,
    expectedAmountCents: input.expectedAmountCents,
  });
  if (input.paid) {
    await post(
      api,
      `/api/fixed-expenses/${created.id}/pay`,
      { ...input.paid, paymentMeans: "pix" },
      200,
    );
  }
}

test("FR-22 / FR-23: fixed expenses and the monthly summary add up, keyboard-first", async ({
  page,
  api,
  catalog,
}) => {
  await post(api, "/api/sales", {
    date: `${MONTH}-03`,
    saleCategoryId: catalog.tab("Toner"),
    paymentMethodId: catalog.method("Dinheiro"),
    grossCents: 250000,
  });
  const { categories } = (await (await api.get("/api/expense-categories")).json()) as {
    categories: ExpenseCategory[];
  };
  await post(api, "/api/expenses", {
    paymentDate: `${MONTH}-06`,
    expenseCategoryId: categories.find((c) => c.name === "Kalunga")!.id,
    amountCents: 30000,
    paymentMeans: "boleto",
  });
  await bill(api, {
    referenceMonth: MONTH,
    description: "Aluguel abril",
    group: "general",
    expectedAmountCents: 150000,
    paid: { amountCents: 140000, paymentDate: `${MONTH}-05` },
  });
  await bill(api, {
    referenceMonth: MONTH,
    description: "DAS abril",
    group: "government_fees",
    expectedAmountCents: 31000,
  });
  // March's bill paid in April: counts in April (RN-09, cash basis).
  await bill(api, {
    referenceMonth: "2026-03",
    description: "Luz março",
    group: "general",
    expectedAmountCents: 20000,
    paid: { amountCents: 18743, paymentDate: `${MONTH}-08` },
  });
  // A sangria never enters the balance (RN-10).
  await post(api, "/api/cash-withdrawals", { date: `${MONTH}-03`, amountCents: 50000 });

  // Alt+6 opens Relatórios; the "Mês – Despesas fixas" link, then Enter.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
  await page.keyboard.press("Alt+6");
  await page.getByRole("link", { name: /Mês – Despesas fixas/ }).focus();
  await page.keyboard.press("Enter");
  const month = page.getByLabel("Mês");
  await expect(month).toBeFocused();
  await month.fill(MONTH);
  await expect(page).toHaveURL(new RegExp(`mes=${MONTH}`));

  // FR-22: the bills by group, the total paid (by payment date) and the pending total.
  const general = page.getByRole("table", { name: "Gerais" });
  await expect(general.getByRole("row", { name: /Luz março/ })).toContainText("ref. 03/2026");
  await expect(general.getByRole("row", { name: /Aluguel abril/ })).toContainText("R$ 1.400,00");
  const government = page.getByRole("table", { name: "Taxas governo" });
  await expect(government.getByRole("row", { name: /DAS abril/ })).toContainText("Pendente");
  await expect(page.getByTestId("fixed-paid-total")).toHaveText("R$ 1.587,43");
  await expect(page.getByTestId("fixed-pending-total")).toHaveText("R$ 310,00");

  // FR-23: back to Relatórios, then "Resumo mensal".
  await page.keyboard.press("Alt+6");
  await page.getByRole("link", { name: /Resumo mensal/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Mês")).toBeFocused();
  await page.getByLabel("Mês").fill(MONTH);

  await expect(page.getByTestId("summary-gross")).toHaveText("R$ 2.500,00");
  await expect(page.getByTestId("summary-fee")).toHaveText("R$ 0,00");
  await expect(page.getByTestId("summary-general")).toHaveText("R$ 300,00");
  await expect(page.getByTestId("summary-fixed")).toHaveText("R$ 1.587,43");
  await expect(page.getByTestId("summary-total-expenses")).toHaveText("R$ 1.887,43");
  // RN-10: 2.500,00 − 0,00 − 1.887,43; the R$ 500,00 sangria is not in it.
  await expect(page.getByTestId("summary-balance")).toHaveText("R$ 612,57");

  // Each line opens its report for the same month.
  await page.getByRole("link", { name: "(−) Total despesas fixas" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/relatorios/mes/despesas-fixas\\?mes=${MONTH}`));
  await expect(page.getByTestId("fixed-paid-total")).toHaveText("R$ 1.587,43");
});
