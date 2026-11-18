import { describe, expect, it } from "vitest";
import { daySalesResponseSchema } from "@color-bms/core";
import { closeDay, closeMonth, createFee, createSale, TODAY, useSalesApp } from "./sales-fixture";

const ctx = useSalesApp();

async function getDay(date: string) {
  const response = await ctx.app.inject({ method: "GET", url: `/api/days/${date}/sales` });
  expect(response.statusCode, response.body).toBe(200);
  return daySalesResponseSchema.parse(response.json());
}

describe("FR-05: the day per tab (GET /api/days/:date/sales)", () => {
  it("FR-05: sales in 3 tabs → totals per method; tabs without sales at R$ 0,00", async () => {
    const { ids } = ctx;
    await createFee(ctx, { ratePpm: 37900 });
    await createSale(ctx, {
      saleCategoryId: ids.toner,
      paymentMethodId: ids.credit,
      cardMachineId: ids.mercadoPago,
      installments: 3,
      grossCents: 15000,
    });
    await createSale(ctx, { saleCategoryId: ids.toner, grossCents: 2500 });
    await createSale(ctx, { saleCategoryId: ids.papelaria, grossCents: 1000 });
    await createSale(ctx, { saleCategoryId: ids.chaveiro, grossCents: 800 });
    await createSale(ctx, { date: "2026-11-17", grossCents: 99999 }); // another day

    const day = await getDay(TODAY);
    expect(day.date).toBe(TODAY);
    expect(day.lock).toBeNull();

    const toner = day.tabs.find((tab) => tab.name === "Toner")!;
    expect(toner.sales).toHaveLength(2);
    expect(toner.methods).toEqual([
      expect.objectContaining({
        paymentMethodName: "Dinheiro",
        grossCents: 2500,
        feeCents: 0,
        netCents: 2500,
      }),
      expect.objectContaining({
        paymentMethodName: "Cartão de crédito",
        grossCents: 15000,
        feeCents: 569,
        netCents: 14431,
      }),
    ]);
    expect(toner.total).toEqual({ grossCents: 17500, feeCents: 569, netCents: 16931 });
    expect(day.tabs.find((tab) => tab.name === "Papelaria")!.total.grossCents).toBe(1000);
    expect(day.tabs.find((tab) => tab.name === "Chaveiro")!.total.grossCents).toBe(800);

    // Every active tab is listed, in display order; the empty ones at zero.
    expect(day.tabs).toHaveLength(9);
    const empty = day.tabs.filter((tab) => tab.sales.length === 0);
    expect(empty).toHaveLength(6);
    for (const tab of empty) {
      expect(tab.total).toEqual({ grossCents: 0, feeCents: 0, netCents: 0 });
    }
    expect(day.total).toEqual({ grossCents: 19300, feeCents: 569, netCents: 18731 });
  });

  it("FR-05: a day without sales lists the tabs at zero", async () => {
    const day = await getDay("2026-11-01");
    expect(day.tabs.every((tab) => tab.sales.length === 0)).toBe(true);
    expect(day.total).toEqual({ grossCents: 0, feeCents: 0, netCents: 0 });
  });

  it("FR-05: an inactive tab still shows the sales it had that day", async () => {
    await createSale(ctx, { saleCategoryId: ctx.ids.papelaria, grossCents: 1200 });
    await ctx.app.inject({
      method: "PATCH",
      url: `/api/sale-categories/${ctx.ids.papelaria}`,
      payload: { active: false },
    });
    const day = await getDay(TODAY);
    expect(day.tabs.find((tab) => tab.name === "Papelaria")).toMatchObject({
      active: false,
      total: { grossCents: 1200 },
    });
    const otherDay = await getDay("2026-11-17");
    expect(otherDay.tabs.find((tab) => tab.name === "Papelaria")).toBeUndefined();
  });

  it("RN-14: tells the UI when the day or its month is closed", async () => {
    closeDay(ctx, "2026-11-10");
    expect((await getDay("2026-11-10")).lock).toBe(
      "O dia 10/11/2026 está fechado. Reabra o dia para alterar esta venda ou registre um estorno.",
    );
    closeMonth(ctx, "2026-10");
    expect((await getDay("2026-10-05")).lock).toContain("O mês 10/2026 está fechado");
  });

  it("FR-05: the date must be a valid civil date", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/days/2026-02-30/sales" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Data inválida." });
  });
});
