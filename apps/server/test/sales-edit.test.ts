import { describe, expect, it } from "vitest";
import {
  CARD_FEE_MISSING_CODE,
  DAY_CLOSED_CODE,
  saleListResponseSchema,
  saleSchema,
  type UpdateSaleInput,
} from "@color-bms/core";
import {
  closeDay,
  closeMonth,
  createFee,
  createSale,
  NOW,
  saleAudit,
  TODAY,
  useSalesApp,
} from "./sales-fixture";

const ctx = useSalesApp();

function patch(id: number, payload: UpdateSaleInput | Record<string, unknown>) {
  return ctx.app.inject({ method: "PATCH", url: `/api/sales/${id}`, payload });
}

function remove(id: number | string) {
  return ctx.app.inject({ method: "DELETE", url: `/api/sales/${id}` });
}

async function listSales(date: string) {
  const response = await ctx.app.inject({ method: "GET", url: `/api/sales?date=${date}` });
  return saleListResponseSchema.parse(response.json()).sales;
}

const CLOSED_DAY_MESSAGE =
  "O dia 10/11/2026 está fechado. Reabra o dia para alterar esta venda ou registre um estorno.";

describe("FR-03: edit a sale on an open day (PATCH /api/sales/:id)", () => {
  it("FR-03: editing applies the change, recalculates the amounts and audits before/after", async () => {
    const { ids } = ctx;
    await createFee(ctx, { ratePpm: 37900 });
    const sale = await createSale(ctx, { grossCents: 2500, note: "balcão" });

    const response = await patch(sale.id, {
      saleCategoryId: ids.papelaria,
      paymentMethodId: ids.credit,
      cardMachineId: ids.mercadoPago,
      installments: 3,
      grossCents: 15000,
    });
    expect(response.statusCode, response.body).toBe(200);
    const edited = saleSchema.parse(response.json());
    expect(edited).toMatchObject({
      id: sale.id,
      date: TODAY,
      createdAt: sale.createdAt,
      type: "sale",
      saleCategoryName: "Papelaria",
      paymentMethodName: "Cartão de crédito",
      cardMachineName: "Mercado Pago",
      installments: 3,
      grossCents: 15000,
      feeRatePpm: 37900,
      feeCents: 569,
      netCents: 14431,
      note: "balcão",
    });
    expect(await listSales(TODAY)).toEqual([edited]);

    const [entry] = await saleAudit(ctx);
    expect(entry).toMatchObject({
      entity: "sale",
      entityId: String(sale.id),
      action: "update",
      at: NOW.toISOString(),
      before: {
        saleCategory: "Toner",
        paymentMethod: "Dinheiro",
        cardMachine: null,
        grossCents: 2500,
        feeCents: 0,
        netCents: 2500,
      },
      after: {
        saleCategory: "Papelaria",
        paymentMethod: "Cartão de crédito",
        cardMachine: "Mercado Pago",
        installments: 3,
        grossCents: 15000,
        feeRatePpm: 37900,
        feeCents: 569,
        netCents: 14431,
      },
    });
  });

  it("FR-03: changing back to cash clears the machine and installments", async () => {
    const { ids } = ctx;
    await createFee(ctx);
    const sale = await createSale(ctx, {
      paymentMethodId: ids.credit,
      cardMachineId: ids.mercadoPago,
      installments: 2,
      grossCents: 10000,
    });
    const response = await patch(sale.id, {
      paymentMethodId: ids.cash,
      cardMachineId: null,
      installments: null,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      cardMachineId: null,
      installments: null,
      feeRatePpm: 0,
      feeCents: 0,
      netCents: 10000,
    });
  });

  it("FR-03: changing only the method drops the machine and installments it does not use", async () => {
    const { ids } = ctx;
    await createFee(ctx);
    const sale = await createSale(ctx, {
      paymentMethodId: ids.credit,
      cardMachineId: ids.mercadoPago,
      installments: 3,
      grossCents: 10000,
    });
    const response = await patch(sale.id, { paymentMethodId: ids.cash });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ cardMachineId: null, installments: null, feeCents: 0 });
  });

  it("FR-02: an edited October sale takes the rate in force on its date", async () => {
    const { ids } = ctx;
    const card = {
      cardMachineId: ids.mercadoPago,
      paymentMethodId: ids.debit,
      installmentsFrom: 1,
      installmentsTo: 1,
    };
    const october = await createFee(ctx, { ...card, ratePpm: 19900, validFrom: "2026-01-01" });
    const sale = await createSale(ctx, {
      cardMachineId: ids.mercadoPago,
      paymentMethodId: ids.debit,
      date: "2026-10-20",
      grossCents: 10000,
    });
    expect(sale.feeRatePpm).toBe(19900);
    // The table changes later: the sale keeps 1,99% until it is edited (FR-02).
    await createFee(ctx, { ...card, ratePpm: 14900, validFrom: "2026-11-01" });
    await ctx.app.inject({
      method: "PUT",
      url: `/api/card-fees/${october.id}`,
      payload: {
        ...card,
        ratePpm: 25000,
        validFrom: "2026-01-01",
      },
    });
    expect((await listSales("2026-10-20"))[0]!.feeRatePpm).toBe(19900);

    const edited = await patch(sale.id, { note: "conferido" });
    expect(edited.statusCode, edited.body).toBe(200);
    // The fee in force on 20/10 is now 2,50%; 1,49% only starts on 01/11.
    expect(edited.json()).toMatchObject({ feeRatePpm: 25000, feeCents: 250, netCents: 9750 });

    const moved = await patch(sale.id, { date: "2026-11-05" });
    expect(moved.json()).toMatchObject({ feeRatePpm: 14900, feeCents: 149, netCents: 9851 });
  });

  it("FR-02: an edit without a fee in force is blocked like a new sale", async () => {
    const { ids } = ctx;
    await createFee(ctx, { installmentsFrom: 1, installmentsTo: 1 });
    const sale = await createSale(ctx, {
      paymentMethodId: ids.credit,
      cardMachineId: ids.mercadoPago,
      grossCents: 10000,
    });
    const response = await patch(sale.id, { installments: 4 });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error:
        "Cadastre a taxa de Mercado Pago / Cartão de crédito / 4x antes de registrar esta venda",
      code: CARD_FEE_MISSING_CODE,
    });
    expect((await listSales(TODAY))[0]!.installments).toBe(1);
  });

  it("FR-03: blocks editing on a closed day and suggests reopening or a refund", async () => {
    const sale = await createSale(ctx, { date: "2026-11-10" });
    closeDay(ctx, "2026-11-10");
    const response = await patch(sale.id, { grossCents: 100 });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: CLOSED_DAY_MESSAGE, code: DAY_CLOSED_CODE });
    expect((await listSales("2026-11-10"))[0]!.grossCents).toBe(2500);
    expect((await saleAudit(ctx)).map((e) => e.action)).toEqual(["create"]);
  });

  it("RN-14: blocks moving a sale onto a closed day", async () => {
    const sale = await createSale(ctx);
    closeDay(ctx, "2026-11-10");
    const response = await patch(sale.id, { date: "2026-11-10" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: CLOSED_DAY_MESSAGE, code: DAY_CLOSED_CODE });
  });

  it("RN-14: blocks editing in a closed month", async () => {
    const sale = await createSale(ctx, { date: "2026-10-05" });
    closeMonth(ctx, "2026-10");
    const response = await patch(sale.id, { note: "x" });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe(
      "O mês 10/2026 está fechado. Reabra o mês e o dia para alterar esta venda ou registre um estorno.",
    );
  });

  it("RN-15: an edit cannot move a sale to a future date", async () => {
    const sale = await createSale(ctx);
    const response = await patch(sale.id, { date: "2026-11-19" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Não é possível registrar lançamentos com data futura.",
    });
  });

  it("FR-01: the machine and installment rules also apply to an edit", async () => {
    const { ids } = ctx;
    const sale = await createSale(ctx);
    expect((await patch(sale.id, { paymentMethodId: ids.debit })).json()).toEqual({
      error: "Escolha a maquininha.",
    });
    expect((await patch(sale.id, { cardMachineId: ids.pagSeguro })).json()).toEqual({
      error: "Dinheiro não usa maquininha.",
    });
    expect((await patch(sale.id, { installments: 2 })).json()).toEqual({
      error: "Dinheiro não permite parcelas.",
    });
  });

  it("FR-03: a new tab, method or machine must be active; the current inactive one is kept", async () => {
    const { ids } = ctx;
    const sale = await createSale(ctx, { saleCategoryId: ids.papelaria });
    await ctx.app.inject({
      method: "PATCH",
      url: `/api/sale-categories/${ids.papelaria}`,
      payload: { active: false },
    });
    // Keeping the inactive tab is fine.
    const kept = await patch(sale.id, { grossCents: 3000 });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(kept.json()).toMatchObject({ saleCategoryName: "Papelaria", grossCents: 3000 });

    // Moving another sale onto it is not.
    const other = await createSale(ctx);
    const moved = await patch(other.id, { saleCategoryId: ids.papelaria });
    expect(moved.statusCode).toBe(400);
    expect(moved.json()).toEqual({ error: "Escolha uma aba ativa." });
  });

  it("FR-03: validates the body and the id", async () => {
    const sale = await createSale(ctx);
    expect((await patch(sale.id, {})).json()).toEqual({ error: "Nada para alterar." });
    expect((await patch(sale.id, { grossCents: 0 })).json()).toEqual({
      error: "Informe um valor maior que zero.",
    });
    const missing = await patch(9999, { grossCents: 100 });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Venda não encontrada." });
    const bad = await ctx.app.inject({
      method: "PATCH",
      url: "/api/sales/abc",
      payload: { grossCents: 1 },
    });
    expect(bad.statusCode).toBe(404);
  });

  it("FR-03: an edit that changes nothing records no audit row", async () => {
    const sale = await createSale(ctx, { grossCents: 2500 });
    const response = await patch(sale.id, { grossCents: 2500 });
    expect(response.statusCode).toBe(200);
    expect((await saleAudit(ctx)).map((e) => e.action)).toEqual(["create"]);
  });
});

