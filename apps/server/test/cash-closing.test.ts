import { describe, expect, it } from "vitest";
import { CASH_CHANGED_CODE, DAY_CLOSED_CODE, NO_MOVEMENT_CODE } from "@color-bms/core";
import {
  closeDay,
  closeMonth,
  createFee,
  createSale,
  NOW,
  TODAY,
  useSalesApp,
  type SalesContext,
} from "./sales-fixture";
import { createExpense, postExpense } from "./expenses-fixture";
import { createCashWithdrawal, postCashWithdrawal } from "./cash-withdrawals-fixture";
import {
  closeDayWithCount,
  dayAudit,
  getCashClosing,
  getUnclosedDays,
  postClose,
} from "./cash-closing-fixture";

const ctx = useSalesApp();
const YESTERDAY = "2026-11-17";

/**
 * A full day of movement, today (18/11/2026):
 * - cash: R$ 50,00 sale; R$ 10,00 refund of yesterday's cash sale → cash sales R$ 40,00;
 * - not cash: R$ 30,00 PIX sale, R$ 150,00 credit sale (with a fee);
 * - expenses: R$ 45,00 cash from the till; R$ 20,00 PIX; R$ 10,00 cash **not** from the till;
 * - one R$ 30,00 sangria.
 * Yesterday has one R$ 25,00 cash sale, closed with R$ 125,00 counted.
 */
async function fullDay(c: SalesContext) {
  const yesterdaySale = await createSale(c, { date: YESTERDAY, grossCents: 2500 });
  await closeDayWithCount(c, YESTERDAY, { openingCashCents: 10000, countedCashCents: 12500 });

  await createSale(c, { grossCents: 5000 });
  const refund = await c.app.inject({
    method: "POST",
    url: `/api/sales/${yesterdaySale.id}/refunds`,
    payload: { refundCents: 1000, reason: "devolução" },
  });
  expect(refund.statusCode, refund.body).toBe(201);
  await createSale(c, { paymentMethodId: c.ids.pix, grossCents: 3000 });
  await createFee(c);
  await createSale(c, {
    paymentMethodId: c.ids.credit,
    cardMachineId: c.ids.mercadoPago,
    grossCents: 15000,
  });
  await createExpense(c, { amountCents: 4500 });
  await createExpense(c, { amountCents: 2000, paymentMeans: "pix" });
  await createExpense(c, { amountCents: 1000, paymentMeans: "cash", paidFromTill: false });
  await createCashWithdrawal(c, { amountCents: 3000 });
}

