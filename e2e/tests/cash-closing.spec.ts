import type { APIRequestContext, Page } from "@playwright/test";
import type { ExpenseCategory } from "@color-bms/core";
import { chars, expect, pressKeys, test, type Catalog } from "./fixtures";

/**
 * FR-08 (cash closing) in the real built app, keyboard only after the page loads (ADR 0002,
 * CS-4). Each test uses its own past dates, so tests sharing a worker's database never see
 * each other's movement. CS-4 (≤ 3 min) is measured by hand.
 */

/** The day's closing (the month's section below has its own status line, FR-16). */
const daySection = (page: Page) => page.getByRole("region", { name: "Fechamento de caixa" });

async function post(api: APIRequestContext, url: string, data: unknown, status = 201) {
  const response = await api.post(url, { data });
  expect(response.status(), await response.text()).toBe(status);
}

async function cashSale(api: APIRequestContext, catalog: Catalog, date: string, cents: number) {
  await post(api, "/api/sales", {
    date,
    saleCategoryId: catalog.tab("Toner"),
    paymentMethodId: catalog.method("Dinheiro"),
    grossCents: cents,
  });
}

test("FR-08: close a day with a cash sale, an expense from the till and a sangria, keyboard only", async ({
  page,
  api,
  catalog,
}) => {
  // The previous day was closed with R$ 100,00 counted: the next opening cash (A-12).
  const previous = "2026-09-14";
  const date = "2026-09-15";
  await cashSale(api, catalog, previous, 2500);
  await post(
    api,
    `/api/days/${previous}/close`,
    { openingCashCents: 7500, countedCashCents: 10000 },
    200,
  );

  // RN-07: 100,00 + 50,00 − 45,00 − 30,00 = 75,00 expected.
  await cashSale(api, catalog, date, 5000);
  const { categories } = (await (await api.get("/api/expense-categories")).json()) as {
    categories: ExpenseCategory[];
  };
  const moto = categories.find((category) => category.name === "Abastecimento moto")!;
  await post(api, "/api/expenses", {
    paymentDate: date,
    expenseCategoryId: moto.id,
    amountCents: 4500,
    paymentMeans: "cash",
  });
  await post(api, "/api/cash-withdrawals", { date, amountCents: 3000, note: "banco" });

  // FR-27: Início warns about the day left open and links to its closing.
  await page.goto("/");
  const alerts = page.getByRole("region", { name: "Alertas" });
  await expect(alerts.getByText("Dia 15/09/2026 não fechado")).toBeVisible();
  await alerts.getByRole("link", { name: "Fechar o dia 15/09/2026" }).focus();
  await page.keyboard.press("Enter");

  // FR-08: the RN-07 terms, with the opening cash pre-filled and focused.
  const opening = page.getByLabel("Troco inicial (R$)");
  await expect(opening).toBeFocused();
  await expect(opening).toHaveValue("100,00");
  await expect(page.getByText("Contado no fechamento de 14/09/2026.")).toBeVisible();
  await expect(page.getByTestId("cash-sales")).toHaveText("R$ 50,00");
  await expect(page.getByTestId("till-expenses")).toHaveText("R$ 45,00");
  await expect(page.getByTestId("withdrawals")).toHaveText("R$ 30,00");
  await expect(page.getByTestId("expected-cash")).toHaveText("R$ 75,00");

  // Troco → Tab → Dinheiro contado 70 → Enter: a R$ 5,00 shortage asks for confirmation.
  await pressKeys(page, ["Tab", ...chars("70")]);
  await expect(page.getByTestId("difference")).toHaveText("Falta de R$ 5,00");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Falta de R$ 5,00");
  await expect(page.getByLabel("Observação")).toBeFocused();
  await page.keyboard.type("troco dado a mais");
  await page.keyboard.press("Enter");

  await expect(daySection(page).getByRole("status")).toHaveText("Dia 15/09/2026 fechado.");
  await expect(page.getByText("Dia fechado")).toBeVisible();
  await expect(page.getByTestId("counted-cash")).toHaveText("R$ 70,00");
  await expect(page.getByTestId("difference")).toHaveText("Falta de R$ 5,00");
  await expect(page.getByText("troco dado a mais")).toBeVisible();

  // RN-14: the day is locked.
  const sale = await api.post("/api/sales", {
    data: {
      date,
      saleCategoryId: catalog.tab("Toner"),
      paymentMethodId: catalog.method("Dinheiro"),
      grossCents: 100,
    },
  });
  expect(sale.status()).toBe(409);

  // FR-18: the closing is in the audit log.
  const audit = (await (await api.get("/api/audit?entity=day&action=close")).json()) as {
    entries: { entityId: string; after: Record<string, unknown> }[];
  };
  expect(audit.entries.find((entry) => entry.entityId === date)?.after).toMatchObject({
    expectedCashCents: 7500,
    countedCashCents: 7000,
    differenceCents: -500,
    note: "troco dado a mais",
  });

  // FR-27: the alert is gone.
  await page.keyboard.press("Alt+1");
  await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
  await expect(alerts.getByText("Dia 14/09/2026 não fechado")).toHaveCount(0);
  await expect(alerts.getByText("Dia 15/09/2026 não fechado")).toHaveCount(0);
});

