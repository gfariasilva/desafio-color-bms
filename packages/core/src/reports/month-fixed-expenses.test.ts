import { describe, expect, it } from "vitest";
import { fixedExpensesOfMonthCents } from "../fixed-expenses/fixed-expense-payment";
import type { FixedExpense } from "../fixed-expenses/fixed-expenses";
import { buildMonthFixedExpensesReport } from "./month-fixed-expenses";

let nextId = 1;
/** A fixed expense; pending in November 2026 unless `fields` says otherwise. */
function entry(label: string, fields: Partial<FixedExpense> = {}): FixedExpense {
  return {
    id: nextId++,
    referenceMonth: "2026-11",
    label,
    group: "general",
    fixedExpenseTemplateId: 1,
    oneOff: false,
    dueDate: "2026-11-10",
    expectedAmountCents: 20000,
    status: "pending",
    amountCents: null,
    paymentDate: null,
    paymentMeans: null,
    paidFromTill: false,
    installmentNumber: null,
    installmentsTotal: null,
    createdAt: "2026-11-01T12:00:00.000Z",
    ...fields,
  };
}

function paid(label: string, amountCents: number, paymentDate: string, fields = {}) {
  return entry(label, {
    status: "paid",
    amountCents,
    paymentDate,
    paymentMeans: "pix",
    ...fields,
  });
}

const rowOf = (report: ReturnType<typeof buildMonthFixedExpensesReport>, label: string) =>
  report.groups.flatMap((group) => group.rows).find((row) => row.label === label);

describe("buildMonthFixedExpensesReport (FR-22, RN-09)", () => {
  it("RN-09: paid total counts only paid entries by payment date", () => {
    // FR-12 example: Luz of November paid R$ 187,43 on 10/11/2026 by PIX.
    const expenses = [
      paid("Luz", 18743, "2026-11-10"),
      paid("Água", 5000, "2026-11-30"),
      entry("Aluguel", { expectedAmountCents: 150000 }),
    ];
    const report = buildMonthFixedExpensesReport({ yearMonth: "2026-11", expenses });
    expect(report.paidTotalCents).toBe(23743);
    expect(report.paidTotalCents).toBe(
      fixedExpensesOfMonthCents(
        expenses.map((e) => ({ ...e, type: "fixed" as const })),
        "2026-11",
      ),
    );
    expect(rowOf(report, "Luz")).toMatchObject({ countsInMonth: true, amountCents: 18743 });
  });

  it("RN-09: pending and dismissed entries are not in the paid total", () => {
    const report = buildMonthFixedExpensesReport({
      yearMonth: "2026-11",
      expenses: [
        entry("Luz"),
        entry("TFE", { group: "government_fees", status: "dismissed" }),
        paid("Água", 5000, "2026-11-05"),
      ],
    });
    expect(report.paidTotalCents).toBe(5000);
    // FR-12: a dismissed entry is listed, but enters no total (not even the pending one).
    expect(rowOf(report, "TFE")).toMatchObject({ status: "dismissed", countsInMonth: false });
    expect(report.pendingTotalCents).toBe(20000);
  });

  it("FR-22: groups by Gerais and Taxas governo, subtotals sum to the total", () => {
    const report = buildMonthFixedExpensesReport({
      yearMonth: "2026-11",
      expenses: [
        paid("DAS", 31000, "2026-11-20", { group: "government_fees", dueDate: "2026-11-20" }),
        paid("Luz", 18743, "2026-11-10"),
        entry("Aluguel", { dueDate: "2026-11-05", expectedAmountCents: 150000 }),
        entry("DARF", { group: "government_fees", expectedAmountCents: 4000 }),
        entry("Sem dia", { dueDate: null, expectedAmountCents: 1000 }),
      ],
    });
    expect(report.groups.map((group) => group.group)).toEqual(["general", "government_fees"]);
    // FR-11 order: by due date (none last), then by name.
    expect(report.groups[0]!.rows.map((row) => row.label)).toEqual(["Aluguel", "Luz", "Sem dia"]);
    expect(report.groups[0]).toMatchObject({ paidCents: 18743, pendingCents: 151000 });
    expect(report.groups[1]).toMatchObject({ paidCents: 31000, pendingCents: 4000 });
    expect(report.paidTotalCents).toBe(18743 + 31000);
    expect(report.pendingTotalCents).toBe(151000 + 4000);
  });

  it("FR-22: pending total = expected of pending entries of the reference month", () => {
    const report = buildMonthFixedExpensesReport({
      yearMonth: "2026-11",
      expenses: [
        entry("Luz", { expectedAmountCents: 20000 }),
        // Q-05: no expected amount yet: adds 0, and is counted apart.
        entry("Contador", { expectedAmountCents: null }),
        entry("TFE", { status: "dismissed", expectedAmountCents: 9000 }),
        // A paid entry is no longer pending, whatever its expected amount.
        paid("Água", 5000, "2026-11-05", { expectedAmountCents: 6000 }),
      ],
    });
    expect(report.pendingTotalCents).toBe(20000);
    expect(report.pendingWithoutExpectedCount).toBe(1);
  });

  it("FR-12 / RN-09: October's bill paid on 10/11 is listed and counted in November", () => {
    const luzOctober = paid("Luz", 19000, "2026-11-10", {
      referenceMonth: "2026-10",
      dueDate: "2026-10-10",
    });
    const november = buildMonthFixedExpensesReport({
      yearMonth: "2026-11",
      expenses: [luzOctober],
    });
    expect(rowOf(november, "Luz")).toMatchObject({
      referenceMonth: "2026-10",
      countsInMonth: true,
    });
    expect(november.paidTotalCents).toBe(19000);

    // In October it is listed (its reference month) but counts nothing there.
    const october = buildMonthFixedExpensesReport({ yearMonth: "2026-10", expenses: [luzOctober] });
    expect(rowOf(october, "Luz")).toMatchObject({ countsInMonth: false });
    expect(october.paidTotalCents).toBe(0);
    expect(october.pendingTotalCents).toBe(0);
  });

  it("RN-09: a bill paid next month is listed but not counted", () => {
    const report = buildMonthFixedExpensesReport({
      yearMonth: "2026-11",
      expenses: [paid("Luz", 18000, "2026-12-05")],
    });
    expect(rowOf(report, "Luz")).toMatchObject({ countsInMonth: false });
    expect(report.paidTotalCents).toBe(0);
  });

  it("FR-22: ignores entries of other months that were not paid in this month", () => {
    const report = buildMonthFixedExpensesReport({
      yearMonth: "2026-11",
      expenses: [
        entry("Luz", { referenceMonth: "2026-10" }),
        paid("Água", 5000, "2026-10-05", { referenceMonth: "2026-10" }),
        paid("Gás", 5000, "2026-12-05", { referenceMonth: "2026-12" }),
      ],
    });
    expect(report.groups.flatMap((group) => group.rows)).toEqual([]);
    expect(report.paidTotalCents).toBe(0);
    expect(report.pendingTotalCents).toBe(0);
  });

  it("FR-22: an empty month still lists both groups at zero", () => {
    const report = buildMonthFixedExpensesReport({ yearMonth: "2026-04", expenses: [] });
    expect(report).toEqual({
      yearMonth: "2026-04",
      groups: [
        { group: "general", rows: [], paidCents: 0, pendingCents: 0 },
        { group: "government_fees", rows: [], paidCents: 0, pendingCents: 0 },
      ],
      paidTotalCents: 0,
      pendingTotalCents: 0,
      pendingWithoutExpectedCount: 0,
    });
  });
});
