import { describe, expect, it } from "vitest";
import { CONTA_CONVERSION_REASON, fixedExpenseSchema } from "@color-bms/core";
import { closeMonth, createSale, TODAY, useSalesApp } from "./sales-fixture";
import { closeDayWithCount, dayAudit, getCashClosing } from "./cash-closing-fixture";
import { createCashWithdrawal, getDayCashWithdrawals } from "./cash-withdrawals-fixture";
import {
  auditOf,
  fixedEntry,
  getContaCandidates,
  getFixedMonth,
  postConvert,
} from "./fixed-expenses-fixture";

/**
 * #13: the one-off conversion of the pilot's interim records. Until #13, a bill paid with cash
 * from the till was a sangria whose note starts with "CONTA:" (#9). Each one becomes a paid
 * fixed expense (same date and amount, Dinheiro, paid from the till), confirmed by the owner.
 */

const ctx = useSalesApp();
const DAY = "2026-11-10";

/** 10/11: a R$ 500,00 cash sale and the "CONTA: Luz outubro" sangria of R$ 187,43, closed. */
async function closedDayWithConta() {
  await createSale(ctx, { date: DAY, grossCents: 50000 });
  const conta = await createCashWithdrawal(ctx, {
    date: DAY,
    amountCents: 18743,
    note: "CONTA: Luz outubro",
  });
  await createCashWithdrawal(ctx, { date: DAY, amountCents: 20000, note: "depósito no banco" });
  const closed = await closeDayWithCount(ctx, DAY, {
    openingCashCents: 10000,
    countedCashCents: 40000,
    note: "contado duas vezes",
  });
  return { conta, closed };
}

describe("#13: convert the pilot's CONTA: sangrias", () => {
  it("#13: lists only the sangrias whose note starts with CONTA:, with the suggested name", async () => {
    const { conta } = await closedDayWithConta();
    const candidates = await getContaCandidates(ctx);
    expect(candidates.withdrawals).toEqual([
      {
        id: conta.id,
        date: DAY,
        amountCents: 18743,
        note: "CONTA: Luz outubro",
        suggestedName: "Luz outubro",
        dayClosed: true,
      },
    ]);
    // The pending bills the owner can pick, from any month.
    expect(candidates.pendingExpenses.map((entry) => entry.label)).toContain("Luz");
    expect(candidates.pendingExpenses.every((entry) => entry.status === "pending")).toBe(true);
  });

  it("#13: on a closed day: reopens, converts into a pending bill, and closes again with the same counted cash and difference", async () => {
    const { conta, closed } = await closedDayWithConta();
    const luz = await fixedEntry(ctx, "Luz");

    const response = await postConvert(ctx, conta.id, {
      target: "existing",
      fixedExpenseId: luz.id,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(fixedExpenseSchema.parse(response.json())).toMatchObject({
      id: luz.id,
      status: "paid",
      amountCents: 18743,
      paymentDate: DAY,
      paymentMeans: "cash",
      paidFromTill: true,
    });

    // The sangria is gone; the bill took its place in RN-07.
    expect((await getDayCashWithdrawals(ctx, DAY)).withdrawals).toHaveLength(1);
    const after = await getCashClosing(ctx, DAY);
    expect(after.status).toBe("closed");
    expect(after).toMatchObject({ tillExpensesCents: 18743, withdrawalsCents: 20000 });
    // Expected cash unchanged: the same counted cash and difference.
    expect(after.closing).toMatchObject({
      openingCashCents: closed.closing!.openingCashCents,
      expectedCashCents: closed.closing!.expectedCashCents,
      countedCashCents: closed.closing!.countedCashCents,
      differenceCents: closed.closing!.differenceCents,
      note: "contado duas vezes",
    });
    // FR-08: the re-closing runs the after-close hook (backup, spreadsheet).
    expect(ctx.dayClosedCalls).toEqual([DAY, DAY]);

    // FR-18: reopen and close of the day, delete of the sangria, payment of the bill.
    const days = await dayAudit(ctx);
    expect(days.map((entry) => entry.action)).toEqual(["close", "reopen", "close"]);
    expect(days[1]!.reason).toBe(CONTA_CONVERSION_REASON);
    const [deleted] = await auditOf(ctx, "cash_withdrawal");
    expect(deleted).toMatchObject({
      action: "delete",
      entityId: String(conta.id),
      reason: CONTA_CONVERSION_REASON,
    });
    const [paid] = await auditOf(ctx, "expense");
    expect(paid).toMatchObject({
      action: "update",
      entityId: String(luz.id),
      after: { expenseStatus: "paid", amountCents: 18743, paidFromTill: true },
      reason: CONTA_CONVERSION_REASON,
    });

    expect((await getContaCandidates(ctx)).withdrawals).toHaveLength(0);
  });

  it("#13: into a new one-off bill of the sangria's month, on an open day", async () => {
    await createSale(ctx, { grossCents: 50000 });
    const conta = await createCashWithdrawal(ctx, { amountCents: 4500, note: "CONTA: IPTU" });

    const response = await postConvert(ctx, conta.id, {
      target: "one_off",
      name: "IPTU",
      group: "government_fees",
    });
    expect(response.statusCode, response.body).toBe(200);
    const created = fixedExpenseSchema.parse(response.json());
    expect(created).toMatchObject({
      label: "IPTU",
      oneOff: true,
      group: "government_fees",
      referenceMonth: "2026-11",
      dueDate: TODAY,
      status: "paid",
      amountCents: 4500,
      paymentDate: TODAY,
      paymentMeans: "cash",
      paidFromTill: true,
    });
    expect((await getFixedMonth(ctx)).paidTotalCents).toBe(4500);
    expect((await getCashClosing(ctx, TODAY)).status).toBe("open");
    expect(await dayAudit(ctx)).toHaveLength(0);
    expect(ctx.dayClosedCalls).toEqual([]);
  });

  it("#13: refuses a sangria that is not a CONTA:, a bill that is not pending and a closed month", async () => {
    const { conta } = await closedDayWithConta();
    const plain = (await getDayCashWithdrawals(ctx, DAY)).withdrawals.find(
      (withdrawal) => withdrawal.note === "depósito no banco",
    )!;
    const notConta = await postConvert(ctx, plain.id, {
      target: "one_off",
      name: "x",
      group: "general",
    });
    expect(notConta.statusCode).toBe(409);

    const missing = await postConvert(ctx, 999999, {
      target: "one_off",
      name: "x",
      group: "general",
    });
    expect(missing.statusCode).toBe(404);

    // Paying a bill that is already paid fails and rolls everything back: the day stays closed.
    const luz = await fixedEntry(ctx, "Luz");
    await ctx.app.inject({ method: "POST", url: `/api/fixed-expenses/${luz.id}/dismiss` });
    const dismissed = await postConvert(ctx, conta.id, {
      target: "existing",
      fixedExpenseId: luz.id,
    });
    expect(dismissed.statusCode).toBe(409);
    expect((await getCashClosing(ctx, DAY)).status).toBe("closed");
    expect((await getDayCashWithdrawals(ctx, DAY)).withdrawals).toHaveLength(2);
    expect((await dayAudit(ctx)).map((entry) => entry.action)).toEqual(["close"]);

    closeMonth(ctx, "2026-11");
    const closedMonth = await postConvert(ctx, conta.id, {
      target: "one_off",
      name: "Luz outubro",
      group: "general",
    });
    expect(closedMonth.statusCode).toBe(409);
    expect(closedMonth.json().error).toMatch(/^O mês 11\/2026 está fechado/);
  });
});
