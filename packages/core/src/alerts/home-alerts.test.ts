import { describe, expect, it } from "vitest";
import { daysBetween } from "../time/civil-date";
import {
  dueAlertText,
  fixedExpenseDueAlert,
  homeAlertCount,
  homeAlertsResponseSchema,
  isCashDifferenceAlert,
  type HomeAlertsResponse,
} from "./home-alerts";

const TODAY = "2026-11-18";

describe("FR-27: Conta a vencer / Conta vencida", () => {
  it("FR-27: due soon from today to today + 3 days (default), both included", () => {
    expect(fixedExpenseDueAlert("2026-11-18", TODAY, 3)).toBe("due_soon");
    expect(fixedExpenseDueAlert("2026-11-19", TODAY, 3)).toBe("due_soon");
    expect(fixedExpenseDueAlert("2026-11-21", TODAY, 3)).toBe("due_soon");
  });

  it("FR-27: due on today + 4 is not an alert yet", () => {
    expect(fixedExpenseDueAlert("2026-11-22", TODAY, 3)).toBeNull();
  });

  it("FR-27/FR-33: the window follows the configured days; 0 means only today", () => {
    expect(fixedExpenseDueAlert("2026-11-18", TODAY, 0)).toBe("due_soon");
    expect(fixedExpenseDueAlert("2026-11-19", TODAY, 0)).toBeNull();
    expect(fixedExpenseDueAlert("2026-11-25", TODAY, 7)).toBe("due_soon");
  });

  it("FR-27: the window crosses the end of the year", () => {
    expect(fixedExpenseDueAlert("2027-01-02", "2026-12-30", 3)).toBe("due_soon");
    expect(fixedExpenseDueAlert("2027-01-03", "2026-12-30", 3)).toBeNull();
  });

  it("FR-27: overdue when the due date is before today", () => {
    expect(fixedExpenseDueAlert("2026-11-17", TODAY, 3)).toBe("overdue");
    expect(fixedExpenseDueAlert("2026-10-20", TODAY, 3)).toBe("overdue");
  });

  it("FR-27: a bill without a due date is neither due soon nor overdue", () => {
    expect(fixedExpenseDueAlert(null, TODAY, 3)).toBeNull();
  });
});

describe("FR-27: the due text", () => {
  it.each([
    ["2026-11-18", "vence hoje"],
    ["2026-11-19", "vence amanhã"],
    ["2026-11-21", "vence em 3 dias"],
    ["2026-11-17", "venceu ontem"],
    ["2026-11-16", "venceu há 2 dias"],
    ["2026-10-20", "venceu há 29 dias"],
  ])("FR-27: due %s → %s", (dueDate, text) => {
    expect(dueAlertText(dueDate, TODAY)).toBe(text);
  });
});

describe("daysBetween (civil dates)", () => {
  it("counts calendar days, across months, years and the DST-free São Paulo calendar", () => {
    expect(daysBetween("2026-11-18", "2026-11-18")).toBe(0);
    expect(daysBetween("2026-11-18", "2026-11-21")).toBe(3);
    expect(daysBetween("2026-11-18", "2026-10-20")).toBe(-29);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
});

describe("FR-27/A-17: Diferença de caixa", () => {
  it("A-17: with the default limit R$ 0,00 any difference alerts", () => {
    expect(isCashDifferenceAlert(0, 0)).toBe(false);
    expect(isCashDifferenceAlert(-1, 0)).toBe(true);
    expect(isCashDifferenceAlert(1, 0)).toBe(true);
  });

  it("FR-27: alerts only when |diferença| > limit (a surplus or a shortage)", () => {
    expect(isCashDifferenceAlert(500, 500)).toBe(false);
    expect(isCashDifferenceAlert(-500, 500)).toBe(false);
    expect(isCashDifferenceAlert(501, 500)).toBe(true);
    expect(isCashDifferenceAlert(-501, 500)).toBe(true);
  });
});

const NOTHING: HomeAlertsResponse = {
  today: TODAY,
  dueSoonDays: 3,
  overdueBills: [],
  dueSoonBills: [],
  unclosedDays: [],
  cashDifference: null,
};

const BILL = {
  id: 1,
  label: "Luz",
  referenceMonth: "2026-11",
  dueDate: "2026-11-20",
  expectedAmountCents: 20000,
};

describe("FR-27: Tudo em dia", () => {
  it("FR-27: no active condition → 0 alerts (Tudo em dia)", () => {
    expect(
      homeAlertCount({
        alerts: NOTHING,
        failedExports: 0,
        oneDriveNotConfigured: false,
        startupErrors: 0,
      }),
    ).toBe(0);
  });

  it("FR-27: every condition counts, one per row", () => {
    expect(
      homeAlertCount({
        alerts: {
          ...NOTHING,
          overdueBills: [{ ...BILL, dueDate: "2026-11-10" }],
          dueSoonBills: [BILL, { ...BILL, id: 2 }],
          unclosedDays: ["2026-11-17"],
          cashDifference: { date: "2026-11-17", differenceCents: -500, limitCents: 0 },
        },
        failedExports: 2,
        oneDriveNotConfigured: true,
        startupErrors: 1,
      }),
    ).toBe(9);
  });

  it("FR-27: a failed export alone is not Tudo em dia (Backup pendente)", () => {
    expect(
      homeAlertCount({
        alerts: NOTHING,
        failedExports: 1,
        oneDriveNotConfigured: false,
        startupErrors: 0,
      }),
    ).toBe(1);
  });

  it("FR-27: the response schema accepts the server's answer", () => {
    expect(homeAlertsResponseSchema.parse({ ...NOTHING, dueSoonBills: [BILL] })).toEqual({
      ...NOTHING,
      dueSoonBills: [BILL],
    });
  });
});
