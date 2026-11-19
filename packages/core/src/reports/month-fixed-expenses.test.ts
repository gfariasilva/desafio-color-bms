import { describe, expect, it } from "vitest";
import type { FixedExpense } from "../fixed-expenses/fixed-expenses";
import { buildMonthFixedExpenses, monthFixedExpensesReportSchema } from "./month-fixed-expenses";

let nextId = 1;
/** A fixed expense of November 2026, pending unless `fields` say otherwise. */
function bill(label: string, fields: Partial<FixedExpense> = {}): FixedExpense {
  return {
    id: nextId++,
    referenceMonth: "2026-11",
    label,
    group: "general",
    fixedExpenseTemplateId: 1,
    oneOff: false,
    dueDate: "2026-11-10",
    expectedAmountCents: 10000,
    status: "pending",
    amountCents: null,
    paymentDate: null,
    paymentMeans: null,
    paidFromTill: false,
    installmentNumber: null,
    installmentsTotal: null,
    createdAt: "2026-11-01T03:00:00.000Z",
    ...fields,
  };
}

function paid(label: string, amountCents: number, paymentDate: string, fields = {}) {
  return bill(label, {
    status: "paid",
    amountCents,
    paymentDate,
    paymentMeans: "pix",
    ...fields,
  });
}

const labels = (rows: readonly { label: string }[]) => rows.map((row) => row.label);

