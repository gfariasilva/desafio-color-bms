import type { APIRequestContext } from "@playwright/test";
import type { PaymentMethod, SaleCategory } from "@color-bms/core";
import { chars, expect, pressKeys, startServer, test, type StartedServer } from "./fixtures";

/**
 * FR-27 (Início alerts and shortcuts) in the real built app, keyboard only after the page
 * loads. "Tudo em dia" needs a database where nothing is pending, so each test runs its own
 * server (the worker's shared one holds the other specs' open days and bills).
 * The clock is 18/11/2026 15:00 in São Paulo (ADR 0002).
 */

let server: StartedServer;
let api: APIRequestContext;

test.beforeEach(async ({ playwright }, testInfo) => {
  server = await startServer(3500 + testInfo.workerIndex);
  api = await playwright.request.newContext({ baseURL: server.baseURL });
});

test.afterEach(async ({ context }) => {
  // Close the browser first, so no idle socket keeps the server's close() waiting.
  await context.close();
  await api.dispose();
  await server.stop();
});

async function post(url: string, data: unknown, status = 201) {
  const response = await api.post(url, { data });
  expect(response.status(), await response.text()).toBe(status);
}

async function cashSale(date: string, grossCents: number) {
  const { categories } = (await (await api.get("/api/sale-categories")).json()) as {
    categories: SaleCategory[];
  };
  const { paymentMethods } = (await (await api.get("/api/payment-methods")).json()) as {
    paymentMethods: PaymentMethod[];
  };
  await post("/api/sales", {
    date,
    saleCategoryId: categories.find((tab) => tab.name === "Toner")!.id,
    paymentMethodId: paymentMethods.find((method) => method.name === "Dinheiro")!.id,
    grossCents,
  });
}

async function oneOffBill(description: string, dueDate: string, expectedAmountCents: number) {
  await post("/api/fixed-expenses", {
    referenceMonth: "2026-11",
    description,
    group: "general",
    dueDate,
    expectedAmountCents,
  });
}

test("FR-27: nothing pending shows Tudo em dia; the shortcuts open the day's tasks, keyboard only", async ({
  page,
}) => {
  await page.goto(`${server.baseURL}/`);
  const alerts = page.getByRole("region", { name: "Alertas" });
  await expect(alerts.getByText("Tudo em dia")).toBeVisible();
  await expect(alerts.getByRole("listitem")).toHaveCount(0);

  // FR-27: the shortcuts are links reached with Tab and opened with Enter.
  const shortcuts = page.getByRole("region", { name: "Atalhos" });
  await shortcuts.getByRole("link", { name: "Registrar venda" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Vendas" })).toBeVisible();

  await page.keyboard.press("Alt+1");
  await shortcuts.getByRole("link", { name: "Registrar despesa" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Despesas" })).toBeVisible();

  await page.keyboard.press("Alt+1");
  await shortcuts.getByRole("link", { name: "Fechar o dia" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Fechamento" })).toBeVisible();

  // #23: the system status is now in Configurações.
  await page.keyboard.press("Alt+9");
  await expect(page.getByRole("region", { name: "Status do sistema" })).toContainText("Conectado");
});

test("FR-27: every alert with its link; Pagar opens the overdue bill and paying clears it", async ({
  page,
}) => {
  await oneOffBill("IPTU", "2026-11-10", 15000); // Conta vencida
  await oneOffBill("Seguro loja", "2026-11-20", 8000); // Conta a vencer (today + 2)
  await cashSale("2026-11-16", 1000); // Dia não fechado
  await cashSale("2026-11-17", 2500);
  // The last closing: R$ 25,00 expected, R$ 20,00 counted → Falta de R$ 5,00.
  await post("/api/days/2026-11-17/close", { openingCashCents: 0, countedCashCents: 2000 }, 200);

  await page.goto(`${server.baseURL}/`);
  const alerts = page.getByRole("region", { name: "Alertas" });
  const rows = alerts.getByRole("listitem");
  await expect(rows).toHaveText([
    /^Dia 16\/11\/2026 não fechado/,
    /^Conta vencida: IPTU, venceu há 8 dias \(10\/11\/2026\) · previsto R\$\s150,00/,
    /^Diferença de caixa no fechamento de 17\/11\/2026: Falta de R\$\s5,00/,
    /^Conta a vencer: Seguro loja, vence em 2 dias \(20\/11\/2026\) · previsto R\$\s80,00/,
  ]);
  await expect(alerts.getByText("Tudo em dia")).toHaveCount(0);
  await expect(
    alerts.getByRole("link", { name: "Ver o fechamento de 17/11/2026" }),
  ).toHaveAttribute("href", "/fechamento?data=2026-11-17");

  // Pagar → the payment card of IPTU opens on Contas do mês, Valor focused.
  await alerts.getByRole("link", { name: "Pagar IPTU" }).focus();
  await page.keyboard.press("Enter");
  const form = page.getByRole("form", { name: "Pagar IPTU" });
  await expect(form.getByLabel("Valor pago (R$)")).toBeFocused();
  await expect(form.getByLabel("Valor pago (R$)")).toHaveValue("150,00");

  // Tab → Meio "2" (PIX) → Enter pays it.
  await pressKeys(page, ["Tab", ...chars("2")]);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("IPTU paga: R$ 150,00 em 18/11/2026.");

  // Back on Início: the overdue bill is gone, the others stay.
  await page.keyboard.press("Alt+1");
  await expect(rows).toHaveCount(3);
  await expect(alerts.getByText(/Conta vencida/)).toHaveCount(0);
  await expect(alerts.getByText(/Conta a vencer: Seguro loja/)).toBeVisible();
});
