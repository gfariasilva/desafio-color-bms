import { describe, expect, it } from "vitest";
import { buildMonthSummary, monthBalance, monthSummaryResponseSchema } from "./month-summary";

describe("monthBalance (RN-10)", () => {
  it("RN-10: total geral de despesas = gerais + fixas; saldo = entrada − taxas − total", () => {
    expect(
      monthBalance({
        incomeCents: 3_221_665,
        feesCents: 11_380,
        generalExpensesCents: 53_845,
        fixedExpensesCents: 48_743,
      }),
    ).toEqual({ totalExpensesCents: 102_588, balanceCents: 3_107_697 });
  });

  it("RN-10: the saldo can be negative", () => {
    expect(
      monthBalance({
        incomeCents: 100_000,
        feesCents: 3_790,
        generalExpensesCents: 80_000,
        fixedExpensesCents: 150_000,
      }),
    ).toEqual({ totalExpensesCents: 230_000, balanceCents: -133_790 });
  });

  it("RN-10: refunds can make income and fees negative; the formula still holds", () => {
    expect(
      monthBalance({
        incomeCents: -5_000,
        feesCents: -190,
        generalExpensesCents: 0,
        fixedExpensesCents: 0,
      }),
    ).toEqual({ totalExpensesCents: 0, balanceCents: -4_810 });
  });

  it("RN-10: an empty month has a zero saldo", () => {
    expect(
      monthBalance({
        incomeCents: 0,
        feesCents: 0,
        generalExpensesCents: 0,
        fixedExpensesCents: 0,
      }),
    ).toEqual({ totalExpensesCents: 0, balanceCents: 0 });
  });
});

describe("buildMonthSummary (FR-23)", () => {
  const reports = {
    income: { yearMonth: "2026-10", total: { grossCents: 321_665, feeCents: 11_380 } },
    generalExpenses: { yearMonth: "2026-10", totalCents: 53_845 },
    fixedExpenses: { yearMonth: "2026-10", paidTotalCents: 48_743 },
  };

  it("FR-23: each line equals the matching total of FR-20, FR-21 and FR-22", () => {
    const summary = buildMonthSummary(reports);
    expect(summary).toEqual({
      yearMonth: "2026-10",
      incomeCents: 321_665,
      feesCents: 11_380,
      generalExpensesCents: 53_845,
      fixedExpensesCents: 48_743,
      totalExpensesCents: 102_588,
      balanceCents: 207_697,
    });
    expect(monthSummaryResponseSchema.parse(summary)).toEqual(summary);
  });

  it("refuses reports of different months", () => {
    expect(() =>
      buildMonthSummary({
        ...reports,
        fixedExpenses: { yearMonth: "2026-11", paidTotalCents: 0 },
      }),
    ).toThrow(RangeError);
  });
});