describe("FR-08: the closing screen data (GET /api/days/:date/cash-closing)", () => {
  it("FR-08: shows the RN-07 terms, with the opening cash pre-filled from the last count (A-12)", async () => {
    await fullDay(ctx);
    const preview = await getCashClosing(ctx, TODAY);
    expect(preview).toEqual({
      date: TODAY,
      status: "open",
      hasMovement: true,
      blocked: null,
      suggestedOpeningCashCents: 12500,
      suggestedFrom: YESTERDAY,
      cashSalesCents: 4000,
      tillExpensesCents: 4500,
      withdrawalsCents: 3000,
      closing: null,
    });
  });

  it("RN-07: card and PIX sales and PIX expenses do not affect expected cash", async () => {
    await createSale(ctx, { paymentMethodId: ctx.ids.pix, grossCents: 3000 });
    await createExpense(ctx, { amountCents: 2000, paymentMeans: "pix" });
    const preview = await getCashClosing(ctx, TODAY);
    expect(preview).toMatchObject({ hasMovement: true, cashSalesCents: 0, tillExpensesCents: 0 });
  });

  it("RN-07: the cash method is found by its flag, so renaming Dinheiro changes nothing", async () => {
    const rename = await ctx.app.inject({
      method: "PATCH",
      url: `/api/payment-methods/${ctx.ids.cash}`,
      payload: { name: "Espécie" },
    });
    expect(rename.statusCode, rename.body).toBe(200);
    await createSale(ctx, { grossCents: 2500 });
    expect((await getCashClosing(ctx, TODAY)).cashSalesCents).toBe(2500);
  });

  it("FR-08: first day of use: no opening cash is suggested", async () => {
    await createSale(ctx);
    const preview = await getCashClosing(ctx, TODAY);
    expect(preview).toMatchObject({ suggestedOpeningCashCents: null, suggestedFrom: null });
  });

  it("A-12: the suggestion comes from the latest closing before the date, not after it", async () => {
    await createSale(ctx, { date: "2026-11-16" });
    await closeDayWithCount(ctx, "2026-11-16", { openingCashCents: 0, countedCashCents: 1000 });
    await createSale(ctx, { date: YESTERDAY });
    await createSale(ctx);
    await closeDayWithCount(ctx, TODAY, { openingCashCents: 0, countedCashCents: 5000 });

    const preview = await getCashClosing(ctx, YESTERDAY);
    expect(preview).toMatchObject({ suggestedOpeningCashCents: 1000, suggestedFrom: "2026-11-16" });
  });

  it("A-12: a closed day without a count is skipped by the suggestion", async () => {
    await createSale(ctx, { date: "2026-11-15" });
    await closeDayWithCount(ctx, "2026-11-15", { openingCashCents: 0, countedCashCents: 700 });
    closeDay(ctx, "2026-11-16"); // a row with no cash fields, as the RN-14 test shortcut writes
    await createSale(ctx);
    const preview = await getCashClosing(ctx, TODAY);
    expect(preview).toMatchObject({ suggestedOpeningCashCents: 700, suggestedFrom: "2026-11-15" });
  });

  it("A-15: a day without movement says it does not need closing", async () => {
    const preview = await getCashClosing(ctx, TODAY);
    expect(preview).toMatchObject({
      hasMovement: false,
      blocked: "Este dia não tem movimento e não precisa ser fechado.",
      cashSalesCents: 0,
      tillExpensesCents: 0,
      withdrawalsCents: 0,
    });
  });

  it("FR-08: a sangria alone is movement", async () => {
    await createCashWithdrawal(ctx, { amountCents: 100 });
    expect(await getCashClosing(ctx, TODAY)).toMatchObject({ hasMovement: true, blocked: null });
  });

  it("rejects an invalid date", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/days/2026-02-30/cash-closing",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Data inválida." });
  });
});

