import type { SaleCategory } from "../catalog/categories";
import type { PaymentMethod } from "../payments/payment-methods";
import type { DaySalesTab, Sale, SaleTotals } from "./sales";

/**
 * RN-05 / FR-05: the sales of one day grouped by tab ("aba"), with subtotals per payment
 * method and the totals of each tab and of the day. Totals are always computed from the rows,
 * never stored (spec §6.3). Refunds are negative rows, so they are simply added in.
 */

const ZERO: SaleTotals = { grossCents: 0, feeCents: 0, netCents: 0 };

/** Adds gross, fee and net separately (RN-05). */
function add(total: SaleTotals, row: SaleTotals): SaleTotals {
  return {
    grossCents: total.grossCents + row.grossCents,
    feeCents: total.feeCents + row.feeCents,
    netCents: total.netCents + row.netCents,
  };
}

function totalsOf(row: SaleTotals): SaleTotals {
  return { grossCents: row.grossCents, feeCents: row.feeCents, netCents: row.netCents };
}

export interface DaySalesSummary {
  tabs: DaySalesTab[];
  total: SaleTotals;
}

/**
 * RN-05: groups the day's sales (already in registration order) by tab.
 *
 * - Every **active** tab is listed, in display order; tabs without sales total R$ 0,00 (FR-05).
 * - An inactive tab is listed only when it has sales on that day.
 * - Per tab: one subtotal per payment method that has rows, in the methods' display order.
 * - Tab total = Σ methods; day total = Σ tabs.
 */
export function summarizeDaySales(input: {
  tabs: readonly SaleCategory[];
  methods: readonly PaymentMethod[];
  sales: readonly Sale[];
}): DaySalesSummary {
  const methodOrder = new Map(input.methods.map((method) => [method.id, method.order]));
  const byTab = new Map<number, Sale[]>();
  for (const sale of input.sales) {
    const list = byTab.get(sale.saleCategoryId) ?? [];
    list.push(sale);
    byTab.set(sale.saleCategoryId, list);
  }

  const tabs = [...input.tabs]
    .sort((a, b) => a.order - b.order || a.id - b.id)
    .filter((tab) => tab.active || byTab.has(tab.id))
    .map((tab): DaySalesTab => {
      const sales = byTab.get(tab.id) ?? [];
      const methods = new Map<number, DaySalesTab["methods"][number]>();
      for (const sale of sales) {
        const current = methods.get(sale.paymentMethodId) ?? {
          paymentMethodId: sale.paymentMethodId,
          paymentMethodName: sale.paymentMethodName,
          ...ZERO,
        };
        methods.set(sale.paymentMethodId, { ...current, ...add(current, sale) });
      }
      const methodList = [...methods.values()].sort(
        (a, b) =>
          (methodOrder.get(a.paymentMethodId) ?? Number.MAX_SAFE_INTEGER) -
            (methodOrder.get(b.paymentMethodId) ?? Number.MAX_SAFE_INTEGER) ||
          a.paymentMethodId - b.paymentMethodId,
      );
      return {
        saleCategoryId: tab.id,
        name: tab.name,
        order: tab.order,
        active: tab.active,
        sales,
        methods: methodList,
        total: methodList.reduce((sum, method) => add(sum, totalsOf(method)), ZERO),
      };
    });

  return { tabs, total: tabs.reduce((sum, tab) => add(sum, tab.total), ZERO) };
}
