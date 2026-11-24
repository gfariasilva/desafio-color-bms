import { describe, expect, it } from "vitest";
import {
  buildIncomeVsExpenses,
  incomeVsExpensesQuerySchema,
  incomeVsExpensesSchema,
  lastDays,
} from "./income-vs-expenses";

describe("lastDays (FR-26)", () => {
  it("FR-26: the last 7 or 30 days end today (today included)", () => {
    expect(lastDays("2026-11-18", 7)).toEqual({ from: "2026-11-12", to: "2026-11-18" });
    expect(lastDays("2026-11-18", 30)).toEqual({ from: "2026-10-20", to: "2026-11-18" });
  });

  it("FR-26: crosses months and years", () => {
    expect(lastDays("2027-01-03", 7)).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    // 2028 is a leap year: 01–29/02 plus 01/03 is 30 days.
    expect(lastDays("2028-03-01", 30)).toEqual({ from: "2028-02-01", to: "2028-03-01" });
    expect(lastDays("2027-03-01", 30)).toEqual({ from: "2027-01-31", to: "2027-03-01" });
  });

  it("FR-26: rejects other windows", () => {
    expect(() => lastDays("2026-11-18", 14)).toThrow(RangeError);
    expect(() => lastDays("2026-11-18", 0)).toThrow(RangeError);
  });
});

describe("incomeVsExpensesQuerySchema (FR-26)", () => {
  it("FR-26: accepts 7 or 30 days (7 by default)", () => {
    expect(incomeVsExpensesQuerySchema.parse({})).toEqual({ days: 7 });
    expect(incomeVsExpensesQuerySchema.parse({ days: "7" })).toEqual({ days: 7 });
    expect(incomeVsExpensesQuerySchema.parse({ days: "30" })).toEqual({ days: 30 });
  });

  it("FR-26: rejects anything else with a pt-BR message", () => {
    for (const days of ["14", "abc", "", "7.5", "-7"]) {
      const parsed = incomeVsExpensesQuerySchema.safeParse({ days });
      expect(parsed.success, days).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe("Escolha 7 ou 30 dias.");
    }
  });
});

describe("buildIncomeVsExpenses (FR-26)", () => {
  it("FR-26: 30 days → days without movement are zero, and totals match the sum of the bars", () => {
    const chart = buildIncomeVsExpenses({
      today: "2026-11-18",
      days: 30,
      income: [
        { date: "2026-10-20", cents: 10000 },
        { date: "2026-11-03", cents: 25000 },
        { date: "2026-11-18", cents: -2000 }, // a refund (RN-04)
      ],
      expenses: [
        { date: "2026-11-03", cents: 4000 },
        { date: "2026-11-10", cents: 18743 },
      ],
    });

    expect(incomeVsExpensesSchema.parse(chart)).toEqual(chart);
    expect(chart).toMatchObject({
      today: "2026-11-18",
      days: 30,
      from: "2026-10-20",
      to: "2026-11-18",
    });
    expect(chart.daily).toHaveLength(30);
    expect(chart.daily.map((d) => d.date)).toEqual(
      Array.from({ length: 30 }, (_, i) =>
        i < 12 ? `2026-10-${String(20 + i)}` : `2026-11-${String(i - 11).padStart(2, "0")}`,
      ),
    );
    expect(chart.daily[0]).toEqual({
      date: "2026-10-20",
      incomeCents: 10000,
      expensesCents: 0,
      differenceCents: 10000,
    });
    expect(chart.daily[1]).toEqual({
      date: "2026-10-21",
      incomeCents: 0,
      expensesCents: 0,
      differenceCents: 0,
    });
    expect(chart.daily.find((d) => d.date === "2026-11-03")).toEqual({
      date: "2026-11-03",
      incomeCents: 25000,
      expensesCents: 4000,
      differenceCents: 21000,
    });
    expect(chart.daily.at(-1)).toMatchObject({ date: "2026-11-18", incomeCents: -2000 });

    const sum = (key: "incomeCents" | "expensesCents") =>
      chart.daily.reduce((total, day) => total + day[key], 0);
    expect(chart.totals).toEqual({
      incomeCents: sum("incomeCents"),
      expensesCents: sum("expensesCents"),
      differenceCents: sum("incomeCents") - sum("expensesCents"),
    });
    expect(chart.totals).toEqual({
      incomeCents: 33000,
      expensesCents: 22743,
      differenceCents: 10257,
    });
  });

  it("FR-26: 7 days ignores what is outside the window", () => {
    const chart = buildIncomeVsExpenses({
      today: "2026-11-18",
      days: 7,
      income: [
        { date: "2026-11-11", cents: 99999 }, // the day before the window
        { date: "2026-11-12", cents: 1000 },
      ],
      expenses: [{ date: "2026-11-19", cents: 5000 }], // never in the future, but ignored
    });
    expect(chart.from).toBe("2026-11-12");
    expect(chart.daily).toHaveLength(7);
    expect(chart.totals).toEqual({ incomeCents: 1000, expensesCents: 0, differenceCents: 1000 });
  });

  it("FR-26: several rows of the same day add up; spending more gives a negative difference", () => {
    const chart = buildIncomeVsExpenses({
      today: "2026-11-18",
      days: 7,
      income: [
        { date: "2026-11-15", cents: 3000 },
        { date: "2026-11-15", cents: 2000 },
      ],
      expenses: [
        { date: "2026-11-15", cents: 4000 },
        { date: "2026-11-15", cents: 6000 },
      ],
    });
    expect(chart.daily.find((d) => d.date === "2026-11-15")).toEqual({
      date: "2026-11-15",
      incomeCents: 5000,
      expensesCents: 10000,
      differenceCents: -5000,
    });
    expect(chart.totals.differenceCents).toBe(-5000);
  });

  it("FR-26: no movement at all → every day and total is zero", () => {
    const chart = buildIncomeVsExpenses({ today: "2026-11-18", days: 7, income: [], expenses: [] });
    expect(chart.daily.every((d) => d.incomeCents === 0 && d.expensesCents === 0)).toBe(true);
    expect(chart.totals).toEqual({ incomeCents: 0, expensesCents: 0, differenceCents: 0 });
  });
});