describe("FR-03: delete a sale on an open day (DELETE /api/sales/:id)", () => {
  it("FR-03: deleting removes the sale, the totals drop, and the audit keeps 'before'", async () => {
    const kept = await createSale(ctx, { grossCents: 1000 });
    const sale = await createSale(ctx, { grossCents: 2500, note: "engano" });

    const response = await remove(sale.id);
    expect(response.statusCode).toBe(204);
    expect(await listSales(TODAY)).toEqual([kept]);
    const day = await ctx.app.inject({ method: "GET", url: `/api/days/${TODAY}/sales` });
    expect(day.json().total).toEqual({ grossCents: 1000, feeCents: 0, netCents: 1000 });

    const [entry] = await saleAudit(ctx);
    expect(entry).toMatchObject({
      action: "delete",
      entityId: String(sale.id),
      before: { saleCategory: "Toner", grossCents: 2500, note: "engano" },
      after: null,
    });
  });

  it("FR-03: blocks deleting on a closed day and suggests reopening or a refund", async () => {
    const sale = await createSale(ctx, { date: "2026-11-10" });
    closeDay(ctx, "2026-11-10");
    const response = await remove(sale.id);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: CLOSED_DAY_MESSAGE, code: DAY_CLOSED_CODE });
    expect(await listSales("2026-11-10")).toHaveLength(1);
  });

  it("RN-14: blocks deleting in a closed month", async () => {
    const sale = await createSale(ctx, { date: "2026-10-05" });
    closeMonth(ctx, "2026-10");
    expect((await remove(sale.id)).statusCode).toBe(409);
  });

  it("FR-03: unknown ids answer 404", async () => {
    expect((await remove(9999)).statusCode).toBe(404);
    expect((await remove("abc")).statusCode).toBe(404);
  });
});

// Refunds and refunded sales (#6): see sales-refunds.test.ts.
