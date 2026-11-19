import { describe, expect, it } from "vitest";
import type { SaleCategory } from "../catalog/categories";
import { MAX_SALE_CENTS } from "../format/money-input";
import type { PaymentMethod } from "../payments/payment-methods";
import type { Sale } from "../sales/sales";
import { buildDayMatrix } from "./day-report";

const tabs: SaleCategory[] = [
  { id: 1, name: "Toner", order: 1, active: true },
  { id: 2, name: "Papelaria", order: 2, active: true },
  { id: 3, name: "Xerox", order: 3, active: true },
  { id: 5, name: "Antiga", order: 5, active: false },
];

function method(id: number, name: string, order: number, active = true): PaymentMethod {
  return {
    id,
    name,
    order,
    active,
    machineUsage: "not_applicable",
    allowsInstallments: false,
  };
}

const methods: PaymentMethod[] = [
  method(10, "Dinheiro", 1),
  method(11, "Cartão de débito", 2),
  method(12, "Cartão de crédito", 3),
  method(13, "Cheque", 4, false),
];

let nextId = 1;
function sale(
  tabId: number,
  methodId: number,
  grossCents: number,
  feeCents = 0,
  type: Sale["type"] = "sale",
): Sale {
  return {
    id: nextId++,
    date: "2026-11-18",
    createdAt: "2026-11-18T13:00:00.000Z",
    type,
    saleCategoryId: tabId,
    saleCategoryName: tabs.find((tab) => tab.id === tabId)!.name,
    paymentMethodId: methodId,
    paymentMethodName: methods.find((m) => m.id === methodId)!.name,
    cardMachineId: null,
    cardMachineName: null,
    installments: null,
    grossCents,
    feeRatePpm: 0,
    feeCents,
    netCents: grossCents - feeCents,
    note: null,
    originalSaleId: null,
    originalSaleDate: null,
    reason: null,
    refundedCents: 0,
  };
}

const zero = { grossCents: 0, feeCents: 0, netCents: 0 };

/** Σ of a list of totals, gross, fee and net separately. */
function sum(list: { grossCents: number; feeCents: number; netCents: number }[]) {
  return list.reduce(
    (total, row) => ({
      grossCents: total.grossCents + row.grossCents,
      feeCents: total.feeCents + row.feeCents,
      netCents: total.netCents + row.netCents,
    }),
    zero,
  );
}

