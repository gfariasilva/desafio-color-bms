import { describe, expect, it } from "vitest";
import type { SaleCategory } from "../catalog/categories";
import type { PaymentMethod } from "../payments/payment-methods";
import type { Sale } from "./sales";
import { summarizeDaySales } from "./day-summary";

const tabs: SaleCategory[] = [
  { id: 1, name: "Toner", order: 1, active: true },
  { id: 2, name: "Papelaria", order: 2, active: true },
  { id: 3, name: "Xerox", order: 3, active: true },
  { id: 4, name: "Chaveiro", order: 4, active: true },
  { id: 5, name: "Antiga", order: 5, active: false },
];

const methods: PaymentMethod[] = [
  {
    id: 10,
    name: "Dinheiro",
    order: 1,
    active: true,
    machineUsage: "not_applicable",
    allowsInstallments: false,
  },
  {
    id: 11,
    name: "Cartão de débito",
    order: 2,
    active: true,
    machineUsage: "required",
    allowsInstallments: false,
  },
  {
    id: 12,
    name: "Cartão de crédito",
    order: 3,
    active: true,
    machineUsage: "required",
    allowsInstallments: true,
  },
];

let nextId = 1;
function sale(
  tabId: number,
  methodId: number,
  grossCents: number,
  feeCents = 0,
  type: Sale["type"] = "sale",
): Sale {
  const tab = tabs.find((t) => t.id === tabId)!;
  const method = methods.find((m) => m.id === methodId)!;
  return {
    id: nextId++,
    date: "2026-11-18",
    createdAt: "2026-11-18T13:00:00.000Z",
    type,
    saleCategoryId: tab.id,
    saleCategoryName: tab.name,
    paymentMethodId: method.id,
    paymentMethodName: method.name,
    cardMachineId: feeCents === 0 ? null : 20,
    cardMachineName: feeCents === 0 ? null : "PagSeguro",
    installments: null,
    grossCents,
    feeRatePpm: 0,
    feeCents,
    netCents: grossCents - feeCents,
    note: null,
  };
}

const zero = { grossCents: 0, feeCents: 0, netCents: 0 };

describe("RN-05: day totals", () => {
  it("RN-05: totals per tab and method, separately for gross, fee and net", () => {
    const day = summarizeDaySales({
      tabs,
      methods,
      sales: [
        sale(1, 12, 15000, 569),
        sale(1, 10, 2500),
        sale(1, 12, 10000, 379),
        sale(1, 10, 1000),
      ],
    });
    const toner = day.tabs[0]!;
    expect(toner.methods).toEqual([
      {
        paymentMethodId: 10,
        paymentMethodName: "Dinheiro",
        grossCents: 3500,
        feeCents: 0,
        netCents: 3500,
      },
      {
        paymentMethodId: 12,
        paymentMethodName: "Cartão de crédito",
        grossCents: 25000,
        feeCents: 948,
        netCents: 24052,
      },
    ]);
  });

  it("RN-05: tab total sums its methods; day total sums the tabs", () => {
    const day = summarizeDaySales({
      tabs,
      methods,
      sales: [sale(1, 12, 15000, 569), sale(1, 10, 2500), sale(2, 11, 4000, 80)],
    });
    expect(day.tabs[0]!.total).toEqual({ grossCents: 17500, feeCents: 569, netCents: 16931 });
    expect(day.tabs[1]!.total).toEqual({ grossCents: 4000, feeCents: 80, netCents: 3920 });
    expect(day.total).toEqual({ grossCents: 21500, feeCents: 649, netCents: 20851 });
  });

  it("RN-05: refunds (negative rows) reduce the totals", () => {
    const day = summarizeDaySales({
      tabs,
      methods,
      sales: [sale(1, 11, 8000, 159), sale(1, 11, -8000, -159, "refund"), sale(1, 10, 500)],
    });
    expect(day.tabs[0]!.methods.find((m) => m.paymentMethodId === 11)).toMatchObject(zero);
    expect(day.total).toEqual({ grossCents: 500, feeCents: 0, netCents: 500 });
  });
});

describe("FR-05: the day per tab", () => {
  it("FR-05: tabs without sales appear with zero totals, in display order", () => {
    const day = summarizeDaySales({
      tabs: [...tabs].reverse(),
      methods,
      sales: [sale(1, 10, 100), sale(2, 10, 200), sale(3, 10, 300)],
    });
    expect(day.tabs.map((tab) => tab.name)).toEqual(["Toner", "Papelaria", "Xerox", "Chaveiro"]);
    const chaveiro = day.tabs[3]!;
    expect(chaveiro.sales).toEqual([]);
    expect(chaveiro.methods).toEqual([]);
    expect(chaveiro.total).toEqual(zero);
  });

  it("FR-05: keeps the sales of each tab in the order given (registration order)", () => {
    const first = sale(1, 10, 100);
    const second = sale(2, 10, 200);
    const third = sale(1, 12, 300);
    const day = summarizeDaySales({ tabs, methods, sales: [first, second, third] });
    expect(day.tabs[0]!.sales.map((s) => s.id)).toEqual([first.id, third.id]);
  });

  it("FR-05: an inactive tab shows only when it has sales that day", () => {
    const without = summarizeDaySales({ tabs, methods, sales: [] });
    expect(without.tabs.map((tab) => tab.name)).not.toContain("Antiga");
    expect(without.total).toEqual(zero);

    const withSale = summarizeDaySales({ tabs, methods, sales: [sale(5, 10, 700)] });
    expect(withSale.tabs.at(-1)).toMatchObject({ name: "Antiga", active: false });
    expect(withSale.tabs.at(-1)!.total.grossCents).toBe(700);
  });
});
