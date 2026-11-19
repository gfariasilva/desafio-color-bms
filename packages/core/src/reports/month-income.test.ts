import { describe, expect, it } from "vitest";
import type { SaleCategory } from "../catalog/categories";
import type { PaymentMethod } from "../payments/payment-methods";
import { buildMonthIncome, monthReportDays, type MonthIncomeRow } from "./month-income";

const tabs: SaleCategory[] = [
  { id: 1, name: "Toner", order: 1, active: true },
  { id: 2, name: "Papelaria", order: 2, active: true },
  { id: 3, name: "Xerox", order: 3, active: true },
  { id: 5, name: "Antiga", order: 5, active: false },
];

function method(id: number, name: string, order: number, active = true): PaymentMethod {
  return { id, name, order, active, machineUsage: "not_applicable", allowsInstallments: false };
}

const methods: PaymentMethod[] = [
  method(10, "Dinheiro", 1),
  method(12, "Cartão de crédito", 3),
  method(11, "Cartão de débito", 2),
  method(13, "Cheque", 4, false),
];

function row(
  date: string,
  saleCategoryId: number,
  paymentMethodId: number,
  grossCents: number,
  feeCents = 0,
): MonthIncomeRow {
  return {
    date,
    saleCategoryId,
    paymentMethodId,
    grossCents,
    feeCents,
    netCents: grossCents - feeCents,
  };
}

describe("monthReportDays (FR-20 grid rows)", () => {
  it("FR-20: a past month lists every day", () => {
    const days = monthReportDays("2026-10", "2026-11-18");
    expect(days).toHaveLength(31);
    expect(days[0]).toBe("2026-10-01");
    expect(days.at(-1)).toBe("2026-10-31");
  });

  it("FR-20: the current month stops at today", () => {
    const days = monthReportDays("2026-11", "2026-11-18");
    expect(days).toHaveLength(18);
    expect(days.at(-1)).toBe("2026-11-18");
  });

  it("FR-20: a leap February has 29 days", () => {
    expect(monthReportDays("2028-02", "2028-12-01")).toHaveLength(29);
    expect(monthReportDays("2027-02", "2027-12-01")).toHaveLength(28);
  });

  it("FR-20: a future month has no days", () => {
    expect(monthReportDays("2026-12", "2026-11-30")).toEqual([]);
  });
});