describe("RN-05: the day report matrix (tab × payment method)", () => {
  it("RN-05: a cell sums the sales and refunds of its tab and method, gross, fee and net apart", () => {
    const matrix = buildDayMatrix({
      tabs,
      methods,
      sales: [
        sale(1, 12, 15000, 569),
        sale(1, 12, 10000, 379),
        sale(1, 12, -4000, -152, "refund"),
        sale(1, 10, 2500),
      ],
    });
    const toner = matrix.tabs[0]!;
    // Cells follow the column order: Dinheiro, Débito, Crédito.
    expect(toner.cells).toEqual([
      { grossCents: 2500, feeCents: 0, netCents: 2500 },
      zero,
      { grossCents: 21000, feeCents: 796, netCents: 20204 },
    ]);
  });

  it("RN-05: a tab total is the sum of its method cells", () => {
    const matrix = buildDayMatrix({
      tabs,
      methods,
      sales: [sale(1, 12, 15000, 569), sale(1, 10, 2500), sale(1, 11, 4000, 80)],
    });
    const toner = matrix.tabs[0]!;
    expect(toner.total).toEqual({ grossCents: 21500, feeCents: 649, netCents: 20851 });
    expect(toner.total).toEqual(sum(toner.cells));
  });

  it("RN-05: a method total is the sum of its column", () => {
    const matrix = buildDayMatrix({
      tabs,
      methods,
      sales: [sale(1, 10, 2500), sale(2, 10, 1000), sale(3, 10, 300), sale(2, 11, 4000, 80)],
    });
    expect(matrix.methodTotals[0]).toEqual({ grossCents: 3800, feeCents: 0, netCents: 3800 });
    expect(matrix.methodTotals[1]).toEqual({ grossCents: 4000, feeCents: 80, netCents: 3920 });
    expect(matrix.methodTotals[2]).toEqual(zero);
    matrix.methods.forEach((_, column) => {
      expect(matrix.methodTotals[column]).toEqual(
        sum(matrix.tabs.map((tab) => tab.cells[column]!)),
      );
    });
  });

  it("RN-05: the day total is the sum of the tabs and also of the method totals", () => {
    const matrix = buildDayMatrix({
      tabs,
      methods,
      sales: [
        sale(1, 12, 15000, 569),
        sale(2, 10, 1000),
        sale(3, 11, 4000, 80),
        sale(3, 11, -1000, -20, "refund"),
      ],
    });
    expect(matrix.total).toEqual({ grossCents: 19000, feeCents: 629, netCents: 18371 });
    expect(matrix.total).toEqual(sum(matrix.tabs.map((tab) => tab.total)));
    expect(matrix.total).toEqual(sum(matrix.methodTotals));
  });

  it("RN-05: a refund on a later day can leave a cell negative", () => {
    const matrix = buildDayMatrix({
      tabs,
      methods,
      sales: [sale(2, 11, -8000, -159, "refund")],
    });
    expect(matrix.tabs[1]!.cells[1]).toEqual({
      grossCents: -8000,
      feeCents: -159,
      netCents: -7841,
    });
    expect(matrix.total).toEqual({ grossCents: -8000, feeCents: -159, netCents: -7841 });
  });

  it("RN-05: a day without sales lists every active tab and method at zero", () => {
    const matrix = buildDayMatrix({ tabs, methods, sales: [] });
    expect(matrix.tabs.map((tab) => tab.name)).toEqual(["Toner", "Papelaria", "Xerox"]);
    expect(matrix.methods.map((m) => m.name)).toEqual([
      "Dinheiro",
      "Cartão de débito",
      "Cartão de crédito",
    ]);
    for (const tab of matrix.tabs) {
      expect(tab.cells).toEqual([zero, zero, zero]);
      expect(tab.total).toEqual(zero);
      expect(tab.hasSales).toBe(false);
    }
    expect(matrix.methodTotals).toEqual([zero, zero, zero]);
    expect(matrix.total).toEqual(zero);
  });

  it("RN-05: the largest sales add up exactly (safe integers)", () => {
    const matrix = buildDayMatrix({
      tabs,
      methods,
      sales: Array.from({ length: 300 }, () => sale(1, 12, MAX_SALE_CENTS, 3_789_999)),
    });
    expect(matrix.total.grossCents).toBe(300 * MAX_SALE_CENTS);
    expect(matrix.total.feeCents).toBe(300 * 3_789_999);
    expect(matrix.total.netCents).toBe(300 * (MAX_SALE_CENTS - 3_789_999));
    expect(Number.isSafeInteger(matrix.total.grossCents)).toBe(true);
  });

  it("FR-19: tabs and methods keep their display order (the owner's Excel order)", () => {
    const matrix = buildDayMatrix({
      tabs: [...tabs].reverse(),
      methods: [...methods].reverse(),
      sales: [sale(3, 12, 100), sale(1, 10, 200)],
    });
    expect(matrix.tabs.map((tab) => tab.name)).toEqual(["Toner", "Papelaria", "Xerox"]);
    expect(matrix.methods.map((m) => m.paymentMethodId)).toEqual([10, 11, 12]);
    expect(matrix.tabs[0]!.hasSales).toBe(true);
    expect(matrix.tabs[1]!.hasSales).toBe(false);
  });

  it("FR-19: an inactive tab or method appears only when it has sales that day", () => {
    const matrix = buildDayMatrix({ tabs, methods, sales: [sale(5, 13, 700)] });
    expect(matrix.tabs.at(-1)).toMatchObject({ name: "Antiga", active: false, hasSales: true });
    expect(matrix.methods.at(-1)).toMatchObject({ name: "Cheque", active: false });
    expect(matrix.tabs.at(-1)!.cells).toEqual([
      zero,
      zero,
      zero,
      { ...zero, grossCents: 700, netCents: 700 },
    ]);
    expect(matrix.methodTotals.at(-1)!.grossCents).toBe(700);
  });
});
