import { describe, expect, it } from "vitest";
import type { MonthSummary } from "../reports/month-summary";
import {
  buildMonthComparison,
  comparisonPeriods,
  formatDayRange,
  monthComparisonSchema,
  type PeriodTotals,
} from "./month-comparison";

describe("comparisonPeriods (FR-24, A-13)", () => {
  it("FR-24: on 18/11 compares 01–18/11 with 01–18/10", () => {
    expect(comparisonPeriods("2026-11-18")).toEqual({
      currentMonth: "2026-11",
      previousMonth: "2026-10",
      current: { from: "2026-11-01", to: "2026-11-18" },
      previous: { from: "2026-10-01", to: "2026-10-18" },
    });
  });

  it("FR-24: on day 1 compares only the first day of each month", () => {
    expect(comparisonPeriods("2026-11-01")).toMatchObject({
      current: { from: "2026-11-01", to: "2026-11-01" },
      previous: { from: "2026-10-01", to: "2026-10-01" },
    });
  });

  it("FR-24: a shorter previous month stops at its last day (31/03 → 01–28/02)", () => {
    expect(comparisonPeriods("2027-03-31")).toMatchObject({
      previousMonth: "2027-02",
      current: { from: "2027-03-01", to: "2027-03-31" },
      previous: { from: "2027-02-01", to: "2027-02-28" },
    });
    expect(comparisonPeriods("2027-03-29").previous.to).toBe("2027-02-28");
    // 31/12 → 30/11.
    expect(comparisonPeriods("2026-12-31").previous.to).toBe("2026-11-30");
  });

  it("FR-24: in a leap year February ends on the 29th", () => {
    expect(comparisonPeriods("2028-03-30").previous).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("FR-24: in January the previous month is December of the year before", () => {
    expect(comparisonPeriods("2027-01-15")).toEqual({
      currentMonth: "2027-01",
      previousMonth: "2026-12",
      current: { from: "2027-01-01", to: "2027-01-15" },
      previous: { from: "2026-12-01", to: "2026-12-15" },
    });
  });

  it("FR-24: rejects a date that is not a civil date", () => {
    expect(() => comparisonPeriods("18/11/2026")).toThrow(RangeError);
  });
});

describe("formatDayRange (FR-24)", () => {
  it("FR-24: formats the compared days compactly", () => {
    expect(formatDayRange({ from: "2026-11-01", to: "2026-11-18" })).toBe("01–18/11");
    expect(formatDayRange({ from: "2027-02-01", to: "2027-02-28" })).toBe("01–28/02");
    expect(formatDayRange({ from: "2026-11-01", to: "2026-11-01" })).toBe("01–01/11");
    expect(formatDayRange({ from: "2026-10-25", to: "2026-11-05" })).toBe("25/10–05/11");
  });
});

const totals = (values: Partial<PeriodTotals> = {}): PeriodTotals => ({
  grossCents: 0,
  feeCents: 0,
  generalExpensesCents: 0,
  fixedExpensesCents: 0,
  ...values,
});

const october: MonthSummary = {
  yearMonth: "2026-10",
  grossCents: 2_000_000,
  feeCents: 40_000,
  generalExpensesCents: 300_000,
  fixedExpensesCents: 500_000,
  totalExpensesCents: 800_000,
  balanceCents: 1_160_000,
};

describe("buildMonthComparison (FR-24, RN-10, RN-11)", () => {
  it("FR-24: the four indicators follow RN-10, with the RN-11 variation and the reference month", () => {
    const comparison = buildMonthComparison({
      today: "2026-11-18",
      current: totals({
        grossCents: 1_500_000,
        feeCents: 30_000,
        generalExpensesCents: 200_000,
        fixedExpensesCents: 100_000,
      }),
      previous: totals({
        grossCents: 1_000_000,
        feeCents: 20_000,
        generalExpensesCents: 150_000,
        fixedExpensesCents: 250_000,
      }),
      previousMonth: { summary: october, hasData: true },
    });

    expect(monthComparisonSchema.parse(comparison)).toEqual(comparison);
    expect(comparison).toMatchObject({
      today: "2026-11-18",
      currentMonth: "2026-11",
      previousMonth: "2026-10",
      current: { from: "2026-11-01", to: "2026-11-18" },
      previous: { from: "2026-10-01", to: "2026-10-18" },
      previousMonthHasData: true,
    });
    expect(comparison.indicators).toEqual([
      {
        key: "gross",
        label: "Entrada mensal",
        currentCents: 1_500_000,
        previousCents: 1_000_000,
        variationTenths: 500,
        previousMonthTotalCents: 2_000_000,
      },
      {
        key: "fee",
        label: "Taxas",
        currentCents: 30_000,
        previousCents: 20_000,
        variationTenths: 500,
        previousMonthTotalCents: 40_000,
      },
      {
        // RN-10: general + fixed.
        key: "totalExpenses",
        label: "Total de despesas",
        currentCents: 300_000,
        previousCents: 400_000,
        variationTenths: -250,
        previousMonthTotalCents: 800_000,
      },
      {
        // RN-10: gross − fees − total expenses. 1.170.000 vs 580.000 → +101,7 %.
        key: "balance",
        label: "Saldo",
        currentCents: 1_170_000,
        previousCents: 580_000,
        variationTenths: 1017,
        previousMonthTotalCents: 1_160_000,
      },
    ]);
  });

  it("RN-11: an indicator whose previous value is 0 has no variation", () => {
    const comparison = buildMonthComparison({
      today: "2026-11-18",
      current: totals({ grossCents: 10_000, feeCents: 200 }),
      previous: totals({ grossCents: 8_000 }),
      previousMonth: { summary: october, hasData: true },
    });
    const byKey = Object.fromEntries(comparison.indicators.map((i) => [i.key, i]));
    expect(byKey.gross?.variationTenths).toBe(250);
    expect(byKey.fee?.variationTenths).toBeNull();
    expect(byKey.totalExpenses?.variationTenths).toBeNull();
    expect(comparison.previousMonthHasData).toBe(true);
  });

  it('FR-24: previous month without data → every variation is "—"', () => {
    const empty: MonthSummary = {
      ...october,
      grossCents: 0,
      feeCents: 0,
      generalExpensesCents: 0,
      fixedExpensesCents: 0,
      totalExpensesCents: 0,
      balanceCents: 0,
    };
    const comparison = buildMonthComparison({
      today: "2026-11-18",
      current: totals({ grossCents: 10_000, generalExpensesCents: 2_000 }),
      previous: totals(),
      previousMonth: { summary: empty, hasData: false },
    });
    expect(comparison.previousMonthHasData).toBe(false);
    expect(comparison.indicators.map((i) => i.variationTenths)).toEqual([null, null, null, null]);
    expect(comparison.indicators.map((i) => i.previousMonthTotalCents)).toEqual([0, 0, 0, 0]);
  });
});
