import { describe, expect, it } from "vitest";
import { DAY_CLOSED_CODE } from "@color-bms/core";
import { closeDay, closeMonth, NOW, TODAY, useSalesApp } from "./sales-fixture";
import { createExpense, expenseAudit, getDayExpenses } from "./expenses-fixture";
import {
  cashWithdrawalAudit,
  createCashWithdrawal,
  getDayCashWithdrawals,
  postCashWithdrawal,
} from "./cash-withdrawals-fixture";

const ctx = useSalesApp();

describe("FR-07: register a sangria (POST /api/cash-withdrawals)", () => {
  it('FR-07: registers a R$ 300,00 sangria with "depósito no banco" on an open day, with its audit row', async () => {
    const response = await postCashWithdrawal(ctx, {
      date: TODAY,
      amountCents: 30000,
      note: "depósito no banco",
    });
    expect(response.statusCode, response.body).toBe(201);
    const withdrawal = response.json();
    expect(withdrawal).toEqual({
      id: expect.any(Number),
      date: TODAY,
      createdAt: NOW.toISOString(),
      amountCents: 30000,
      note: "depósito no banco",
    });

    // RN-07: the day's sangrias total is what the cash closing subtracts (#9).
    const day = await getDayCashWithdrawals(ctx, TODAY);
    expect(day).toEqual({ date: TODAY, lock: null, withdrawals: [withdrawal], totalCents: 30000 });

    const [entry] = await cashWithdrawalAudit(ctx);
    expect(entry).toMatchObject({
      entity: "cash_withdrawal",
      entityId: String(withdrawal.id),
      action: "create",
      at: NOW.toISOString(),
      before: null,
      after: { date: TODAY, amountCents: 30000, note: "depósito no banco" },
    });
  });

  it("FR-07: a sangria is not an expense (day and month expense totals unchanged)", async () => {
    await createExpense(ctx, { amountCents: 4500 });
    await createCashWithdrawal(ctx, { amountCents: 30000 });

    const expenses = await getDayExpenses(ctx, TODAY);
    expect(expenses).toMatchObject({
      totalCents: 4500,
      paidFromTillCents: 4500,
      monthGeneralTotalCents: 4500,
    });
    expect(expenses.expenses).toHaveLength(1);
    expect((await expenseAudit(ctx)).map((entry) => entry.entity)).toEqual(["expense"]);
  });

  it("FR-07: the note is optional and trimmed", async () => {
    const without = await createCashWithdrawal(ctx, { note: undefined });
    expect(without.note).toBeNull();
    const blank = await createCashWithdrawal(ctx, { note: "  " });
    expect(blank.note).toBeNull();
    const trimmed = await createCashWithdrawal(ctx, { note: "  CONTA: Luz outubro " });
    expect(trimmed.note).toBe("CONTA: Luz outubro");
  });

  it("FR-07: the value must be greater than 0", async () => {
    const response = await postCashWithdrawal(ctx, { date: TODAY, amountCents: 0 });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Informe um valor maior que zero." });
    expect(await cashWithdrawalAudit(ctx)).toEqual([]);
  });

  it("RN-15: future dates are not accepted", async () => {
    const response = await postCashWithdrawal(ctx, { date: "2026-11-19", amountCents: 100 });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Não é possível registrar lançamentos com data futura.",
    });
  });

  it("RN-14: the date cannot fall on a closed day", async () => {
    closeDay(ctx, "2026-11-10");
    const response = await postCashWithdrawal(ctx, { date: "2026-11-10", amountCents: 100 });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error:
        "O dia 10/11/2026 está fechado. Reabra o dia para registrar ou alterar lançamentos nessa data.",
      code: DAY_CLOSED_CODE,
    });
    expect(await cashWithdrawalAudit(ctx)).toEqual([]);
  });

  it("RN-14: nor in a closed month", async () => {
    closeMonth(ctx, "2026-10");
    const response = await postCashWithdrawal(ctx, { date: "2026-10-31", amountCents: 100 });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: DAY_CLOSED_CODE });
  });
});

describe("FR-07: the day's sangrias (GET /api/days/:date/cash-withdrawals)", () => {
  it("FR-07: lists only the day's sangrias, in the order they were registered, with the total", async () => {
    const first = await createCashWithdrawal(ctx, { amountCents: 30000 });
    await createCashWithdrawal(ctx, { date: "2026-11-17", amountCents: 999 });
    const second = await createCashWithdrawal(ctx, { amountCents: 5050, note: null });
    const day = await getDayCashWithdrawals(ctx, TODAY);
    expect(day.withdrawals.map((withdrawal) => withdrawal.id)).toEqual([first.id, second.id]);
    expect(day.totalCents).toBe(35050);
  });

  it("RN-14: a closed day comes with the lock message", async () => {
    closeDay(ctx, "2026-11-10");
    const day = await getDayCashWithdrawals(ctx, "2026-11-10");
    expect(day.lock).toBe(
      "O dia 10/11/2026 está fechado. Reabra o dia para alterar ou excluir esta sangria.",
    );
  });

  it("FR-07: an invalid date is a 400 with a pt-BR message", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/days/2026-02-30/cash-withdrawals",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Data inválida." });
  });
});
