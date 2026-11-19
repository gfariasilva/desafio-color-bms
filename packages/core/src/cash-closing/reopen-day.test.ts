import { describe, expect, it } from "vitest";
import { describeAuditChanges } from "../audit/audit";
import { formatCents } from "../format/currency";
import { DAY_REOPEN_REASON_MAX, reopenDayBlock, reopenDayInputSchema } from "./reopen-day";

describe("FR-09 / RN-14: can a day be reopened?", () => {
  it("RN-14: a closed day in an open month can be reopened", () => {
    expect(reopenDayBlock("2026-11-17", { dayClosed: true, monthClosed: false })).toBeNull();
  });

  it("RN-14: a day in a closed month cannot be reopened; the month must be reopened first (FR-17)", () => {
    expect(reopenDayBlock("2026-10-31", { dayClosed: true, monthClosed: true })).toEqual({
      kind: "month_closed",
      message: "O mês 10/2026 está fechado. Reabra o mês antes de reabrir o dia.",
    });
  });

  it("RN-14: the closed month is reported first, even when the day is not closed", () => {
    expect(reopenDayBlock("2026-10-31", { dayClosed: false, monthClosed: true })?.kind).toBe(
      "month_closed",
    );
  });

  it("FR-09: a day that is not closed cannot be reopened", () => {
    expect(reopenDayBlock("2026-11-18", { dayClosed: false, monthClosed: false })).toEqual({
      kind: "not_closed",
      message: "O dia 18/11/2026 não está fechado.",
    });
  });
});

describe("FR-09: the reopening reason (motivo)", () => {
  it("FR-09: the reason is required", () => {
    for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: null }]) {
      const parsed = reopenDayInputSchema.safeParse(body);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe("Informe o motivo da reabertura.");
    }
  });

  it("FR-09: the reason is trimmed and has up to 200 characters", () => {
    expect(reopenDayInputSchema.parse({ reason: "  venda esquecida  " })).toEqual({
      reason: "venda esquecida",
    });
    expect(
      reopenDayInputSchema.safeParse({ reason: "a".repeat(DAY_REOPEN_REASON_MAX) }).success,
    ).toBe(true);
    const tooLong = reopenDayInputSchema.safeParse({
      reason: "a".repeat(DAY_REOPEN_REASON_MAX + 1),
    });
    expect(tooLong.error?.issues[0]?.message).toBe("O motivo pode ter até 200 caracteres.");
  });
});

describe("FR-18: the reopening in the audit log", () => {
  it("FR-09: the previous closing shows as the values before the reopening", () => {
    const changes = describeAuditChanges(
      { status: "closed", openingCashCents: 10000, countedCashCents: 12000, note: "faltou troco" },
      { status: "open" },
    );
    expect(changes.map((change) => [change.label, change.before, change.after])).toEqual([
      ["Situação", "Fechado", "Aberto"],
      ["Troco inicial", formatCents(10000), null],
      ["Dinheiro contado", formatCents(12000), null],
      ["Observação", "faltou troco", null],
    ]);
  });
});
