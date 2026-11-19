import { describe, expect, it } from "vitest";
import { describeAuditChanges } from "../audit/audit";
import {
  closeMonthBlock,
  lastDateOfMonth,
  monthParamsSchema,
  MONTH_REOPEN_REASON_MAX,
  reopenMonthBlock,
  reopenMonthInputSchema,
} from "./month-closing";

const open = { monthClosed: false, pendingDays: [] };

describe("FR-16 / RN-14: can a month be closed?", () => {
  it("RN-14: a month whose days with movement are all closed can be closed", () => {
    expect(closeMonthBlock("2026-10", "2026-11-18", open)).toBeNull();
  });

  it("RN-14: a day with movement still open blocks and is listed", () => {
    expect(
      closeMonthBlock("2026-10", "2026-11-18", { monthClosed: false, pendingDays: ["2026-10-31"] }),
    ).toEqual({
      kind: "pending_days",
      message: "Feche o dia com movimento ainda aberto antes de fechar o mês 10/2026: 31/10/2026.",
    });
  });

  it("RN-14: every pending day is listed, in the given order", () => {
    const block = closeMonthBlock("2026-10", "2026-11-18", {
      monthClosed: false,
      pendingDays: ["2026-10-03", "2026-10-15"],
    });
    expect(block?.message).toBe(
      "Feche os dias com movimento ainda abertos antes de fechar o mês 10/2026: 03/10/2026, 15/10/2026.",
    );
  });

  it("FR-16: a month can be closed on its own last day", () => {
    expect(closeMonthBlock("2026-11", "2026-11-30", open)).toBeNull();
  });

  it("FR-16: the current month cannot be closed before its last day", () => {
    expect(closeMonthBlock("2026-11", "2026-11-18", open)).toEqual({
      kind: "not_ended",
      message: "O mês 11/2026 ainda não terminou. Ele pode ser fechado a partir de 30/11/2026.",
    });
  });

  it("FR-16: a future month cannot be closed", () => {
    expect(closeMonthBlock("2026-12", "2026-11-18", open)?.kind).toBe("not_ended");
  });

  it("FR-16: a month with no movement at all can be closed", () => {
    expect(closeMonthBlock("2026-09", "2026-11-18", open)).toBeNull();
  });

  it("FR-16: an already closed month is reported first", () => {
    expect(
      closeMonthBlock("2026-12", "2026-11-18", { monthClosed: true, pendingDays: ["2026-12-01"] }),
    ).toEqual({ kind: "closed", message: "O mês 12/2026 já está fechado." });
  });
});

describe("FR-17: can a month be reopened?", () => {
  it("FR-17: a closed month can be reopened", () => {
    expect(reopenMonthBlock("2026-10", { monthClosed: true })).toBeNull();
  });

  it("FR-17: an open month cannot be reopened", () => {
    expect(reopenMonthBlock("2026-10", { monthClosed: false })).toBe(
      "O mês 10/2026 não está fechado.",
    );
  });

  it("FR-17: the reason is required and trimmed", () => {
    expect(reopenMonthInputSchema.parse({ reason: "  venda esquecida " })).toEqual({
      reason: "venda esquecida",
    });
    for (const body of [{}, { reason: "" }, { reason: "   " }]) {
      const parsed = reopenMonthInputSchema.safeParse(body);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe("Informe o motivo da reabertura.");
    }
  });

  it("FR-17: the reason has a maximum length", () => {
    const tooLong = "a".repeat(MONTH_REOPEN_REASON_MAX + 1);
    expect(reopenMonthInputSchema.safeParse({ reason: tooLong }).success).toBe(false);
    expect(
      reopenMonthInputSchema.safeParse({ reason: "a".repeat(MONTH_REOPEN_REASON_MAX) }).success,
    ).toBe(true);
  });
});

describe("months", () => {
  it("lastDateOfMonth: 30, 31 and leap February", () => {
    expect(lastDateOfMonth("2026-11")).toBe("2026-11-30");
    expect(lastDateOfMonth("2026-12")).toBe("2026-12-31");
    expect(lastDateOfMonth("2028-02")).toBe("2028-02-29");
  });

  it("monthParamsSchema: only YYYY-MM", () => {
    expect(monthParamsSchema.safeParse({ yearMonth: "2026-10" }).success).toBe(true);
    for (const yearMonth of ["2026-13", "2026-1", "2026-10-01", "x"]) {
      const parsed = monthParamsSchema.safeParse({ yearMonth });
      expect(parsed.error?.issues[0]?.message).toBe("Mês inválido.");
    }
  });

  it("FR-18: the month closing audit shows its status and the pending fixed expenses", () => {
    expect(
      describeAuditChanges({ status: "open" }, { status: "closed", pendingFixedExpenses: 2 }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Situação", before: "Aberto", after: "Fechado" }),
        expect.objectContaining({ label: "Despesas fixas pendentes", after: "2" }),
      ]),
    );
  });
});