describe("buildMonthFixedExpenses (FR-22, RN-09)", () => {
  it("RN-09: Σ amount paid of paid bills with payment date in the month (cash basis)", () => {
    const report = buildMonthFixedExpenses({
      yearMonth: "2026-11",
      expenses: [
        paid("Luz", 18743, "2026-11-10"),
        paid("Água", 5000, "2026-11-30"),
        bill("Internet"),
        bill("Aluguel", { status: "dismissed" }),
      ],
    });
    expect(report.paidTotalCents).toBe(23743);
  });

  it("RN-09: pending and dismissed bills never count in the total paid", () => {
    const report = buildMonthFixedExpenses({
      yearMonth: "2026-11",
      expenses: [bill("Internet"), bill("Aluguel", { status: "dismissed" })],
    });
    expect(report.paidTotalCents).toBe(0);
    const rows = report.groups.flatMap((group) => group.expenses);
    expect(rows.map((row) => row.countsInMonth)).toEqual([false, false]);
  });

  it("RN-09: a bill of another month paid in this month counts here, flagged", () => {
    const october = paid("Luz", 17000, "2026-11-05", {
      referenceMonth: "2026-10",
      dueDate: "2026-10-10",
    });
    const report = buildMonthFixedExpenses({
      yearMonth: "2026-11",
      expenses: [october, paid("Água", 5000, "2026-11-12")],
    });
    expect(report.paidTotalCents).toBe(22000);
    const row = report.groups[0]!.expenses.find((r) => r.id === october.id)!;
    expect(row).toMatchObject({ countsInMonth: true, otherReferenceMonth: true });
  });

  it("RN-09: a bill of this month paid in a later month is listed but does not count", () => {
    const report = buildMonthFixedExpenses({
      yearMonth: "2026-10",
      expenses: [
        paid("Luz", 17000, "2026-11-05", { referenceMonth: "2026-10", dueDate: "2026-10-10" }),
      ],
    });
    expect(report.paidTotalCents).toBe(0);
    expect(report.groups[0]!.expenses[0]).toMatchObject({
      label: "Luz",
      countsInMonth: false,
      otherReferenceMonth: false,
    });
  });

  it("FR-22: leaves out bills of other months not paid in this month", () => {
    const report = buildMonthFixedExpenses({
      yearMonth: "2026-11",
      expenses: [
        bill("Luz"),
        bill("Luz outubro", { referenceMonth: "2026-10" }),
        paid("Luz dezembro", 100, "2026-12-01", { referenceMonth: "2026-12" }),
        paid("Luz setembro", 100, "2026-10-01", { referenceMonth: "2026-09" }),
      ],
    });
    expect(labels(report.groups.flatMap((group) => group.expenses))).toEqual(["Luz"]);
  });

  it("FR-22: groups Gerais then Taxas governo, each with its total paid", () => {
    const report = buildMonthFixedExpenses({
      yearMonth: "2026-11",
      expenses: [
        paid("Simples Nacional", 30000, "2026-11-20", { group: "government_fees" }),
        paid("Luz", 18743, "2026-11-10"),
        bill("TFE", { group: "government_fees", dueDate: null }),
      ],
    });
    expect(report.groups.map((group) => [group.group, group.label])).toEqual([
      ["general", "Gerais"],
      ["government_fees", "Taxas governo"],
    ]);
    expect(report.groups.map((group) => group.paidTotalCents)).toEqual([18743, 30000]);
    expect(report.groups.reduce((sum, group) => sum + group.paidTotalCents, 0)).toBe(
      report.paidTotalCents,
    );
    expect(labels(report.groups[1]!.expenses)).toEqual(["Simples Nacional", "TFE"]);
  });

  it("FR-22: both groups are present even when empty", () => {
    const report = buildMonthFixedExpenses({ yearMonth: "2026-11", expenses: [] });
    expect(report.groups.map((group) => group.expenses)).toEqual([[], []]);
    expect(report).toMatchObject({
      paidTotalCents: 0,
      pendingTotalCents: 0,
      pendingWithoutExpectedCount: 0,
    });
  });

  it("FR-22: orders by due date (none last), then by name", () => {
    const report = buildMonthFixedExpenses({
      yearMonth: "2026-11",
      expenses: [
        bill("Sem data", { dueDate: null }),
        bill("Internet", { dueDate: "2026-11-20" }),
        bill("Água", { dueDate: "2026-11-20" }),
        paid("Luz outubro", 1, "2026-11-02", { referenceMonth: "2026-10", dueDate: "2026-10-10" }),
      ],
    });
    expect(labels(report.groups[0]!.expenses)).toEqual([
      "Luz outubro",
      "Água",
      "Internet",
      "Sem data",
    ]);
  });

  it("FR-22: pending total (informative) = Σ expected of this month's pending bills", () => {
    const report = buildMonthFixedExpenses({
      yearMonth: "2026-11",
      expenses: [
        bill("Internet", { expectedAmountCents: 12990 }),
        bill("Aluguel", { expectedAmountCents: 150000, group: "government_fees" }),
        bill("Sem valor", { expectedAmountCents: null }),
        bill("Dispensada", { status: "dismissed", expectedAmountCents: 9999 }),
        paid("Luz", 18743, "2026-11-10", { expectedAmountCents: 20000 }),
      ],
    });
    expect(report.pendingTotalCents).toBe(162990);
    expect(report.pendingWithoutExpectedCount).toBe(1);
    // Informative only: never in the total paid (RN-09) nor in the saldo (RN-10).
    expect(report.paidTotalCents).toBe(18743);
  });

  it("FR-22: a pending bill of a past month is not pending in this month", () => {
    const report = buildMonthFixedExpenses({
      yearMonth: "2026-11",
      expenses: [bill("Luz outubro", { referenceMonth: "2026-10" })],
    });
    expect(report.pendingTotalCents).toBe(0);
  });

  it("lists a bill only once when it comes from both queries (ref. month and paid in month)", () => {
    const luz = paid("Luz", 18743, "2026-11-10");
    const report = buildMonthFixedExpenses({ yearMonth: "2026-11", expenses: [luz, luz] });
    expect(report.groups[0]!.expenses).toHaveLength(1);
    expect(report.paidTotalCents).toBe(18743);
  });

  it("matches its response schema", () => {
    const report = buildMonthFixedExpenses({
      yearMonth: "2026-11",
      expenses: [paid("Luz", 18743, "2026-11-10"), bill("Internet")],
    });
    expect(monthFixedExpensesReportSchema.parse(report)).toEqual(report);
  });
});
