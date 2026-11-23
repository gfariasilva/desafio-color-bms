import { describe, expect, it } from "vitest";
import { buildMonthSummary } from "./month-summary";

/** The three month reports, reduced to the totals the summary reads. */
function reports(totals: {
  grossCents: number;
  feeCents: number;
  generalCents: number;
  fixedCents: number;
}) {
  return {
    income: {
      yearMonth: "2026-11",
      total: {
        grossCents: totals.grossCents,
        feeCents: totals.feeCents,
        netCents: totals.grossCents - totals.feeCents,
      },
    },
    generalExpenses: { totalCents: totals.generalCents },
    fixedExpenses: { paidTotalCents: totals.fixedCents },
  };
}

describe("buildMonthSummary (FR-23, RN-10)", () => {
  it("RN-10: total expenses = general + fixed; balance = gross − fees − total", () => {
    const summary = buildMonthSummary(
      reports({ grossCents: 3201665, feeCents: 11380, generalCents: 32500, fixedCents: 49743 }),
    );
    expect(summary).toEqual({
      yearMonth: "2026-11",
      grossCents: 3201665,
      feeCents: 11380,
      generalExpensesCents: 32500,
      fixedExpensesCents: 49743,
      totalExpensesCents: 32500 + 49743,
      balanceCents: 3201665 - 11380 - (32500 + 49743),
    });
  });

  it("RN-10: balance can be negative", () => {
    const summary = buildMonthSummary(
      reports({ grossCents: 10000, feeCents: 379, generalCents: 5000, fixedCents: 150000 }),
    );
    expect(summary.totalExpensesCents).toBe(155000);
    expect(summary.balanceCents).toBe(10000 - 379 - 155000);
    expect(summary.balanceCents).toBeLessThan(0);
  });

  it("RN-10: refunds can make the month's income and fees negative", () => {
    // RN-04: a month with only a refund of R$ 50,00 at 3,79% (fee −1,90 given back).
    const summary = buildMonthSummary(
      reports({ grossCents: -5000, feeCents: -190, generalCents: 0, fixedCents: 0 }),
    );
    expect(summary.balanceCents).toBe(-5000 - -190);
  });

  it("RN-10: an empty month is all zero", () => {
    const summary = buildMonthSummary(
      reports({ grossCents: 0, feeCents: 0, generalCents: 0, fixedCents: 0 }),
    );
    expect(summary.totalExpensesCents).toBe(0);
    expect(summary.balanceCents).toBe(0);
  });
});