describe("FR-08: close the day (POST /api/days/:date/close)", () => {
  it("FR-08: stores expected, counted and difference, closes the day and writes the audit row", async () => {
    await fullDay(ctx);
    const auditBefore = await dayAudit(ctx);

    const closed = await closeDayWithCount(ctx, TODAY, {
      openingCashCents: 12500,
      countedCashCents: 8500,
      note: "faltou troco",
    });
    // RN-07: 125,00 + 40,00 − 45,00 − 30,00 = 90,00 expected; 85,00 counted → −5,00.
    expect(closed).toMatchObject({
      date: TODAY,
      status: "closed",
      blocked: "O dia 18/11/2026 já está fechado.",
      closing: {
        openingCashCents: 12500,
        expectedCashCents: 9000,
        countedCashCents: 8500,
        differenceCents: -500,
        note: "faltou troco",
        closedAt: NOW.toISOString(),
      },
    });
    expect(await getCashClosing(ctx, TODAY)).toEqual(closed);

    const audit = await dayAudit(ctx);
    expect(audit).toHaveLength(auditBefore.length + 1);
    expect(audit[0]).toMatchObject({
      entity: "day",
      entityId: TODAY,
      action: "close",
      at: NOW.toISOString(),
      before: { status: "open" },
      after: {
        status: "closed",
        openingCashCents: 12500,
        cashSalesCents: 4000,
        tillExpensesCents: 4500,
        withdrawalsCents: 3000,
        expectedCashCents: 9000,
        countedCashCents: 8500,
        differenceCents: -500,
        note: "faltou troco",
      },
      reason: null,
    });
  });

  it("FR-08: a surplus is stored as a positive difference; the note is optional", async () => {
    await createSale(ctx, { grossCents: 2500 });
    const closed = await closeDayWithCount(ctx, TODAY, {
      openingCashCents: 0,
      countedCashCents: 2600,
    });
    expect(closed.closing).toMatchObject({
      expectedCashCents: 2500,
      differenceCents: 100,
      note: null,
    });
  });

  it("FR-08: the expected cash is recomputed by the server; a client value is only checked, never stored", async () => {
    await createSale(ctx, { grossCents: 2500 });
    const wrong = await postClose(ctx, TODAY, {
      openingCashCents: 0,
      countedCashCents: 2500,
      expectedCashCents: 1,
    });
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json()).toMatchObject({ code: CASH_CHANGED_CODE });

    const response = await postClose(ctx, TODAY, { openingCashCents: 0, countedCashCents: 2500 });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().closing).toMatchObject({ expectedCashCents: 2500, differenceCents: 0 });
  });

  it("FR-08: first day: the opening cash must be typed", async () => {
    await createSale(ctx);
    const response = await postClose(ctx, TODAY, { countedCashCents: 2500 });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Informe o troco inicial." });
    expect((await getCashClosing(ctx, TODAY)).status).toBe("open");
  });

  it("RN-14: after closing, sales, expenses and sangrias on that date are blocked", async () => {
    const sale = await createSale(ctx);
    await closeDayWithCount(ctx, TODAY, { openingCashCents: 0, countedCashCents: 2500 });

    const blocked = [
      await ctx.app.inject({
        method: "POST",
        url: "/api/sales",
        payload: {
          date: TODAY,
          saleCategoryId: ctx.ids.toner,
          paymentMethodId: ctx.ids.cash,
          grossCents: 100,
        },
      }),
      await ctx.app.inject({
        method: "PATCH",
        url: `/api/sales/${sale.id}`,
        payload: { grossCents: 100 },
      }),
      await ctx.app.inject({ method: "DELETE", url: `/api/sales/${sale.id}` }),
      await postExpense(ctx, {
        paymentDate: TODAY,
        expenseCategoryId: 1,
        amountCents: 100,
        paymentMeans: "cash",
      }),
      await postCashWithdrawal(ctx, { date: TODAY, amountCents: 100 }),
    ];
    for (const response of blocked) {
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().code).toBe(DAY_CLOSED_CODE);
    }
  });

  it("RN-14: a closed day cannot be closed again", async () => {
    await createSale(ctx);
    await closeDayWithCount(ctx, TODAY, { openingCashCents: 0, countedCashCents: 2500 });
    const response = await postClose(ctx, TODAY, { openingCashCents: 0, countedCashCents: 1 });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "O dia 18/11/2026 já está fechado.",
      code: DAY_CLOSED_CODE,
    });
    expect((await getCashClosing(ctx, TODAY)).closing?.countedCashCents).toBe(2500);
  });

  it("RN-14: a day of a closed month cannot be closed", async () => {
    await createSale(ctx, { date: "2026-10-30" });
    closeMonth(ctx, "2026-10");
    const response = await postClose(ctx, "2026-10-30", {
      openingCashCents: 0,
      countedCashCents: 2500,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "O mês 10/2026 está fechado. Reabra o mês antes.",
      code: DAY_CLOSED_CODE,
    });
  });

  it("RN-15: a future day cannot be closed", async () => {
    const response = await postClose(ctx, "2026-11-19", {
      openingCashCents: 0,
      countedCashCents: 0,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Não é possível fechar um dia futuro." });
  });

  it("FR-08: refuses the closing when the expected cash the screen showed is out of date", async () => {
    await createSale(ctx, { grossCents: 5000 });
    // The screen computed R$ 50,00 expected; then another cash sale came in.
    await createSale(ctx, { grossCents: 1000 });
    const response = await postClose(ctx, TODAY, {
      openingCashCents: 0,
      countedCashCents: 5000,
      expectedCashCents: 5000,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error:
        "Os lançamentos do dia mudaram desde que a tela foi aberta. Confira os valores e feche de novo.",
      code: CASH_CHANGED_CODE,
    });
    expect((await getCashClosing(ctx, TODAY)).status).toBe("open");
    expect(await dayAudit(ctx)).toEqual([]);
    expect(ctx.dayClosedCalls).toEqual([]);

    await closeDayWithCount(ctx, TODAY, {
      openingCashCents: 0,
      countedCashCents: 6000,
      expectedCashCents: 6000,
    });
  });

  it("A-15: a day without movement is not closed", async () => {
    const response = await postClose(ctx, TODAY, { openingCashCents: 0, countedCashCents: 0 });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Este dia não tem movimento e não precisa ser fechado.",
      code: NO_MOVEMENT_CODE,
    });
    expect(await dayAudit(ctx)).toEqual([]);
    expect(ctx.dayClosedCalls).toEqual([]);
  });

  it("rejects an invalid date", async () => {
    const response = await postClose(ctx, "18-11-2026", {
      openingCashCents: 0,
      countedCashCents: 0,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Data inválida." });
  });
});