test("FR-08: first day of use: the opening cash is typed; no difference closes at once", async ({
  page,
  api,
  catalog,
}) => {
  // No closing before this date in the worker's database.
  const date = "2026-09-01";
  await cashSale(api, catalog, date, 2000);

  await page.goto(`/fechamento?data=${date}`);
  const opening = page.getByLabel("Troco inicial (R$)");
  await expect(opening).toBeFocused();
  await expect(opening).toHaveValue("");
  await expect(page.getByText("Primeiro fechamento: digite o troco inicial.")).toBeVisible();

  // Troco 10 → Tab → contado 30 → Enter.
  await pressKeys(page, [...chars("10"), "Tab", ...chars("30")]);
  await expect(page.getByTestId("expected-cash")).toHaveText("R$ 30,00");
  await expect(page.getByTestId("difference")).toHaveText("Sem diferença");
  await page.keyboard.press("Enter");

  await expect(daySection(page).getByRole("status")).toHaveText("Dia 01/09/2026 fechado.");
  await expect(page.getByText("Dia fechado")).toBeVisible();
});

test("FR-09: reopen a closed day with a reason, keyboard only, and close it again", async ({
  page,
  api,
  catalog,
}) => {
  // A day closed with R$ 10,00 opening + R$ 20,00 cash sale = R$ 30,00 counted.
  const date = "2026-09-22";
  await cashSale(api, catalog, date, 2000);
  await post(
    api,
    `/api/days/${date}/close`,
    { openingCashCents: 1000, countedCashCents: 3000 },
    200,
  );

  await page.goto(`/fechamento?data=${date}`);
  await expect(page.getByText("Dia fechado")).toBeVisible();
  // From the Data field, Tab walks its day, month and year parts (how many stops depends on the
  // browser), then reaches "Reabrir dia".
  await page.getByLabel("Data").focus();
  const reopenButton = page.getByRole("button", { name: "Reabrir dia" });
  for (let presses = 0; presses < 6; presses++) {
    if (await reopenButton.evaluate((button) => button === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(reopenButton).toBeFocused();
  await page.keyboard.press("Enter");

  // FR-09: confirm and give a reason; Enter reopens.
  const form = page.getByRole("form", { name: "Reabrir o dia" });
  await expect(form).toContainText("Tem certeza?");
  await expect(page.getByLabel("Motivo da reabertura")).toBeFocused();
  await page.keyboard.type("venda esquecida");
  await page.keyboard.press("Enter");

  await expect(daySection(page).getByRole("status")).toHaveText(
    "Dia 22/09/2026 reaberto. Corrija os lançamentos e feche o dia de novo.",
  );
  await expect(page.getByText("Dia fechado")).toHaveCount(0);

  // RN-14: the day accepts records again (the forgotten R$ 5,00 sale).
  await cashSale(api, catalog, date, 500);

  // FR-18: the previous closing is in the audit log, with the reason.
  const audit = (await (await api.get("/api/audit?entity=day&action=reopen")).json()) as {
    entries: { entityId: string; reason: string; before: Record<string, unknown> }[];
  };
  expect(audit.entries.find((entry) => entry.entityId === date)).toMatchObject({
    reason: "venda esquecida",
    before: { status: "closed", countedCashCents: 3000, differenceCents: 0 },
  });

  // FR-08: a new closing. Reload to see the new sale; focus starts on Troco inicial.
  await page.reload();
  const opening = page.getByLabel("Troco inicial (R$)");
  await expect(opening).toBeFocused();
  await expect(page.getByTestId("cash-sales")).toHaveText("R$ 25,00");
  // A-12: the opening cash is the one the day was closed with. Tab → contado 35 → Enter.
  await expect(opening).toHaveValue("10,00");
  await expect(page.getByText("Troco do fechamento anterior deste dia.")).toBeVisible();
  await pressKeys(page, ["Tab", ...chars("35")]);
  await expect(page.getByTestId("difference")).toHaveText("Sem diferença");
  await page.keyboard.press("Enter");

  await expect(daySection(page).getByRole("status")).toHaveText("Dia 22/09/2026 fechado.");
  await expect(page.getByTestId("counted-cash")).toHaveText("R$ 35,00");
});
