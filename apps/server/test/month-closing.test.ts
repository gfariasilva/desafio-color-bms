import { describe, expect, it } from "vitest";
import {
  fixedExpenseSchema,
  MONTH_ALREADY_CLOSED_CODE,
  MONTH_CLOSED_CODE,
  MONTH_NOT_CLOSED_CODE,
  monthClosingResponseSchema,
  PENDING_DAYS_CODE,
  type CreateOneOffFixedExpenseInput,
} from "@color-bms/core";
import { createSale, NOW, useSalesApp, type SalesContext } from "./sales-fixture";
import { closeDayWithCount, getCashClosing } from "./cash-closing-fixture";
import { postCashWithdrawal } from "./cash-withdrawals-fixture";
import { postExpense, expenseCategoryId } from "./expenses-fixture";
import { auditOf, getFixedMonth, postAction } from "./fixed-expenses-fixture";

/**
 * FR-16 / FR-17: closing and reopening a month. The clock is 18/11/2026, so October has ended
 * and can be closed; November can only be closed from 30/11 on.
 */
const ctx = useSalesApp();

function postMonth(c: SalesContext, yearMonth: string, action: "close" | "reopen", payload = {}) {
  return c.app.inject({ method: "POST", url: `/api/months/${yearMonth}/${action}`, payload });
}

async function getMonthClosing(c: SalesContext, yearMonth: string) {
  const response = await c.app.inject({ method: "GET", url: `/api/months/${yearMonth}/closing` });
  expect(response.statusCode, response.body).toBe(200);
  return monthClosingResponseSchema.parse(response.json());
}

async function closeMonthOk(c: SalesContext, yearMonth: string) {
  const response = await postMonth(c, yearMonth, "close");
  expect(response.statusCode, response.body).toBe(200);
  return monthClosingResponseSchema.parse(response.json());
}

/** A R$ 25,00 cash sale on `date`, then the day closed with R$ 100,00 opening. */
async function closedDayWithSale(c: SalesContext, date: string) {
  await createSale(c, { date, grossCents: 2500 });
  await closeDayWithCount(c, date, { openingCashCents: 10000, countedCashCents: 12500 });
}

