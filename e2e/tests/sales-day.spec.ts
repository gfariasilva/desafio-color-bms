import type { APIRequestContext, Page } from "@playwright/test";
import type { CreateSaleInput } from "@color-bms/core";
import { chars, closeDay, expect, openSales, pressKeys, test, type Catalog } from "./fixtures";

/**
 * FR-05 (the day per tab) and FR-03 (edit / delete a sale) in the real built app. Each test
 * uses its own past date, so tests sharing a worker's database do not see each other's sales.
 */

async function addCashSale(
  api: APIRequestContext,
  catalog: Catalog,
  date: string,
  tab: string,
  grossCents: number,
  extra: Partial<CreateSaleInput> = {},
) {
  const response = await api.post("/api/sales", {
    data: {
      date,
      saleCategoryId: catalog.tab(tab),
      paymentMethodId: catalog.method("Dinheiro"),
      grossCents,
      ...extra,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
}

/** Opens Vendas on `date`, leaving the focus back on Valor. */
async function openDay(page: Page, date: string) {
  await openSales(page);
  await page.getByLabel("Data").fill(date);
  await page.getByLabel("Valor (R$)").focus();
}

const tabHeader = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}`) });

test("FR-05: sales in 3 tabs show per tab with method subtotals; empty tabs at R$ 0,00 and collapsible", async ({
  page,
  api,
  catalog,
}) => {
  const date = "2026-11-05";
  await addCashSale(api, catalog, date, "Toner", 2500);
  await addCashSale(api, catalog, date, "Toner", 1000);
  await addCashSale(api, catalog, date, "Papelaria", 800);
  await addCashSale(api, catalog, date, "Chaveiro", 1500, {
    paymentMethodId: catalog.method("PIX/Depósito"),
  });
  await openDay(page, date);

  const toner = page.getByRole("region", { name: /Toner/ });
  await expect(toner.getByRole("row", { name: /Subtotal Dinheiro/ })).toContainText("R$ 35,00");
  await expect(toner.getByRole("row", { name: /Total da aba/ })).toContainText("R$ 35,00");
  const chaveiro = page.getByRole("region", { name: /Chaveiro/ });
  await expect(chaveiro.getByRole("row", { name: /Subtotal PIX\/Depósito/ })).toContainText(
    "R$ 15,00",
  );
  await expect(page.getByTestId("day-total")).toContainText("Bruto R$ 58,00");

  // A tab without sales: R$ 0,00, collapsed; Enter on its header opens it.
  const carimbos = tabHeader(page, "Carimbos");
  await expect(carimbos).toContainText("R$ 0,00");
  await expect(carimbos).toHaveAttribute("aria-expanded", "false");
  await carimbos.focus();
  await page.keyboard.press("Enter");
  await expect(carimbos).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Nenhuma venda nesta aba.")).toBeVisible();

  // A tab with sales can be collapsed too.
  await tabHeader(page, "Toner").focus();
  await page.keyboard.press("Enter");
  await expect(tabHeader(page, "Toner")).toHaveAttribute("aria-expanded", "false");
  await expect(toner.getByRole("row", { name: /Total da aba/ })).toBeHidden();
});

test("FR-03: keyboard-only edit of a sale updates its row, the totals and the audit log", async ({
  page,
  api,
  catalog,
}) => {
  const date = "2026-11-06";
  await addCashSale(api, catalog, date, "Toner", 2500);
  await openDay(page, date);

  const toner = page.getByRole("region", { name: /Toner/ });
  await toner.getByRole("button", { name: /Editar venda/ }).focus();
  await page.keyboard.press("Enter");

  const value = page.getByLabel("Valor (R$)");
  await expect(page.getByRole("form", { name: "Editar venda" })).toBeVisible();
  await expect(value).toBeFocused();
  await expect(value).toHaveValue("25,00");
  // Replace the value and move the sale to Papelaria (5): Ctrl+A · "40" · Tab · 5 · Enter.
  await pressKeys(page, ["Control+a", ...chars("40"), "Tab", "5", "Enter"]);

  await expect(page.getByRole("status")).toHaveText("Venda alterada.");
  await expect(page.getByRole("form", { name: "Nova venda" })).toBeVisible();
  await expect(value).toBeFocused();
  await expect(page.getByLabel("Data")).toHaveValue(date);
  await expect(tabHeader(page, "Toner")).toContainText("R$ 0,00");
  const papelaria = page.getByRole("region", { name: /Papelaria/ });
  await expect(papelaria.getByRole("row", { name: /Total da aba/ })).toContainText("R$ 40,00");

  const audit = (await (await api.get("/api/audit?entity=sale&action=update")).json()) as {
    entries: { before: Record<string, unknown>; after: Record<string, unknown> }[];
  };
  expect(audit.entries[0]).toMatchObject({
    before: { date, saleCategory: "Toner", grossCents: 2500 },
    after: { date, saleCategory: "Papelaria", grossCents: 4000 },
  });
});

test("FR-03: Esc cancels an edit; deleting asks for confirmation and the totals drop", async ({
  page,
  api,
  catalog,
}) => {
  const date = "2026-11-07";
  await addCashSale(api, catalog, date, "Toner", 2500);
  await addCashSale(api, catalog, date, "Toner", 1000);
  await openDay(page, date);
  const toner = page.getByRole("region", { name: /Toner/ });

  await toner.getByRole("button", { name: /Editar venda .* R\$ 25,00/ }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("form", { name: "Nova venda" })).toBeVisible();
  await expect(page.getByLabel("Valor (R$)")).toHaveValue("");

  // First answer "Cancelar", then "OK".
  const remove = toner.getByRole("button", { name: /Excluir venda .* R\$ 25,00/ });
  page.once("dialog", (dialog) => void dialog.dismiss());
  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(toner.getByRole("row", { name: /Total da aba/ })).toContainText("R$ 35,00");

  page.once("dialog", (dialog) => {
    // formatCents puts a non-breaking space after "R$".
    expect(dialog.message()).toMatch(/^Excluir a venda de R\$\s25,00 \(Toner, Dinheiro\)\?/);
    void dialog.accept();
  });
  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Venda excluída.");
  await expect(toner.getByRole("row", { name: /Total da aba/ })).toContainText("R$ 10,00");
  await expect(page.getByTestId("day-total")).toContainText("Bruto R$ 10,00");
});

test("FR-03: on a closed day, edit and delete are blocked with the reopen / refund hint", async ({
  page,
  api,
  catalog,
  server,
}) => {
  const date = "2026-11-08";
  await addCashSale(api, catalog, date, "Toner", 2500);
  closeDay(server, date);
  await openDay(page, date);

  await expect(page.getByText("Dia fechado")).toBeVisible();
  const toner = page.getByRole("region", { name: /Toner/ });
  await toner.getByRole("button", { name: /Editar venda/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText(
    "O dia 08/11/2026 está fechado. Reabra o dia para alterar esta venda ou registre um estorno.",
  );
  await expect(page.getByRole("form", { name: "Nova venda" })).toBeVisible();

  // The server enforces it too (RN-14).
  const { tabs } = (await (await api.get(`/api/days/${date}/sales`)).json()) as {
    tabs: { name: string; sales: { id: number }[] }[];
  };
  const id = tabs.find((tab) => tab.name === "Toner")!.sales[0]!.id;
  const response = await api.delete(`/api/sales/${id}`);
  expect(response.status()).toBe(409);
});
