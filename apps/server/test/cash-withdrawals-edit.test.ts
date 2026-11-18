import { describe, expect, it } from "vitest";
import { CASH_WITHDRAWAL_TEXTS, cashWithdrawalSchema, DAY_CLOSED_CODE } from "@color-bms/core";
import { closeDay, closeMonth, NOW, TODAY, useSalesApp } from "./sales-fixture";
import {
  cashWithdrawalAudit,
  createCashWithdrawal,
  getDayCashWithdrawals,
} from "./cash-withdrawals-fixture";

const ctx = useSalesApp();

function patch(id: number | string, payload: Record<string, unknown>) {
  return ctx.app.inject({ method: "PATCH", url: `/api/cash-withdrawals/${id}`, payload });
}

function remove(id: number | string) {
  return ctx.app.inject({ method: "DELETE", url: `/api/cash-withdrawals/${id}` });
}

const CLOSED_DAY_MESSAGE =
  "O dia 10/11/2026 está fechado. Reabra o dia para alterar ou excluir esta sangria.";

describe("FR-07: edit a sangria (PATCH /api/cash-withdrawals/:id)", () => {
  it("FR-07: editing applies the change, recalculates the day total and audits before/after", async () => {
    const withdrawal = await createCashWithdrawal(ctx);
    const response = await patch(withdrawal.id, { amountCents: 25000, note: "guardado no cofre" });
    expect(response.statusCode, response.body).toBe(200);
    expect(cashWithdrawalSchema.parse(response.json())).toEqual({
      ...withdrawal,
      amountCents: 25000,
      note: "guardado no cofre",
    });
    expect((await getDayCashWithdrawals(ctx, TODAY)).totalCents).toBe(25000);

    const [entry] = await cashWithdrawalAudit(ctx);
    expect(entry).toMatchObject({
      entity: "cash_withdrawal",
      entityId: String(withdrawal.id),
      action: "update",
      at: NOW.toISOString(),
      before: { date: TODAY, amountCents: 30000, note: "depósito no banco" },
      after: { date: TODAY, amountCents: 25000, note: "guardado no cofre" },
    });
  });

  it("FR-07: a sangria can move to another open day, and its note can be cleared", async () => {
    const withdrawal = await createCashWithdrawal(ctx);
    const edited = cashWithdrawalSchema.parse(
      (await patch(withdrawal.id, { date: "2026-11-17", note: "" })).json(),
    );
    expect(edited).toMatchObject({ date: "2026-11-17", note: null });
    expect((await getDayCashWithdrawals(ctx, TODAY)).withdrawals).toEqual([]);
    expect((await getDayCashWithdrawals(ctx, "2026-11-17")).totalCents).toBe(30000);
  });

  it("FR-07: an edit that changes nothing writes no audit row", async () => {
    const withdrawal = await createCashWithdrawal(ctx);
    const response = await patch(withdrawal.id, { amountCents: withdrawal.amountCents });
    expect(response.statusCode).toBe(200);
    expect((await cashWithdrawalAudit(ctx)).map((entry) => entry.action)).toEqual(["create"]);
  });

  it("RN-14: blocks editing a sangria on a closed day", async () => {
    const withdrawal = await createCashWithdrawal(ctx, { date: "2026-11-10" });
    closeDay(ctx, "2026-11-10");
    const response = await patch(withdrawal.id, { amountCents: 1 });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: CLOSED_DAY_MESSAGE, code: DAY_CLOSED_CODE });
    expect((await cashWithdrawalAudit(ctx)).map((entry) => entry.action)).toEqual(["create"]);
  });

  it("RN-14: blocks moving a sangria to a closed day or into a closed month", async () => {
    const withdrawal = await createCashWithdrawal(ctx);
    closeDay(ctx, "2026-11-10");
    closeMonth(ctx, "2026-10");
    const toClosedDay = await patch(withdrawal.id, { date: "2026-11-10" });
    expect(toClosedDay.statusCode).toBe(409);
    expect(toClosedDay.json()).toMatchObject({ code: DAY_CLOSED_CODE });
    expect((await patch(withdrawal.id, { date: "2026-10-05" })).statusCode).toBe(409);
  });

  it("RN-15: blocks moving a sangria to a future date", async () => {
    const withdrawal = await createCashWithdrawal(ctx);
    const response = await patch(withdrawal.id, { date: "2026-11-19" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Não é possível registrar lançamentos com data futura.",
    });
  });

  it("FR-07: an unknown sangria is a 404; an empty edit is a 400", async () => {
    expect((await patch(9999, { amountCents: 100 })).statusCode).toBe(404);
    expect((await patch("abc", { amountCents: 100 })).json()).toEqual({
      error: CASH_WITHDRAWAL_TEXTS.notFound,
    });
    const withdrawal = await createCashWithdrawal(ctx);
    const empty = await patch(withdrawal.id, {});
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toEqual({ error: "Nada para alterar." });
  });
});

describe("FR-07: delete a sangria (DELETE /api/cash-withdrawals/:id)", () => {
  it("FR-07: deleting removes it from the day and audits the values before", async () => {
    const withdrawal = await createCashWithdrawal(ctx);
    const response = await remove(withdrawal.id);
    expect(response.statusCode).toBe(204);
    expect(await getDayCashWithdrawals(ctx, TODAY)).toMatchObject({
      withdrawals: [],
      totalCents: 0,
    });
    const [entry] = await cashWithdrawalAudit(ctx);
    expect(entry).toMatchObject({
      entity: "cash_withdrawal",
      entityId: String(withdrawal.id),
      action: "delete",
      before: { date: TODAY, amountCents: 30000, note: "depósito no banco" },
      after: null,
    });
  });

  it("RN-14: blocks deleting a sangria on a closed day", async () => {
    const withdrawal = await createCashWithdrawal(ctx, { date: "2026-11-10" });
    closeDay(ctx, "2026-11-10");
    const response = await remove(withdrawal.id);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: CLOSED_DAY_MESSAGE, code: DAY_CLOSED_CODE });
    expect((await getDayCashWithdrawals(ctx, "2026-11-10")).withdrawals).toHaveLength(1);
  });

  it("FR-07: deleting an unknown sangria is a 404", async () => {
    const response = await remove(9999);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: CASH_WITHDRAWAL_TEXTS.notFound });
  });
});