async function createOneOffBill(c: SalesContext, input: Partial<CreateOneOffFixedExpenseInput>) {
  const response = await c.app.inject({
    method: "POST",
    url: "/api/fixed-expenses",
    payload: {
      referenceMonth: "2026-10",
      description: "IPTU",
      group: "general",
      dueDate: "2026-10-20",
      expectedAmountCents: 15000,
      ...input,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return fixedExpenseSchema.parse(response.json());
}

/** Lets the not-awaited after-commit hook run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("FR-16: close the month (POST /api/months/:yearMonth/close)", () => {
  it("FR-16: closes the month when every day with movement is closed, and locks it", async () => {
    await closedDayWithSale(ctx, "2026-10-15");
    await closedDayWithSale(ctx, "2026-10-31");

    const closed = await closeMonthOk(ctx, "2026-10");
    expect(closed).toMatchObject({
      yearMonth: "2026-10",
      status: "closed",
      closedAt: NOW.toISOString(),
      pendingDays: [],
      closeBlocked: null,
    });

    // FR-18: one audit row, with no reason (closing needs only a confirmation).
    const audit = await auditOf(ctx, "month");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entity: "month",
      entityId: "2026-10",
      action: "close",
      before: { status: "open" },
      after: { status: "closed", pendingFixedExpenses: 0 },
      reason: null,
    });

    // The after-commit hook (#22 backup, #28 spreadsheet) runs once with the month.
    await flush();
    expect(ctx.monthClosedCalls).toEqual(["2026-10"]);
  });

  it("FR-16 / RN-14: no day, sale or expense of a closed month can be changed", async () => {
    await closedDayWithSale(ctx, "2026-10-15");
    await closeMonthOk(ctx, "2026-10");

    // A new sale, expense or sangria dated in the month is refused.
    const sale = await ctx.app.inject({
      method: "POST",
      url: "/api/sales",
      payload: {
        date: "2026-10-20",
        saleCategoryId: ctx.ids.toner,
        paymentMethodId: ctx.ids.cash,
        grossCents: 1000,
      },
    });
    expect(sale.statusCode).toBe(409);
    const expense = await postExpense(ctx, {
      paymentDate: "2026-10-20",
      expenseCategoryId: await expenseCategoryId(ctx, "Abastecimento moto"),
      amountCents: 4500,
      paymentMeans: "cash",
    });
    expect(expense.statusCode).toBe(409);
    const withdrawal = await postCashWithdrawal(ctx, {
      date: "2026-10-20",
      amountCents: 1000,
      note: "banco",
    });
    expect(withdrawal.statusCode).toBe(409);

    // A day of the month cannot be reopened (FR-09) nor closed.
    const reopenDay = await ctx.app.inject({
      method: "POST",
      url: "/api/days/2026-10-15/reopen",
      payload: { reason: "venda esquecida" },
    });
    expect(reopenDay.statusCode).toBe(409);
    expect(reopenDay.json()).toMatchObject({ code: MONTH_CLOSED_CODE });
    expect((await getCashClosing(ctx, "2026-10-15")).reopenBlocked).toBe(
      "O mês 10/2026 está fechado. Reabra o mês antes de reabrir o dia.",
    );
  });

  it("FR-16: lists the pending days with movement and blocks", async () => {
    await closedDayWithSale(ctx, "2026-10-15");
    await createSale(ctx, { date: "2026-10-03" });
    await createSale(ctx, { date: "2026-10-31" });
    // Another month's open day is not pending for October.
    await createSale(ctx, { date: "2026-09-30" });

    const view = await getMonthClosing(ctx, "2026-10");
    expect(view.pendingDays).toEqual(["2026-10-03", "2026-10-31"]);
    expect(view.closeBlocked).toBe(
      "Feche os dias com movimento ainda abertos antes de fechar o mês 10/2026: 03/10/2026, 31/10/2026.",
    );

    const response = await postMonth(ctx, "2026-10", "close");
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: view.closeBlocked, code: PENDING_DAYS_CODE });
    expect((await getMonthClosing(ctx, "2026-10")).status).toBe("open");
    expect(await auditOf(ctx, "month")).toEqual([]);
    await flush();
    expect(ctx.monthClosedCalls).toEqual([]);
  });

  it("FR-16 / A-15: days without movement do not need closing; a reopened day does", async () => {
    await closedDayWithSale(ctx, "2026-10-15");
    // Reopened, then its only sale deleted: no movement left, so not pending.
    const sale = await createSale(ctx, { date: "2026-10-20" });
    await closeDayWithCount(ctx, "2026-10-20", { openingCashCents: 0, countedCashCents: 2500 });
    await ctx.app.inject({
      method: "POST",
      url: "/api/days/2026-10-15/reopen",
      payload: { reason: "conferir" },
    });
    await ctx.app.inject({
      method: "POST",
      url: "/api/days/2026-10-20/reopen",
      payload: { reason: "venda errada" },
    });
    await ctx.app.inject({
      method: "DELETE",
      url: `/api/sales/${sale.id}`,
      payload: { reason: "venda errada" },
    });

    expect((await getMonthClosing(ctx, "2026-10")).pendingDays).toEqual(["2026-10-15"]);
  });

  it("FR-16: warns about pending fixed expenses of the month but closes; they stay pending", async () => {
    await closedDayWithSale(ctx, "2026-10-15");
    const iptu = await createOneOffBill(ctx, { description: "IPTU" });
    const tfe = await createOneOffBill(ctx, { description: "TFE", dueDate: "2026-10-10" });
    const paid = await createOneOffBill(ctx, { description: "Água" });
    const dismissed = await createOneOffBill(ctx, { description: "Taxa extra" });
    const payPaid = await postAction(ctx, paid.id, "pay", {
      amountCents: 5000,
      paymentDate: "2026-11-10",
      paymentMeans: "pix",
    });
    expect(payPaid.statusCode, payPaid.body).toBe(200);
    expect((await postAction(ctx, dismissed.id, "dismiss", {})).statusCode).toBe(200);
    // November's bills (generated for the current month) are not October's.

    const view = await getMonthClosing(ctx, "2026-10");
    expect(view.closeBlocked).toBeNull();
    // Only the pending ones of reference month October, by due date.
    expect(view.pendingFixedExpenses.map((bill) => bill.id)).toEqual([tfe.id, iptu.id]);

    const closed = await closeMonthOk(ctx, "2026-10");
    expect(closed.status).toBe("closed");
    expect(closed.pendingFixedExpenses.map((bill) => bill.label)).toEqual(["TFE", "IPTU"]);
    expect((await auditOf(ctx, "month"))[0]?.after).toMatchObject({ pendingFixedExpenses: 2 });

    // They stay pending and can still be paid in an open month (RN-09: they count then).
    const october = await getFixedMonth(ctx, "2026-10");
    expect(october.expenses.find((bill) => bill.id === iptu.id)?.status).toBe("pending");
    const pay = await postAction(ctx, iptu.id, "pay", {
      amountCents: 15000,
      paymentDate: "2026-11-18",
      paymentMeans: "pix",
    });
    expect(pay.statusCode, pay.body).toBe(200);
  });

  it("FR-16: a month with no movement can be closed", async () => {
    const closed = await closeMonthOk(ctx, "2026-09");
    expect(closed).toMatchObject({ status: "closed", pendingDays: [] });
  });

  it("FR-16: the current month cannot be closed before its last day", async () => {
    const view = await getMonthClosing(ctx, "2026-11");
    expect(view).toMatchObject({ status: "open", lastDate: "2026-11-30" });
    expect(view.closeBlocked).toBe(
      "O mês 11/2026 ainda não terminou. Ele pode ser fechado a partir de 30/11/2026.",
    );

    const response = await postMonth(ctx, "2026-11", "close");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: view.closeBlocked });
    // The current month's row exists (FR-11 generation) and is still open.
    expect((await getMonthClosing(ctx, "2026-11")).status).toBe("open");
  });

  it("FR-16: a closed month cannot be closed again", async () => {
    await closeMonthOk(ctx, "2026-10");
    const response = await postMonth(ctx, "2026-10", "close");
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "O mês 10/2026 já está fechado.",
      code: MONTH_ALREADY_CLOSED_CODE,
    });
    expect(await auditOf(ctx, "month")).toHaveLength(1);
  });

  it("FR-16: a failing onMonthClosed hook never undoes the closing", async () => {
    ctx.afterMonthClosed = () => {
      throw new Error("backup failed");
    };
    await closeMonthOk(ctx, "2026-10");
    await flush();
    expect(ctx.monthClosedCalls).toEqual(["2026-10"]);
    expect((await getMonthClosing(ctx, "2026-10")).status).toBe("closed");
  });

  it("FR-16: an invalid month is a 400", async () => {
    for (const url of ["/api/months/2026-13/closing", "/api/months/2026-1/closing"]) {
      const response = await ctx.app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Mês inválido." });
    }
    expect((await postMonth(ctx, "outubro", "close")).statusCode).toBe(400);
  });
});

describe("FR-17: reopen the month (POST /api/months/:yearMonth/reopen)", () => {
  it("FR-17: reopens with a reason; the days stay closed and can then be reopened one by one", async () => {
    await closedDayWithSale(ctx, "2026-10-15");
    await closeMonthOk(ctx, "2026-10");

    const response = await postMonth(ctx, "2026-10", "reopen", { reason: "  venda esquecida " });
    expect(response.statusCode, response.body).toBe(200);
    expect(monthClosingResponseSchema.parse(response.json())).toMatchObject({
      status: "open",
      closedAt: null,
      pendingDays: [],
      closeBlocked: null,
    });

    const reopenEntry = (await auditOf(ctx, "month")).find((entry) => entry.action === "reopen");
    expect(reopenEntry).toMatchObject({
      entityId: "2026-10",
      before: { status: "closed" },
      after: { status: "open" },
      reason: "venda esquecida",
    });

    // The day is still closed, but can be reopened now (FR-09).
    const day = await getCashClosing(ctx, "2026-10-15");
    expect(day.status).toBe("closed");
    expect(day.reopenBlocked).toBeNull();
    const reopenDay = await ctx.app.inject({
      method: "POST",
      url: "/api/days/2026-10-15/reopen",
      payload: { reason: "venda esquecida" },
    });
    expect(reopenDay.statusCode, reopenDay.body).toBe(200);
  });

  it("FR-17: the reason is required", async () => {
    await closeMonthOk(ctx, "2026-10");
    for (const payload of [{}, { reason: "   " }]) {
      const response = await postMonth(ctx, "2026-10", "reopen", payload);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Informe o motivo da reabertura." });
    }
    expect((await getMonthClosing(ctx, "2026-10")).status).toBe("closed");
  });

  it("FR-17: an open month cannot be reopened", async () => {
    const response = await postMonth(ctx, "2026-10", "reopen", { reason: "teste" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "O mês 10/2026 não está fechado.",
      code: MONTH_NOT_CLOSED_CODE,
    });
    expect(await auditOf(ctx, "month")).toEqual([]);
  });

  it("FR-17: a reopened month can be closed again", async () => {
    await closeMonthOk(ctx, "2026-10");
    await postMonth(ctx, "2026-10", "reopen", { reason: "conferir" });
    await closeMonthOk(ctx, "2026-10");
    expect((await auditOf(ctx, "month")).map((entry) => entry.action).sort()).toEqual([
      "close",
      "close",
      "reopen",
    ]);
    await flush();
    expect(ctx.monthClosedCalls).toEqual(["2026-10", "2026-10"]);
  });
});
