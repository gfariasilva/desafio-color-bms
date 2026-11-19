import { describe, expect, it } from "vitest";
import {
  dayCashClosingResponseSchema,
  DAY_NOT_CLOSED_CODE,
  MONTH_CLOSED_CODE,
} from "@color-bms/core";
import {
  closeDay,
  closeMonth,
  createSale,
  TODAY,
  useSalesApp,
  type SalesContext,
} from "./sales-fixture";
import {
  closeDayWithCount,
  dayAudit,
  getCashClosing,
  getUnclosedDays,
} from "./cash-closing-fixture";

const ctx = useSalesApp();
const YESTERDAY = "2026-11-17";

function postReopen(c: SalesContext, date: string, payload: Record<string, unknown>) {
  return c.app.inject({ method: "POST", url: `/api/days/${date}/reopen`, payload });
}

/** Yesterday: one R$ 25,00 cash sale, closed with R$ 100,00 opening and R$ 120,00 counted. */
async function closedYesterday(c: SalesContext) {
  await createSale(c, { date: YESTERDAY, grossCents: 2500 });
  return closeDayWithCount(c, YESTERDAY, {
    openingCashCents: 10000,
    countedCashCents: 12000,
    note: "faltou troco",
  });
}

describe("FR-09: reopen a day (POST /api/days/:date/reopen)", () => {
  it("FR-09: reopens a closed day in an open month; the previous closing goes to the audit log", async () => {
    await closedYesterday(ctx);

    const response = await postReopen(ctx, YESTERDAY, { reason: "  venda esquecida  " });
    expect(response.statusCode, response.body).toBe(200);
    const reopened = dayCashClosingResponseSchema.parse(response.json());
    // The day is open again and shows the closing form data (FR-08): a new closing is required.
    expect(reopened).toMatchObject({
      date: YESTERDAY,
      status: "open",
      blocked: null,
      reopenBlocked: null,
      closing: null,
      cashSalesCents: 2500,
    });

    const reopenEntry = (await dayAudit(ctx)).find((entry) => entry.action === "reopen");
    expect(reopenEntry).toMatchObject({
      entity: "day",
      entityId: YESTERDAY,
      reason: "venda esquecida",
      before: {
        status: "closed",
        openingCashCents: 10000,
        expectedCashCents: 12500,
        countedCashCents: 12000,
        differenceCents: -500,
        note: "faltou troco",
        // RN-07 terms of the closing, as in its own audit row.
        cashSalesCents: 2500,
        tillExpensesCents: 0,
        withdrawalsCents: 0,
      },
      after: { status: "open" },
    });
  });

  it("A-12: a reopened day suggests the opening cash it was closed with", async () => {
    await closedYesterday(ctx);
    const reopened = await postReopen(ctx, YESTERDAY, { reason: "venda esquecida" });
    expect(dayCashClosingResponseSchema.parse(reopened.json())).toMatchObject({
      suggestedOpeningCashCents: 10000,
      suggestedFrom: YESTERDAY,
    });
  });

  it("FR-09: records can be added again on a reopened day (RN-14)", async () => {
    await closedYesterday(ctx);
    const locked = await ctx.app.inject({
      method: "POST",
      url: "/api/sales",
      payload: {
        date: YESTERDAY,
        saleCategoryId: ctx.ids.toner,
        paymentMethodId: ctx.ids.cash,
        grossCents: 500,
      },
    });
    expect(locked.statusCode).toBe(409);

    expect((await postReopen(ctx, YESTERDAY, { reason: "venda esquecida" })).statusCode).toBe(200);
    await createSale(ctx, { date: YESTERDAY, grossCents: 500 });
    expect((await getCashClosing(ctx, YESTERDAY)).cashSalesCents).toBe(3000);
  });

  it("FR-09: a reopened earlier day is listed as not closed again (FR-27)", async () => {
    await closedYesterday(ctx);
    expect(await getUnclosedDays(ctx)).toEqual([]);
    await postReopen(ctx, YESTERDAY, { reason: "conferir sangria" });
    expect(await getUnclosedDays(ctx)).toEqual([YESTERDAY]);
  });

  it("FR-09: the day can be closed again; the new closing overwrites the old one and calls onDayClosed again", async () => {
    await closedYesterday(ctx);
    expect(ctx.dayClosedCalls).toEqual([YESTERDAY]);
    await postReopen(ctx, YESTERDAY, { reason: "venda esquecida" });
    await createSale(ctx, { date: YESTERDAY, grossCents: 500 });

    const reclosed = await closeDayWithCount(ctx, YESTERDAY, {
      openingCashCents: 10000,
      countedCashCents: 13000,
    });
    expect(reclosed.closing).toMatchObject({
      openingCashCents: 10000,
      expectedCashCents: 13000,
      countedCashCents: 13000,
      differenceCents: 0,
      note: null,
    });
    // FR-09 "gerando de novo a planilha diária": the exports hook runs for the new closing.
    expect(ctx.dayClosedCalls).toEqual([YESTERDAY, YESTERDAY]);
    expect((await dayAudit(ctx)).map((entry) => entry.action)).toEqual([
      "close",
      "reopen",
      "close",
    ]);
  });

  it("FR-09: refuses to reopen a day in a closed month and points to FR-17", async () => {
    closeDay(ctx, "2026-10-30");
    closeMonth(ctx, "2026-10");

    const response = await postReopen(ctx, "2026-10-30", { reason: "venda esquecida" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "O mês 10/2026 está fechado. Reabra o mês antes de reabrir o dia.",
      code: MONTH_CLOSED_CODE,
    });
    expect((await getCashClosing(ctx, "2026-10-30")).status).toBe("closed");
    expect(await dayAudit(ctx)).toEqual([]);
  });

  it("FR-09: the closing screen says before reopening that the month must be reopened", async () => {
    closeDay(ctx, "2026-10-30");
    closeMonth(ctx, "2026-10");
    expect((await getCashClosing(ctx, "2026-10-30")).reopenBlocked).toBe(
      "O mês 10/2026 está fechado. Reabra o mês antes de reabrir o dia.",
    );
  });

  it("FR-09: refuses without a reason (400) and the day stays closed", async () => {
    await closedYesterday(ctx);
    for (const payload of [{}, { reason: "   " }]) {
      const response = await postReopen(ctx, YESTERDAY, payload);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: "Informe o motivo da reabertura." });
    }
    expect((await getCashClosing(ctx, YESTERDAY)).status).toBe("closed");
    expect((await dayAudit(ctx)).map((entry) => entry.action)).toEqual(["close"]);
  });

  it("FR-09: refuses to reopen a day that is not closed (409)", async () => {
    await createSale(ctx);
    const response = await postReopen(ctx, TODAY, { reason: "engano" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "O dia 18/11/2026 não está fechado.",
      code: DAY_NOT_CLOSED_CODE,
    });
    // An open day has nothing to reopen.
    expect((await getCashClosing(ctx, TODAY)).reopenBlocked).toBeNull();
  });

  it("FR-09: a day cannot be reopened twice", async () => {
    await closedYesterday(ctx);
    expect((await postReopen(ctx, YESTERDAY, { reason: "engano" })).statusCode).toBe(200);
    const again = await postReopen(ctx, YESTERDAY, { reason: "engano" });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: DAY_NOT_CLOSED_CODE });
  });

  it("FR-09: refuses an invalid date (400)", async () => {
    const response = await postReopen(ctx, "2026-02-30", { reason: "engano" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "Data inválida." });
  });
});
