import type { APIRequestContext, Page } from "@playwright/test";
import {
  chars,
  closeDay,
  createFee,
  expect,
  openSales,
  pressKeys,
  test,
  TODAY,
  type Catalog,
} from "./fixtures";

/**
 * FR-04 (refunds) in the real built app. Each test refunds a sale from its own past date;
 * the refunds land on today, so they are found by their unique reason, never by today's
 * totals (other tests in the worker also write today).
 */

/** FR-04's example: R$ 80,00 Débito on PagSeguro (1,99%), on `date`. */
async function addDebitSale(api: APIRequestContext, catalog: Catalog, date: string) {
  await createFee(api, {
    cardMachineId: catalog.machine("PagSeguro"),
    paymentMethodId: catalog.method("Cartão de débito"),
    installmentsFrom: 1,
    installmentsTo: 1,
    ratePpm: 19900,
    validFrom: "2026-01-01",
  });
  const response = await api.post("/api/sales", {
    data: {
      date,
      saleCategoryId: catalog.tab("Toner"),
      paymentMethodId: catalog.method("Cartão de débito"),
      cardMachineId: catalog.machine("PagSeguro"),
      grossCents: 8000,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: number };
}

async function openDay(page: Page, date: string) {
  await openSales(page);
  await page.getByLabel("Data").fill(date);
  await page.getByLabel("Valor (R$)").focus();
}

test("FR-04: keyboard-only full refund of a sale from a closed day lands on today", async ({
  page,
  api,
  catalog,
  server,
}) => {
  const date = "2026-11-03";
  await addDebitSale(api, catalog, date);
  closeDay(server, date);
  await openDay(page, date);

  const toner = page.getByRole("region", { name: /Toner/ });
  await toner.getByRole("button", { name: /Estornar venda/ }).focus();
  await page.keyboard.press("Enter");

  const form = page.getByRole("form", { name: "Estornar venda" });
  const refundValue = form.getByLabel("Valor do estorno (R$)");
  await expect(refundValue).toBeFocused();
  await expect(refundValue).toHaveValue("80,00");
  await expect(page.getByTestId("refund-preview")).toHaveText(
    /Bruto -R\$\s80,00 · Taxa 1,99% · -R\$\s1,59 · Líquido -R\$\s78,41/,
  );
  // Keep the full value: Tab · reason · Enter.
  await pressKeys(page, ["Tab", ...chars("produto com defeito 03/11"), "Enter"]);

  await expect(page.getByRole("status")).toHaveText(
    /Estorno de R\$\s80,00 registrado em 18\/11\/2026\./,
  );
  await expect(form).toBeHidden();
  await expect(page.getByLabel("Valor (R$)")).toBeFocused();
  // The original sale is unchanged, marked as refunded and no longer refundable.
  await expect(toner.getByRole("row", { name: /Estornado/ })).toContainText("R$ 80,00");
  await expect(toner.getByRole("button", { name: /Estornar venda/ })).toHaveCount(0);

  // Today: the refund row in Toner, with the original date and the reason.
  await page.getByLabel("Data").fill(TODAY);
  const refundRow = page
    .getByRole("region", { name: /Toner/ })
    .getByRole("row", { name: /produto com defeito 03\/11/ });
  await expect(refundRow).toContainText("Estorno");
  await expect(refundRow).toContainText("da venda de 03/11/2026");
  await expect(refundRow).toContainText("-R$ 80,00");
  await expect(refundRow).toContainText("-R$ 1,59");
  await expect(refundRow).toContainText("-R$ 78,41");

  const audit = (await (await api.get("/api/audit?entity=refund")).json()) as {
    entries: { reason: string; after: Record<string, unknown> }[];
  };
  expect(audit.entries[0]).toMatchObject({
    reason: "produto com defeito 03/11",
    after: { originalSaleDate: date, grossCents: -8000, feeCents: -159, netCents: -7841 },
  });
});

test("FR-04: refunds cannot pass the sale; a refund can be deleted on an open day", async ({
  page,
  api,
  catalog,
}) => {
  const date = "2026-11-04";
  const sale = await addDebitSale(api, catalog, date);
  const first = await api.post(`/api/sales/${sale.id}/refunds`, {
    data: { refundCents: 5000, reason: "parcial 04/11" },
  });
  expect(first.status(), await first.text()).toBe(201);
  await openDay(page, date);

  const toner = page.getByRole("region", { name: /Toner/ });
  await toner.getByRole("button", { name: /Estornar venda/ }).focus();
  await page.keyboard.press("Enter");
  const form = page.getByRole("form", { name: "Estornar venda" });
  await expect(form.getByLabel("Valor do estorno (R$)")).toHaveValue("30,00");
  await pressKeys(page, [...chars("40"), "Tab", ...chars("mais 04/11"), "Enter"]);
  await expect(form.getByRole("alert")).toHaveText(
    /O estorno passa do valor da venda: restam R\$\s30,00 para estornar\./,
  );
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();

  // Delete the partial refund (today is open): the sale can be refunded in full again.
  await page.getByLabel("Data").fill(TODAY);
  const refundRow = page.getByRole("row", { name: /parcial 04\/11/ });
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toMatch(
      /^Excluir o estorno de R\$\s50,00 \(Toner, Cartão de débito\)\?/,
    );
    void dialog.accept();
  });
  await refundRow.getByRole("button", { name: /Excluir estorno/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Estorno excluído.");
  await expect(refundRow).toHaveCount(0);

  await page.getByLabel("Data").fill(date);
  await page
    .getByRole("region", { name: /Toner/ })
    .getByRole("button", { name: /Estornar venda/ })
    .focus();
  await page.keyboard.press("Enter");
  await expect(form.getByLabel("Valor do estorno (R$)")).toHaveValue("80,00");
});
