import { describe, expect, it } from "vitest";
import {
  auditListResponseSchema,
  DAY_CLOSED_CODE,
  daySalesResponseSchema,
  formatCents,
  REFUND_EXCEEDS_SALE_CODE,
  SALE_HAS_REFUNDS_CODE,
  saleListResponseSchema,
  saleSchema,
} from "@color-bms/core";
import {
  closeDay,
  closeMonth,
  createFee,
  createSale,
  NOW,
  TODAY,
  useSalesApp,
} from "./sales-fixture";

const ctx = useSalesApp();

function refund(id: number | string, payload: Record<string, unknown>) {
  return ctx.app.inject({ method: "POST", url: `/api/sales/${id}/refunds`, payload });
}

function remove(id: number) {
  return ctx.app.inject({ method: "DELETE", url: `/api/sales/${id}` });
}

async function listSales(date: string) {
  const response = await ctx.app.inject({ method: "GET", url: `/api/sales?date=${date}` });
  return saleListResponseSchema.parse(response.json()).sales;
}

async function refundAudit() {
  const response = await ctx.app.inject({ method: "GET", url: "/api/audit?entity=refund" });
  return auditListResponseSchema.parse(response.json()).entries;
}

/** FR-04's example: R$ 80,00 on 10/11, Débito, PagSeguro (1,99%). */
async function debitSaleOn10Nov() {
  await createFee(ctx, {
    cardMachineId: ctx.ids.pagSeguro,
    paymentMethodId: ctx.ids.debit,
    installmentsFrom: 1,
    installmentsTo: 1,
    ratePpm: 19900,
  });
  return createSale(ctx, {
    date: "2026-11-10",
    paymentMethodId: ctx.ids.debit,
    cardMachineId: ctx.ids.pagSeguro,
    grossCents: 8000,
  });
}

