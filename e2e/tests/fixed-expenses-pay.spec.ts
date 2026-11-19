import type { APIRequestContext, Page } from "@playwright/test";
import { chars, expect, pressKeys, test, TODAY, type Catalog } from "./fixtures";

/**
 * FR-12 / FR-13 (paying and dismissing the month's bills) and the #13 conversion of the
 * pilot's "CONTA:" sangrias, in the real built app. The server starts on 18/11/2026, so
 * November's bills exist. Tests in a worker share one database: each test pays its own bill
 * on its own date, and only touches bills the other specs never check (Contador, Seguro loja).
 */

async function post(api: APIRequestContext, url: string, data: unknown, status = 201) {
  const response = await api.post(url, { data });
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<{ id: number }>;
}

async function cashSale(api: APIRequestContext, catalog: Catalog, date: string, cents: number) {
  await post(api, "/api/sales", {
    date,
    saleCategoryId: catalog.tab("Toner"),
    paymentMethodId: catalog.method("Dinheiro"),
    grossCents: cents,
  });
}

async function openMonth(page: Page) {
  await page.goto("/despesas-fixas/mes");
  await expect(page.getByRole("heading", { name: "Contas de novembro de 2026" })).toBeVisible();
}

/** RN-07 term of today's closing: Σ expenses paid in cash from the till. */
async function tillExpensesToday(api: APIRequestContext): Promise<number> {
  const closing = (await (await api.get(`/api/days/${TODAY}/cash-closing`)).json()) as {
    tillExpensesCents: number;
  };
  return closing.tillExpensesCents;
}

test("FR-12: pay a bill with cash from the till, keyboard only; it reduces the day's expected cash (RN-07)", async ({
  page,
  api,
}) => {
  // Other tests in this worker also spend cash today: compare before and after.
  const before = await tillExpensesToday(api);
  await openMonth(page);

  // Row → "Pagar Contador" → the card opens with Valor focused and today's date.
  await page.getByRole("button", { name: "Pagar Contador" }).focus();
  await page.keyboard.press("Enter");
  const form = page.getByRole("form", { name: "Pagar Contador" });
  await expect(form.getByLabel("Valor pago (R$)")).toBeFocused();
  await expect(form.getByLabel("Data do pagamento")).toHaveValue(TODAY);

  // Valor 120,00 → Tab → Meio "1" (Dinheiro): paid from the till by default → Enter.
  await pressKeys(page, [...chars("120,00"), "Tab", "1"]);
  await expect(form.getByLabel("Pago com dinheiro do caixa")).toBeChecked();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("status")).toHaveText("Contador paga: R$ 120,00 em 18/11/2026.");
  const row = page.getByRole("row", { name: /Contador/ });
  await expect(row).toContainText("Pago");
  await expect(row).toContainText("R$ 120,00 · 18/11/2026 · Dinheiro do caixa");

  // FR-12 / RN-07: today's closing counts it as an expense paid from the till.
  expect(await tillExpensesToday(api)).toBe(before + 12000);
});

test("FR-12: dismiss a bill and reactivate it", async ({ page }) => {
  await openMonth(page);
  page.on("dialog", (dialog) => void dialog.accept());

  await page.getByRole("button", { name: "Dispensar Seguro loja" }).click();
  await expect(page.getByRole("status")).toHaveText("Seguro loja dispensada.");
  await expect(page.getByRole("row", { name: /Seguro loja/ })).toContainText("Dispensado");

  await page.getByRole("button", { name: "Reativar Seguro loja" }).click();
  await expect(page.getByRole("status")).toHaveText("Seguro loja reativada.");
  await expect(page.getByRole("row", { name: /Seguro loja/ })).toContainText("Pendente");
});

test("#13: convert a CONTA: sangria of a closed day; the closing keeps its count", async ({
  page,
  api,
  catalog,
}) => {
  const date = "2026-11-13";
  await cashSale(api, catalog, date, 50000);
  await post(api, "/api/cash-withdrawals", {
    date,
    amountCents: 8990,
    note: "CONTA: Gás E2E",
  });
  await post(api, `/api/days/${date}/close`, { openingCashCents: 0, countedCashCents: 41010 }, 200);

  await openMonth(page);
  const panel = page.getByRole("table", { name: /Sangrias “CONTA:”/ });
  const row = panel.getByRole("row", { name: /CONTA: Gás E2E/ });
  await expect(row).toContainText("dia fechado");
  await expect(row.getByLabel(/Converter a sangria de 13\/11\/2026 em/)).toHaveValue("new");

  page.on("dialog", (dialog) => void dialog.accept());
  await row.getByRole("button", { name: "Converter" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Sangria convertida: Gás E2E paga em 13/11/2026, R$ 89,90 do caixa.",
  );
  await expect(page.getByRole("row", { name: /Gás E2E/ })).toContainText("Avulsa");

  // RN-07: the day is closed again with the same expected cash and no difference.
  await page.goto(`/fechamento?data=${date}`);
  await expect(page.getByTestId("expected-cash")).toHaveText("R$ 410,10");
  await expect(page.getByText("Sem diferença")).toBeVisible();
});
