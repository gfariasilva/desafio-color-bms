import type { APIRequestContext } from "@playwright/test";
import type { ExpenseCategory, FixedExpense, PaymentMethod, SaleCategory } from "@color-bms/core";
import { expect, startServer, test, TODAY, type StartedServer } from "./fixtures";

/**
 * FR-24 in the real built app (ADR 0002): Dashboards › "Como está este mês comparado ao
 * anterior?", reached with Alt+7. The clock is 18/11/2026, so it compares 01–18/11 with
 * 01–18/10. Other tests write sales in November on the worker's shared database, so this one
 * runs its own server (like the restore test) to know every figure.
 */

let server: StartedServer;

// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern here
test.beforeEach(async ({}, testInfo) => {
  server = await startServer(3500 + testInfo.workerIndex);
});

test.afterEach(async () => {
  await server.stop();
});

async function post<T>(api: APIRequestContext, url: string, data: unknown, status = 201) {
  const response = await api.post(url, { data });
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}

async function get<T>(api: APIRequestContext, url: string) {
  const response = await api.get(url);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as T;
}

/** October and November: sales, a general expense, a paid bill and a sangria in each. */
async function seed(api: APIRequestContext) {
  const { categories: tabs } = await get<{ categories: SaleCategory[] }>(
    api,
    "/api/sale-categories",
  );
  const { paymentMethods } = await get<{ paymentMethods: PaymentMethod[] }>(
    api,
    "/api/payment-methods",
  );
  const { categories: expenseCategories } = await get<{ categories: ExpenseCategory[] }>(
    api,
    "/api/expense-categories",
  );
  const toner = tabs.find((t) => t.name === "Toner")!.id;
  const cash = paymentMethods.find((m) => m.name === "Dinheiro")!.id;
  const kalunga = expenseCategories.find((c) => c.name === "Kalunga")!.id;

  const sale = (date: string, grossCents: number) =>
    post(api, "/api/sales", { date, saleCategoryId: toner, paymentMethodId: cash, grossCents });
  const expense = (paymentDate: string, amountCents: number) =>
    post(api, "/api/expenses", {
      paymentDate,
      expenseCategoryId: kalunga,
      amountCents,
      paymentMeans: "pix",
    });
  const paidBill = async (referenceMonth: string, amountCents: number, paymentDate: string) => {
    const created = await post<FixedExpense>(api, "/api/fixed-expenses", {
      referenceMonth,
      description: `Aluguel ${referenceMonth}`,
      group: "general",
      dueDate: `${referenceMonth}-05`,
      expectedAmountCents: amountCents,
    });
    await post(
      api,
      `/api/fixed-expenses/${created.id}/pay`,
      { amountCents, paymentDate, paymentMeans: "pix" },
      200,
    );
  };

  // October 01–18: entrada 2.000,00; despesas 300,00 + 1.000,00.
  await sale("2026-10-02", 120000);
  await sale("2026-10-18", 80000);
  await expense("2026-10-08", 30000);
  await paidBill("2026-10", 100000, "2026-10-05");
  // October 19–31: only in "Outubro completo".
  await sale("2026-10-25", 50000);
  await expense("2026-10-28", 10000);
  // November 01–18: entrada 2.500,00; despesas 450,00 + 1.000,00.
  await sale("2026-11-03", 150000);
  await sale(TODAY, 100000);
  await expense("2026-11-10", 45000);
  await paidBill("2026-11", 100000, "2026-11-05");
  // Sangrias never enter the balance (RN-10).
  await post(api, "/api/cash-withdrawals", { date: "2026-10-10", amountCents: 40000 });
  await post(api, "/api/cash-withdrawals", { date: TODAY, amountCents: 40000 });
}

test("FR-24: this month against the same days of October, keyboard-first", async ({
  page,
  playwright,
}) => {
  const api = await playwright.request.newContext({ baseURL: server.baseURL });
  try {
    await seed(api);

    // Alt+7 opens Dashboards from anywhere.
    await page.goto(`${server.baseURL}/`);
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    await page.keyboard.press("Alt+7");
    await expect(page).toHaveURL(/\/dashboards$/);
    await expect(
      page.getByRole("heading", { name: "Como está este mês comparado ao anterior?" }),
    ).toBeVisible();

    const table = page.getByRole("table", { name: "Este mês × mês anterior" });
    await expect(table.getByRole("columnheader", { name: /Este mês\s*01–18\/11/ })).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: /Mês anterior\s*01–18\/10/ }),
    ).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /Outubro completo/ })).toBeVisible();

    const row = (name: string) => table.getByRole("row", { name: new RegExp(`^${name}`) });
    const cells = (name: string) => row(name).getByRole("cell");
    // Indicador | Este mês | Mês anterior | Variação | Outubro completo.
    await expect(cells("Entrada mensal")).toHaveText([
      "Entrada mensal",
      "R$ 2.500,00",
      "R$ 2.000,00",
      "+25,0%",
      "R$ 2.500,00",
    ]);
    await expect(cells("Taxas")).toHaveText(["Taxas", "R$ 0,00", "R$ 0,00", "—", "R$ 0,00"]);
    await expect(cells("Total de despesas")).toHaveText([
      "Total de despesas",
      "R$ 1.450,00",
      "R$ 1.300,00",
      "+11,5%",
      "R$ 1.400,00",
    ]);
    // RN-10: 2.500,00 − 0 − 1.450,00 against 2.000,00 − 0 − 1.300,00; sangrias stay out.
    await expect(cells("Saldo")).toHaveText([
      "Saldo",
      "R$ 1.050,00",
      "R$ 700,00",
      "+50,0%",
      "R$ 1.100,00",
    ]);
    await expect(page.getByText("o mês anterior não teve valor nesses dias")).toBeVisible();
    await expect(
      page.getByRole("img", {
        name: "Gráfico de barras: este mês (01–18/11) × mês anterior (01–18/10)",
      }),
    ).toBeVisible();
    // The chart draws one bar per indicator and period.
    await expect(page.locator(".recharts-bar-rectangle")).toHaveCount(8);
  } finally {
    await api.dispose();
  }
});

test('FR-24: first month of use → "—" with "sem dados do mês anterior"', async ({
  page,
  playwright,
}) => {
  const api = await playwright.request.newContext({ baseURL: server.baseURL });
  try {
    const { categories: tabs } = await get<{ categories: SaleCategory[] }>(
      api,
      "/api/sale-categories",
    );
    const { paymentMethods } = await get<{ paymentMethods: PaymentMethod[] }>(
      api,
      "/api/payment-methods",
    );
    await post(api, "/api/sales", {
      date: "2026-11-03",
      saleCategoryId: tabs.find((t) => t.name === "Papelaria")!.id,
      paymentMethodId: paymentMethods.find((m) => m.name === "Dinheiro")!.id,
      grossCents: 9990,
    });

    await page.goto(`${server.baseURL}/dashboards`);
    const table = page.getByRole("table", { name: "Este mês × mês anterior" });
    await expect(table.getByRole("row", { name: /^Entrada mensal/ }).getByRole("cell")).toHaveText([
      "Entrada mensal",
      "R$ 99,90",
      "R$ 0,00",
      "—",
      "R$ 0,00",
    ]);
    await expect(page.getByText("sem dados do mês anterior")).toBeVisible();
  } finally {
    await api.dispose();
  }
});