describe("FR-04: register a refund (POST /api/sales/:id/refunds)", () => {
  it("FR-04: creates a refund today, linked to the sale, with proportional negative fee; the original is unchanged", async () => {
    const sale = await debitSaleOn10Nov();
    closeDay(ctx, "2026-11-10");

    const response = await refund(sale.id, { refundCents: 8000, reason: "produto com defeito" });
    expect(response.statusCode, response.body).toBe(201);
    const created = saleSchema.parse(response.json());
    expect(created).toMatchObject({
      date: TODAY,
      createdAt: NOW.toISOString(),
      type: "refund",
      saleCategoryId: sale.saleCategoryId,
      paymentMethodId: sale.paymentMethodId,
      cardMachineId: sale.cardMachineId,
      installments: sale.installments,
      grossCents: -8000,
      feeRatePpm: 19900,
      feeCents: -159,
      netCents: -7841,
      originalSaleId: sale.id,
      originalSaleDate: "2026-11-10",
      reason: "produto com defeito",
      refundedCents: 0,
    });

    // The original sale does not change; it only reports how much was refunded.
    const [original] = await listSales("2026-11-10");
    expect(original).toEqual({ ...sale, refundedCents: 8000 });

    // FR-18: one audit row for the refund, with the reason.
    const audit = await refundAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entity: "refund",
      entityId: String(created.id),
      action: "create",
      before: null,
      reason: "produto com defeito",
      after: {
        date: TODAY,
        originalSaleId: sale.id,
        originalSaleDate: "2026-11-10",
        saleCategory: "Toner",
        paymentMethod: "Cartão de débito",
        cardMachine: "PagSeguro",
        grossCents: -8000,
        feeRatePpm: 19900,
        feeCents: -159,
        netCents: -7841,
        reason: "produto com defeito",
      },
    });
  });

  it("FR-04: blocks a refund that would pass the original value", async () => {
    const sale = await debitSaleOn10Nov();
    const first = await refund(sale.id, { refundCents: 5000, reason: "devolução parcial" });
    expect(first.statusCode, first.body).toBe(201);

    const response = await refund(sale.id, { refundCents: 4000, reason: "mais uma" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: `O estorno passa do valor da venda: restam ${formatCents(3000)} para estornar.`,
      code: REFUND_EXCEEDS_SALE_CODE,
    });
    expect(await listSales(TODAY)).toHaveLength(1);

    // Exactly what is left is accepted.
    const rest = await refund(sale.id, { refundCents: 3000, reason: "resto" });
    expect(rest.statusCode, rest.body).toBe(201);
    const [original] = await listSales("2026-11-10");
    expect(original!.refundedCents).toBe(8000);
  });

  it("FR-04: the reason is required", async () => {
    const sale = await createSale(ctx, { date: "2026-11-17" });
    for (const payload of [{ refundCents: 100 }, { refundCents: 100, reason: "  " }]) {
      const response = await refund(sale.id, payload);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Informe o motivo do estorno." });
    }
    expect(await refundAudit()).toEqual([]);
  });

  it("FR-04: a partial refund keeps the original rate (RN-04)", async () => {
    await createFee(ctx, { ratePpm: 37900 });
    const sale = await createSale(ctx, {
      date: "2026-11-17",
      paymentMethodId: ctx.ids.credit,
      cardMachineId: ctx.ids.mercadoPago,
      installments: 3,
      grossCents: 15000,
    });
    // The fee table changes after the sale: the refund still uses 3,79%.
    await createFee(ctx, { ratePpm: 50000, validFrom: "2026-11-18" });

    const response = await refund(sale.id, { refundCents: 3000, reason: "troca" });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      installments: 3,
      grossCents: -3000,
      feeRatePpm: 37900,
      feeCents: -114,
      netCents: -2886,
    });
  });

  it("RN-14: blocks a refund when today is closed", async () => {
    const sale = await createSale(ctx, { date: "2026-11-17" });
    closeDay(ctx, TODAY);
    const response = await refund(sale.id, { refundCents: 100, reason: "defeito" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: DAY_CLOSED_CODE });
    expect(response.json().error).toContain("18/11/2026 está fechado");
  });

  it("RN-14: blocks a refund when the current month is closed", async () => {
    const sale = await createSale(ctx, { date: "2026-11-17" });
    closeMonth(ctx, "2026-11");
    const response = await refund(sale.id, { refundCents: 100, reason: "defeito" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: DAY_CLOSED_CODE });
  });

  it("FR-04: a sale from today is edited or deleted, not refunded", async () => {
    const sale = await createSale(ctx);
    const response = await refund(sale.id, { refundCents: 100, reason: "defeito" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Venda de hoje: edite ou exclua a venda em vez de estornar.",
    });
  });

  it("FR-04: a refund cannot be refunded, and unknown sales are 404", async () => {
    const sale = await createSale(ctx, { date: "2026-11-17" });
    const created = saleSchema.parse(
      (await refund(sale.id, { refundCents: 100, reason: "defeito" })).json(),
    );
    const response = await refund(created.id, { refundCents: 100, reason: "defeito" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Um estorno não pode ser estornado." });

    expect((await refund(9999, { refundCents: 100, reason: "x" })).statusCode).toBe(404);
    expect((await refund("abc", { refundCents: 100, reason: "x" })).statusCode).toBe(404);
  });

  it("FR-04: the refund keeps a tab that was deactivated since the sale", async () => {
    const sale = await createSale(ctx, { date: "2026-11-17", saleCategoryId: ctx.ids.chaveiro });
    const off = await ctx.app.inject({
      method: "PATCH",
      url: `/api/sale-categories/${ctx.ids.chaveiro}`,
      payload: { active: false },
    });
    expect(off.statusCode, off.body).toBe(200);
    const response = await refund(sale.id, { refundCents: 2500, reason: "defeito" });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({ saleCategoryName: "Chaveiro" });
  });

  it("RN-05: the refund shows in today's view under the original tab and reduces the totals", async () => {
    const sale = await debitSaleOn10Nov();
    await createSale(ctx, { grossCents: 2500 }); // a cash sale today
    await refund(sale.id, { refundCents: 8000, reason: "produto com defeito" });

    const response = await ctx.app.inject({ method: "GET", url: `/api/days/${TODAY}/sales` });
    const day = daySalesResponseSchema.parse(response.json());
    const toner = day.tabs.find((tab) => tab.name === "Toner")!;
    expect(toner.sales.map((row) => row.type)).toEqual(["sale", "refund"]);
    expect(toner.methods).toEqual([
      expect.objectContaining({ paymentMethodName: "Dinheiro", grossCents: 2500 }),
      expect.objectContaining({
        paymentMethodName: "Cartão de débito",
        grossCents: -8000,
        feeCents: -159,
        netCents: -7841,
      }),
    ]);
    expect(day.total).toEqual({ grossCents: -5500, feeCents: -159, netCents: -5341 });
  });
});