describe("buildMonthIncome (FR-20, RN-06)", () => {
  it("RN-06: monthly income sums the gross of sales and refunds", () => {
    const income = buildMonthIncome({
      yearMonth: "2026-11",
      today: "2026-11-18",
      tabs,
      methods,
      rows: [
        row("2026-11-02", 1, 10, 5000),
        row("2026-11-03", 2, 10, 1500),
        // A refund is a negative row.
        row("2026-11-04", 1, 10, -1000),
      ],
    });
    expect(income.total.grossCents).toBe(5500);
  });

  it("RN-06: fees = Σ fee and net = monthly income − fees", () => {
    const income = buildMonthIncome({
      yearMonth: "2026-11",
      today: "2026-11-18",
      tabs,
      methods,
      rows: [
        // RN-03 example: R$ 150,00 at 3,79% → fee R$ 5,69.
        row("2026-11-02", 1, 12, 15000, 569),
        row("2026-11-02", 2, 10, 2500),
        // A card refund of R$ 50,00: the proportional fee comes back (RN-04).
        row("2026-11-05", 1, 12, -5000, -190),
      ],
    });
    expect(income.total).toEqual({ grossCents: 12500, feeCents: 379, netCents: 12121 });
    expect(income.total.netCents).toBe(income.total.grossCents - income.total.feeCents);
  });

  it("FR-20: totals per payment method (gross, fee, net), in display order", () => {
    const income = buildMonthIncome({
      yearMonth: "2026-11",
      today: "2026-11-18",
      tabs,
      methods,
      rows: [
        row("2026-11-02", 1, 12, 15000, 569),
        row("2026-11-03", 2, 12, 10000, 379),
        row("2026-11-03", 2, 10, 2500),
      ],
    });
    // The inactive "Cheque" has no sales: not a row.
    expect(income.methods.map((m) => m.name)).toEqual([
      "Dinheiro",
      "Cartão de débito",
      "Cartão de crédito",
    ]);
    expect(income.methods[0]).toMatchObject({ grossCents: 2500, feeCents: 0, netCents: 2500 });
    expect(income.methods[1]).toMatchObject({ grossCents: 0, feeCents: 0, netCents: 0 });
    expect(income.methods[2]).toMatchObject({
      grossCents: 25000,
      feeCents: 948,
      netCents: 24052,
    });
  });

  it("FR-20: an inactive tab or method with sales in the month is listed", () => {
    const income = buildMonthIncome({
      yearMonth: "2026-11",
      today: "2026-11-18",
      tabs,
      methods,
      rows: [row("2026-11-02", 5, 13, 700)],
    });
    expect(income.tabs.map((tab) => tab.name)).toEqual(["Toner", "Papelaria", "Xerox", "Antiga"]);
    expect(income.methods.map((m) => m.name)).toContain("Cheque");
    expect(income.tabs[3]).toMatchObject({ active: false, totalCents: 700 });
  });

  it("FR-20: the grid has the gross of each tab on each day, and each day's total", () => {
    const income = buildMonthIncome({
      yearMonth: "2026-11",
      today: "2026-11-18",
      tabs,
      methods,
      rows: [
        row("2026-11-02", 1, 10, 5000),
        row("2026-11-02", 1, 12, 15000, 569),
        row("2026-11-02", 3, 10, 300),
      ],
    });
    const day2 = income.days.find((day) => day.date === "2026-11-02")!;
    expect(day2.cells).toEqual([20000, 0, 300]);
    expect(day2.totalCents).toBe(20300);
    expect(day2.hasSales).toBe(true);
    const day1 = income.days.find((day) => day.date === "2026-11-01")!;
    expect(day1).toMatchObject({ cells: [0, 0, 0], totalCents: 0, hasSales: false });
  });

  it("FR-20: only rows dated in the month count", () => {
    const income = buildMonthIncome({
      yearMonth: "2026-11",
      today: "2026-11-18",
      tabs,
      methods,
      rows: [row("2026-10-31", 1, 10, 9999), row("2026-11-01", 1, 10, 100)],
    });
    expect(income.total.grossCents).toBe(100);
  });

  it("FR-20: column sums = tab totals and Σ tabs = monthly income (sales on 20 days)", () => {
    const rows: MonthIncomeRow[] = [];
    // 20 days of October with sales on every tab and method, plus a refund on some days.
    for (let day = 1; day <= 20; day++) {
      const date = `2026-10-${String(day).padStart(2, "0")}`;
      rows.push(row(date, 1, 10, 1000 + day * 37));
      rows.push(row(date, 2, 12, 2000 + day * 11, Math.round((2000 + day * 11) * 0.0379)));
      rows.push(row(date, 3, 11, 333 * day, 7));
      if (day % 5 === 0) rows.push(row(date, 2, 10, -500));
    }
    const income = buildMonthIncome({
      yearMonth: "2026-10",
      today: "2026-11-18",
      tabs,
      methods,
      rows,
    });
    expect(income.days).toHaveLength(31);
    expect(income.days.filter((day) => day.hasSales)).toHaveLength(20);

    income.tabs.forEach((tab, column) => {
      const columnSum = income.days.reduce((sum, day) => sum + (day.cells[column] ?? 0), 0);
      expect(columnSum).toBe(tab.totalCents);
    });
    const tabsSum = income.tabs.reduce((sum, tab) => sum + tab.totalCents, 0);
    expect(tabsSum).toBe(income.total.grossCents);
    const rowsSum = income.days.reduce((sum, day) => sum + day.totalCents, 0);
    expect(rowsSum).toBe(income.total.grossCents);
    // The methods add up to the same monthly figures.
    const methodsGross = income.methods.reduce((sum, m) => sum + m.grossCents, 0);
    const methodsFee = income.methods.reduce((sum, m) => sum + m.feeCents, 0);
    expect(methodsGross).toBe(income.total.grossCents);
    expect(methodsFee).toBe(income.total.feeCents);
    expect(income.total.grossCents).toBe(rows.reduce((sum, r) => sum + r.grossCents, 0));
  });

  it("FR-20: a row dated after today still shows on the grid (the totals always add up)", () => {
    const income = buildMonthIncome({
      yearMonth: "2026-11",
      today: "2026-11-18",
      tabs,
      methods,
      rows: [row("2026-11-20", 1, 10, 100)],
    });
    expect(income.days.at(-1)).toMatchObject({ date: "2026-11-20", totalCents: 100 });
    expect(income.days).toHaveLength(19);
  });

  it("FR-20: an empty month is all zeros", () => {
    const income = buildMonthIncome({
      yearMonth: "2026-11",
      today: "2026-11-18",
      tabs,
      methods,
      rows: [],
    });
    expect(income.total).toEqual({ grossCents: 0, feeCents: 0, netCents: 0 });
    expect(income.tabs.map((tab) => tab.name)).toEqual(["Toner", "Papelaria", "Xerox"]);
  });
});
