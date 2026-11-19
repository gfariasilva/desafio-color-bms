import { describe, expect, it } from "vitest";
import type { ExpenseCategory } from "../catalog/categories";
import { generalExpensesOfMonthCents } from "../expenses/expense-totals";
import type { Expense } from "../expenses/expenses";
import { buildMonthGeneralExpenses } from "./month-general-expenses";

const categories: ExpenseCategory[] = [
  { id: 1, name: "Acessórios", order: 1, active: true, group: "general" },
  { id: 2, name: "Alimentação", order: 2, active: true, group: "general" },
  { id: 3, name: "Antiga", order: 3, active: false, group: "general" },
  { id: 9, name: "Kalunga", order: 9, active: true, group: "suppliers" },
  { id: 8, name: "Casa Forte", order: 8, active: true, group: "suppliers" },
  { id: 10, name: "Fornecedor velho", order: 10, active: false, group: "suppliers" },
];

let nextId = 1;
function expense(categoryId: number, paymentDate: string, amountCents: number): Expense {
  const category = categories.find((c) => c.id === categoryId)!;
  const id = nextId++;
  return {
    id,
    type: "general",
    status: "paid",
    paymentDate,
    createdAt: `2026-11-01T12:00:${String(id % 60).padStart(2, "0")}.000Z`,
    expenseCategoryId: categoryId,
    expenseCategoryName: category.name,
    expenseCategoryOrder: category.order,
    description: null,
    amountCents,
    paymentMeans: "pix",
    paidFromTill: false,
  };
}

describe("buildMonthGeneralExpenses (FR-21, RN-08)", () => {
  it("RN-08: totals by category, by payment date in the month", () => {
    const report = buildMonthGeneralExpenses({
      yearMonth: "2026-11",
      categories,
      expenses: [
        expense(1, "2026-11-01", 1000),
        expense(1, "2026-11-30", 250),
        expense(2, "2026-11-10", 2000),
        // Paid in another month: not counted here (cash basis, A-06).
        expense(1, "2026-10-31", 9999),
        expense(2, "2026-12-01", 9999),
      ],
    });
    const general = report.general.categories;
    expect(general.find((c) => c.name === "Acessórios")!.totalCents).toBe(1250);
    expect(general.find((c) => c.name === "Alimentação")!.totalCents).toBe(2000);
    expect(report.totalCents).toBe(3250);
  });

  it("RN-08: each expense counts in exactly one category; Σ categories = total = RN-08", () => {
    const expenses = [
      expense(1, "2026-11-01", 1000),
      expense(9, "2026-11-02", 30000),
      expense(8, "2026-11-03", 12345),
      expense(2, "2026-11-04", 2000),
    ];
    const report = buildMonthGeneralExpenses({ yearMonth: "2026-11", categories, expenses });
    const all = [...report.general.categories, ...report.suppliers.categories];
    const listed = all.flatMap((category) => category.expenses.map((e) => e.id));
    expect(listed.sort()).toEqual(expenses.map((e) => e.id).sort());
    expect(new Set(listed).size).toBe(listed.length);
    expect(all.reduce((sum, c) => sum + c.totalCents, 0)).toBe(report.totalCents);
    expect(report.totalCents).toBe(generalExpensesOfMonthCents(expenses, "2026-11"));
  });

  it("FR-21: suppliers are grouped with their subtotal; total geral = Geral + Fornecedores", () => {
    const report = buildMonthGeneralExpenses({
      yearMonth: "2026-11",
      categories,
      expenses: [
        expense(1, "2026-11-01", 1000),
        expense(9, "2026-11-02", 30000),
        expense(8, "2026-11-03", 12345),
      ],
    });
    // Display order, active ones only (the inactive have nothing this month).
    expect(report.general.categories.map((c) => c.name)).toEqual(["Acessórios", "Alimentação"]);
    expect(report.suppliers.categories.map((c) => c.name)).toEqual(["Casa Forte", "Kalunga"]);
    expect(report.general.subtotalCents).toBe(1000);
    expect(report.suppliers.subtotalCents).toBe(42345);
    expect(report.totalCents).toBe(43345);
  });

  it("FR-21: an inactive category with expenses in the month is listed", () => {
    const report = buildMonthGeneralExpenses({
      yearMonth: "2026-11",
      categories,
      expenses: [expense(3, "2026-11-05", 500), expense(10, "2026-11-06", 800)],
    });
    expect(report.general.categories.map((c) => c.name)).toContain("Antiga");
    expect(report.suppliers.categories.map((c) => c.name)).toContain("Fornecedor velho");
  });

  it("FR-21: lists each category's entries by payment date", () => {
    const late = expense(2, "2026-11-20", 300);
    const early = expense(2, "2026-11-03", 200);
    const report = buildMonthGeneralExpenses({
      yearMonth: "2026-11",
      categories,
      expenses: [late, early],
    });
    const food = report.general.categories.find((c) => c.name === "Alimentação")!;
    expect(food.expenses.map((e) => e.id)).toEqual([early.id, late.id]);
  });

  it("RN-08: only general expenses count (fixed expenses are RN-09)", () => {
    const fixed = { ...expense(1, "2026-11-05", 7000), type: "fixed" as const };
    const report = buildMonthGeneralExpenses({
      yearMonth: "2026-11",
      categories,
      expenses: [fixed, expense(1, "2026-11-05", 100)],
    });
    expect(report.totalCents).toBe(100);
  });

  it("FR-21: an empty month is all zeros", () => {
    const report = buildMonthGeneralExpenses({ yearMonth: "2026-11", categories, expenses: [] });
    expect(report.totalCents).toBe(0);
    expect(report.general.subtotalCents).toBe(0);
    expect(report.suppliers.subtotalCents).toBe(0);
    expect(report.general.categories.every((c) => c.totalCents === 0)).toBe(true);
  });
});