describe("FR-08: exports and backup are queued after the closing (onDayClosed)", () => {
  it("FR-08: onDayClosed runs once, after the commit (the day is already closed)", async () => {
    await createSale(ctx);
    const statusSeenByHook: string[] = [];
    ctx.afterDayClosed = (date) => {
      const row = ctx.connection.sqlite
        .prepare("select status from days where date = ?")
        .get(date) as { status: string };
      statusSeenByHook.push(row.status);
    };
    await closeDayWithCount(ctx, TODAY, { openingCashCents: 0, countedCashCents: 2500 });
    expect(ctx.dayClosedCalls).toEqual([TODAY]);
    expect(statusSeenByHook).toEqual(["closed"]);

    // A refused closing does not call it.
    await postClose(ctx, TODAY, { openingCashCents: 0, countedCashCents: 2500 });
    expect(ctx.dayClosedCalls).toEqual([TODAY]);
  });

  it("FR-08: a failing onDayClosed does not undo the closing", async () => {
    await createSale(ctx);
    ctx.afterDayClosed = () => {
      throw new Error("OneDrive offline");
    };
    const response = await postClose(ctx, TODAY, { openingCashCents: 0, countedCashCents: 2500 });
    expect(response.statusCode, response.body).toBe(200);
    expect((await getCashClosing(ctx, TODAY)).status).toBe("closed");
  });

  it("FR-08: a rejecting async onDayClosed is caught and does not undo the closing", async () => {
    await createSale(ctx);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      ctx.afterDayClosed = () => Promise.reject(new Error("OneDrive offline"));
      const response = await postClose(ctx, TODAY, {
        openingCashCents: 0,
        countedCashCents: 2500,
      });
      expect(response.statusCode, response.body).toBe(200);
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect((await getCashClosing(ctx, TODAY)).status).toBe("closed");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("FR-27 (pilot slice): days left open (GET /api/days/unclosed)", () => {
  it("FR-27: lists the days before today with movement that are still open, oldest first", async () => {
    await createSale(ctx, { date: "2026-11-15" });
    await closeDayWithCount(ctx, "2026-11-15", { openingCashCents: 0, countedCashCents: 2500 });
    await createSale(ctx, { date: "2026-11-16" });
    await createExpense(ctx, { paymentDate: YESTERDAY });
    await createCashWithdrawal(ctx, { date: "2026-11-14" });
    await createSale(ctx, { date: TODAY });

    expect(await getUnclosedDays(ctx)).toEqual(["2026-11-14", "2026-11-16", YESTERDAY]);
  });

  it("FR-27: nothing to list when every earlier day with movement is closed", async () => {
    expect(await getUnclosedDays(ctx)).toEqual([]);
  });
});
