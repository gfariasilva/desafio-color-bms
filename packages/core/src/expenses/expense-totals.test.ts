import { describe, expect, it } from "vitest";
import {
  cashPaidFromTillCents,
  expensesTotalCents,
  generalExpensesOfMonthCents,
  type ExpenseTotalsRow,
} from "./expense-totals";

function row(overrides: Partial<ExpenseTotalsRow>): ExpenseTotalsRow {
  return {
    type: "general",
    status: "paid",
    amountCents: 4500,
    paymentDate: "2026-11-18",
    paymentMeans: "cash",
    paidFromTill: true,
    ...overrides,
  };
}

describe("RN-08: general expenses of the month", () => {
  it("RN-08: sums the general expenses whose payment date is in the month", () => {
    const rows = [
      row({ amountCents: 4500, paymentDate: "2026-11-01" }),
      row({ amountCents: 1250, paymentDate: "2026-11-30", paymentMeans: "pix" }),
      row({ amountCents: 999, paymentDate: "2026-11-18", paidFromTill: false }),
    ];
    expect(generalExpensesOfMonthCents(rows, "2026-11")).toBe(6749);
  });

  it("RN-08: payment dates in other months are left out, at both month edges", () => {
    const rows = [
      row({ amountCents: 100, paymentDate: "2026-10-31" }),
      row({ amountCents: 200, paymentDate: "2026-11-15" }),
      row({ amountCents: 400, paymentDate: "2026-12-01" }),
    ];
    expect(generalExpensesOfMonthCents(rows, "2026-11")).toBe(200);
  });

  it("RN-08: fixed expenses never count as general (they are RN-09)", () => {
    const rows = [row({ amountCents: 300 }), row({ type: "fixed", amountCents: 150000 })];
    expect(generalExpensesOfMonthCents(rows, "2026-11")).toBe(300);
  });

  it("RN-08: a month without expenses totals zero", () => {
    expect(generalExpensesOfMonthCents([], "2026-11")).toBe(0);
  });

  it("RN-08: the largest allowed amounts add up exactly in integer cents", () => {
    const rows = Array.from({ length: 31 }, () => row({ amountCents: 99_999_999 }));
    expect(generalExpensesOfMonthCents(rows, "2026-11")).toBe(3_099_999_969);
  });
});

describe("RN-07: expenses paid from the till", () => {
  it("RN-07: only cash expenses paid from the till of that date reduce expected cash", () => {
    const rows = [
      row({ amountCents: 4500 }),
      row({ amountCents: 1000, paymentMeans: "pix", paidFromTill: false }),
      row({ amountCents: 700, paidFromTill: false }),
      row({ amountCents: 300, paymentDate: "2026-11-17" }),
    ];
    expect(cashPaidFromTillCents(rows, "2026-11-18")).toBe(4500);
  });

  it("RN-07: counts general and fixed expenses, but only paid ones", () => {
    const rows = [
      row({ amountCents: 4500 }),
      row({ type: "fixed", amountCents: 20000 }),
      row({ type: "fixed", status: "pending", amountCents: 9900 }),
    ];
    expect(cashPaidFromTillCents(rows, "2026-11-18")).toBe(24500);
  });

  it("FR-06: a PIX expense does not affect expected cash", () => {
    const rows = [row({ amountCents: 4500, paymentMeans: "pix", paidFromTill: false })];
    expect(cashPaidFromTillCents(rows, "2026-11-18")).toBe(0);
  });
});

describe("FR-06: total of a list of expenses", () => {
  it("FR-06: adds the amounts in integer cents; an empty list is zero", () => {
    expect(expensesTotalCents([row({ amountCents: 4500 }), row({ amountCents: 1200 })])).toBe(5700);
    expect(expensesTotalCents([])).toBe(0);
  });
});
