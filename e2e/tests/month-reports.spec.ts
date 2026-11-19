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

test("FR-22 / FR-23: fixed expenses and the monthly summary, keyboard-first", async ({
  page,
  api,
  catalog,
}) => {
  // Its own month (April): bills are added as one-offs, since only November is generated.
  const APRIL = "2026-04";
  const sale = (day: string, tab: string, method: string, grossCents: number) =>
    post(api, "/api/sales", {
      date: `${APRIL}-${day}`,
      saleCategoryId: catalog.tab(tab),
      paymentMethodId: catalog.method(method),
      grossCents,
    });
  await sale("04", "Toner", "Dinheiro", 50000);
  await sale("10", "Papelaria", "PIX/Depósito", 20000);

  const { categories } = (await (await api.get("/api/expense-categories")).json()) as {
    categories: ExpenseCategory[];
  };
  await post(api, "/api/expenses", {
    paymentDate: `${APRIL}-06`,
    expenseCategoryId: categories.find((c) => c.name === "Kalunga")!.id,
    amountCents: 30000,
    paymentMeans: "boleto",
  });
  // RN-10: a sangria is not an expense; it must not change the saldo.
  await post(api, "/api/cash-withdrawals", { date: `${APRIL}-04`, amountCents: 30000 });

  const oneOff = async (referenceMonth: string, description: string, dueDay: string) => {
    const response = await api.post("/api/fixed-expenses", {
      data: {
        referenceMonth,
        description,
        group: "general",
        dueDate: `${referenceMonth}-${dueDay}`,
        expectedAmountCents: description === "Seguro abril" ? 25000 : 100000,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    return ((await response.json()) as { id: number }).id;
  };
  const pay = async (id: number, amountCents: number, paymentDate: string) => {
    const response = await api.post(`/api/fixed-expenses/${id}/pay`, {
      data: { amountCents, paymentDate, paymentMeans: "pix" },
    });
    expect(response.status(), await response.text()).toBe(200);
  };
  await pay(await oneOff(APRIL, "Aluguel abril", "05"), 95000, `${APRIL}-08`);
  // March's bill paid in April counts in April (RN-09, cash basis).
  await pay(await oneOff("2026-03", "IPTU março", "20"), 17000, `${APRIL}-15`);
  await oneOff(APRIL, "Seguro abril", "25");

  // Alt+6 opens Relatórios; "Mês – Despesas fixas", then Enter.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
  await page.keyboard.press("Alt+6");
  await page.getByRole("link", { name: /Mês – Despesas fixas/ }).focus();
  await page.keyboard.press("Enter");
  const month = page.getByLabel("Mês");
  await expect(month).toBeFocused();
  await month.fill(APRIL);

  // FR-22: the bills of Gerais, the total paid (RN-09) and the pending total apart.
  const general = page.getByRole("table", { name: "Gerais" });
  await expect(general.getByRole("row", { name: /IPTU março/ })).toContainText("Conta de 03/2026");
  await expect(general.getByRole("row", { name: /Aluguel abril/ })).toContainText("R$ 950,00");
  await expect(general.getByRole("row", { name: /Seguro abril/ })).toContainText("Pendente");
  await expect(page.getByTestId("fixed-paid-total")).toHaveText("R$ 1.120,00");
  await expect(page.getByTestId("fixed-pending-total")).toHaveText("R$ 250,00");

  // FR-23: back to Relatórios, then "Mês – Resumo mensal".
  await page.keyboard.press("Alt+6");
  await page.getByRole("link", { name: /Mês – Resumo mensal/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Mês")).toBeFocused();
  await page.getByLabel("Mês").fill(APRIL);

  await expect(page.getByTestId("summary-income")).toHaveText("R$ 700,00");
  await expect(page.getByTestId("summary-fees")).toHaveText("R$ 0,00");
  await expect(page.getByTestId("summary-general")).toHaveText("R$ 300,00");
  await expect(page.getByTestId("summary-fixed")).toHaveText("R$ 1.120,00");
  await expect(page.getByTestId("summary-total-expenses")).toHaveText("R$ 1.420,00");
  // RN-10: 700,00 − 0,00 − 1.420,00; the R$ 300,00 sangria is not in it.
  await expect(page.getByTestId("summary-balance")).toHaveText("-R$ 720,00");

  // The summary links to the fixed-expenses report of the same month.
  await page.getByRole("link", { name: "Ver Mês – Despesas fixas" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/relatorios/mes/despesas-fixas\\?mes=${APRIL}`));
  await expect(page.getByTestId("fixed-paid-total")).toHaveText("R$ 1.120,00");
});