describe("FR-04 and FR-03: changing refunds and refunded sales", () => {
  async function refundOf(saleDate = "2026-11-17") {
    const sale = await createSale(ctx, { date: saleDate });
    const response = await refund(sale.id, { refundCents: 1000, reason: "defeito" });
    expect(response.statusCode, response.body).toBe(201);
    return { sale, refund: saleSchema.parse(response.json()) };
  }

  it("FR-03: a sale with refunds cannot be edited or deleted", async () => {
    const { sale } = await refundOf();
    const responses = [
      await ctx.app.inject({
        method: "PATCH",
        url: `/api/sales/${sale.id}`,
        payload: { grossCents: 100 },
      }),
      await remove(sale.id),
    ];
    for (const response of responses) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: "Esta venda tem estornos e não pode ser alterada nem excluída.",
        code: SALE_HAS_REFUNDS_CODE,
      });
    }
  });

  it("FR-04: a refund is never edited (delete it and register it again)", async () => {
    const { refund: created } = await refundOf();
    const response = await ctx.app.inject({
      method: "PATCH",
      url: `/api/sales/${created.id}`,
      payload: { note: "x" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Estornos não podem ser editados. Exclua o estorno e registre outro.",
    });
  });

  it("RN-14: a refund on an open day can be deleted; the audit keeps it and the amount is free again", async () => {
    const { sale, refund: created } = await refundOf();
    const response = await remove(created.id);
    expect(response.statusCode, response.body).toBe(204);
    expect(await listSales(TODAY)).toEqual([]);
    const [original] = await listSales("2026-11-17");
    expect(original!.refundedCents).toBe(0);

    const audit = await refundAudit();
    expect(audit.map((entry) => entry.action)).toEqual(["delete", "create"]);
    expect(audit[0]).toMatchObject({
      entityId: String(created.id),
      after: null,
      before: { grossCents: -1000, originalSaleId: sale.id, reason: "defeito" },
    });

    // The whole sale can be refunded again.
    expect((await refund(sale.id, { refundCents: 2500, reason: "x" })).statusCode).toBe(201);
  });

  it("RN-14: blocks deleting a refund on a closed day", async () => {
    const { refund: created } = await refundOf();
    closeDay(ctx, TODAY);
    const response = await remove(created.id);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "O dia 18/11/2026 está fechado. Reabra o dia para excluir este estorno.",
      code: DAY_CLOSED_CODE,
    });
  });
});

describe("RN-14: the day view tells how to delete a refund on a closed day", () => {
  it("RN-14: refundLock never suggests a refund", async () => {
    closeDay(ctx, TODAY);
    const response = await ctx.app.inject({ method: "GET", url: `/api/days/${TODAY}/sales` });
    const day = daySalesResponseSchema.parse(response.json());
    expect(day.refundLock).toBe(
      "O dia 18/11/2026 está fechado. Reabra o dia para excluir este estorno.",
    );
  });
});
