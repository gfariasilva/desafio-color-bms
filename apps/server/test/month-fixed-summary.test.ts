import { describe, expect, it } from "vitest";
import {
  auditListResponseSchema,
  fixedExpenseSchema,
  monthFixedExpensesReportSchema,
  monthGeneralExpensesResponseSchema,
  monthIncomeResponseSchema,
  monthSummarySchema,
  type FixedExpense,
} from "@color-bms/core";
import { createCashWithdrawal } from "./cash-withdrawals-fixture";
import { createExpense, expenseCategoryId } from "./expenses-fixture";
import { fixedEntry, getFixedMonth, payEntry, postAction } from "./fixed-expenses-fixture";
import { createFee, createSale, TODAY, useSalesApp, type SalesContext } from "./sales-fixture";

/**
 * FR-22 (Relatório Mês – Despesas fixas) and FR-23 (Resumo mensal), RN-09 and RN-10.
 * The clock is 18/11/2026 (`useSalesApp`), so November's bills are already generated.
 */

const ctx = useSalesApp();

async function getReport(c: SalesContext, yearMonth: string, report: string) {
  const response = await c.app.inject({
    method: "GET",
    url: `/api/months/${yearMonth}/reports/${report}`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as unknown;
}

const getFixedReport = async (yearMonth: string) =>
  monthFixedExpensesReportSchema.parse(await getReport(ctx, yearMonth, "fixed-expenses"));
const getSummary = async (yearMonth: string) =>
  monthSummarySchema.parse(await getReport(ctx, yearMonth, "summary"));

const rows = (report: { groups: { rows: FixedExpense[] }[] }) =>
  report.groups.flatMap((group) => group.rows);

/** A one-off fixed entry (FR-11) of `referenceMonth`, pending. */
async function oneOff(
  c: SalesContext,
  input: { referenceMonth: string; description: string; group?: string; expected?: number },
): Promise<FixedExpense> {
  const response = await c.app.inject({
    method: "POST",
    url: "/api/fixed-expenses",
    payload: {
      referenceMonth: input.referenceMonth,
      description: input.description,
      group: input.group ?? "general",
      dueDate: `${input.referenceMonth}-10`,
      expectedAmountCents: input.expected ?? null,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return fixedExpenseSchema.parse(response.json());
}

describe("FR-22: Relatório Mês – Despesas fixas (GET /api/months/:yearMonth/reports/fixed-expenses)", () => {
  it("FR-22: Luz paid R$ 187,43 on 10/11 is in November's paid total", async () => {
    const luz = await fixedEntry(ctx, "Luz");
    await payEntry(ctx, luz.id); // FR-12 example: R$ 187,43, 10/11/2026, PIX.
    const das = await fixedEntry(ctx, "DAS");
    await payEntry(ctx, das.id, { amountCents: 31000, paymentDate: "2026-11-15" });

    const report = await getFixedReport("2026-11");
    expect(report.groups.map((group) => group.group)).toEqual(["general", "government_fees"]);
    const row = rows(report).find((r) => r.label === "Luz")!;
    expect(row).toMatchObject({
      status: "paid",
      amountCents: 18743,
      paymentDate: "2026-11-10",
      paymentMeans: "pix",
      countsInMonth: true,
    });
    expect(report.groups[0]!.paidCents).toBe(18743);
    expect(report.groups[1]!.paidCents).toBe(31000);
    expect(report.paidTotalCents).toBe(18743 + 31000);
    // RN-09: the same figure as "Pago no mês" on Contas do mês (#13).
    expect((await getFixedMonth(ctx)).paidTotalCents).toBe(report.paidTotalCents);
    // Every bill generated for November is listed.
    expect(rows(report)).toHaveLength((await getFixedMonth(ctx)).expenses.length);
  });

  it("FR-12 / RN-09: October's bill paid on 10/11 is listed and counted in November", async () => {
    const october = await oneOff(ctx, { referenceMonth: "2026-10", description: "Luz outubro" });
    await payEntry(ctx, october.id, { amountCents: 19000, paymentDate: "2026-11-10" });

    const november = await getFixedReport("2026-11");
    expect(rows(november).find((r) => r.label === "Luz outubro")).toMatchObject({
      referenceMonth: "2026-10",
      countsInMonth: true,
    });
    expect(november.paidTotalCents).toBe(19000);

    const octoberReport = await getFixedReport("2026-10");
    expect(rows(octoberReport).find((r) => r.label === "Luz outubro")).toMatchObject({
      countsInMonth: false,
    });
    expect(octoberReport.paidTotalCents).toBe(0);
  });

  it("FR-22: pending total is informative; a dismissed entry is listed but in no total", async () => {
    const iptu = await oneOff(ctx, {
      referenceMonth: "2026-11",
      description: "IPTU",
      expected: 25000,
    });
    const tfe = await oneOff(ctx, {
      referenceMonth: "2026-11",
      description: "TFE avulsa",
      group: "government_fees",
      expected: 9000,
    });
    const dismissed = await postAction(ctx, tfe.id, "dismiss", { reason: "fora do mês" });
    expect(dismissed.statusCode, dismissed.body).toBe(200);

    const report = await getFixedReport("2026-11");
    const generated = (await getFixedMonth(ctx)).expenses.filter((e) => !e.oneOff);
    const generatedExpected = generated.reduce((sum, e) => sum + (e.expectedAmountCents ?? 0), 0);
    expect(report.pendingTotalCents).toBe(25000 + generatedExpected);
    expect(report.pendingWithoutExpectedCount).toBe(
      generated.filter((e) => e.expectedAmountCents === null).length,
    );
    expect(rows(report).find((r) => r.id === iptu.id)).toMatchObject({ status: "pending" });
    expect(rows(report).find((r) => r.id === tfe.id)).toMatchObject({
      status: "dismissed",
      countsInMonth: false,
    });
    expect(report.groups[1]!.pendingCents).toBe(
      generated
        .filter((e) => e.group === "government_fees")
        .reduce((sum, e) => sum + (e.expectedAmountCents ?? 0), 0),
    );
    expect(report.paidTotalCents).toBe(0);
  });

  it("FR-22: is read-only (no audit row)", async () => {
    const before = await ctx.app.inject({ method: "GET", url: "/api/audit" });
    await getFixedReport("2026-11");
    await getSummary("2026-11");
    const after = await ctx.app.inject({ method: "GET", url: "/api/audit" });
    expect(auditListResponseSchema.parse(after.json()).entries).toEqual(
      auditListResponseSchema.parse(before.json()).entries,
    );
  });

  it("rejects an invalid month with 400", async () => {
    for (const report of ["fixed-expenses", "summary"]) {
      const response = await ctx.app.inject({
        method: "GET",
        url: `/api/months/2026-13/reports/${report}`,
      });
      expect(response.statusCode, report).toBe(400);
      expect(response.json().error).toBe("Mês inválido.");
    }
  });
});

describe("FR-23: Resumo mensal (GET /api/months/:yearMonth/reports/summary)", () => {
  /** A month with sales, a card fee, general expenses and fixed expenses paid. */
  async function seedNovember() {
    await createFee(ctx, { ratePpm: 37900 });
    await createSale(ctx, { date: "2026-11-02", grossCents: 10000 });
    await createSale(ctx, {
      date: "2026-11-03",
      paymentMethodId: ctx.ids.credit,
      cardMachineId: ctx.ids.mercadoPago,
      installments: 1,
      grossCents: 15000, // RN-03 example: fee R$ 5,69.
    });
    await createExpense(ctx, { paymentDate: "2026-11-04", amountCents: 4500 });
    await createExpense(ctx, {
      paymentDate: "2026-11-05",
      expenseCategoryId: await expenseCategoryId(ctx, "Kalunga"),
      amountCents: 30000,
      paymentMeans: "boleto",
    });
    const luz = await fixedEntry(ctx, "Luz");
    await payEntry(ctx, luz.id); // R$ 187,43 on 10/11.
    const october = await oneOff(ctx, { referenceMonth: "2026-10", description: "Água outubro" });
    await payEntry(ctx, october.id, { amountCents: 6000, paymentDate: "2026-11-12" });
  }

  it("FR-23: every summary line equals the totals of FR-20, FR-21 and FR-22", async () => {
    await seedNovember();

    const income = monthIncomeResponseSchema.parse(await getReport(ctx, "2026-11", "income"));
    const general = monthGeneralExpensesResponseSchema.parse(
      await getReport(ctx, "2026-11", "general-expenses"),
    );
    const fixed = await getFixedReport("2026-11");
    const summary = await getSummary("2026-11");

    expect(summary.grossCents).toBe(income.total.grossCents);
    expect(summary.feeCents).toBe(income.total.feeCents);
    expect(summary.generalExpensesCents).toBe(general.totalCents);
    expect(summary.fixedExpensesCents).toBe(fixed.paidTotalCents);

    // RN-10 with the figures of this month.
    expect(summary).toEqual({
      yearMonth: "2026-11",
      grossCents: 25000,
      feeCents: 569,
      generalExpensesCents: 34500,
      fixedExpensesCents: 18743 + 6000,
      totalExpensesCents: 34500 + 24743,
      balanceCents: 25000 - 569 - (34500 + 24743),
    });
  });

  it("RN-10: cash withdrawals do not change the monthly balance", async () => {
    await seedNovember();
    const before = await getSummary("2026-11");
    await createCashWithdrawal(ctx, { date: TODAY, amountCents: 30000 });
    await createCashWithdrawal(ctx, { date: "2026-11-02", amountCents: 5000, note: "CONTA: Gás" });
    expect(await getSummary("2026-11")).toEqual(before);
  });

  it("RN-10: pending and dismissed fixed expenses are out of the balance", async () => {
    const iptu = await oneOff(ctx, {
      referenceMonth: "2026-11",
      description: "IPTU",
      expected: 25000,
    });
    const taxa = await oneOff(ctx, {
      referenceMonth: "2026-11",
      description: "Taxa",
      expected: 900,
    });
    await postAction(ctx, taxa.id, "dismiss", {});
    const summary = await getSummary("2026-11");
    expect(summary.fixedExpensesCents).toBe(0);
    expect(summary.balanceCents).toBe(0);
    expect(iptu.status).toBe("pending");
  });

  it("FR-23: a month with no movement is all zero", async () => {
    expect(await getSummary("2026-04")).toEqual({
      yearMonth: "2026-04",
      grossCents: 0,
      feeCents: 0,
      generalExpensesCents: 0,
      fixedExpensesCents: 0,
      totalExpensesCents: 0,
      balanceCents: 0,
    });
  });
});
