import { describe, expect, it } from "vitest";
import { describeAuditChanges } from "../audit/audit";
import { formatCents } from "../format/currency";
import { CASH_CLOSING_NOTE_MAX, closeDayInputSchema } from "./cash-closing";
import {
  cashDifferenceCents,
  cashDifferenceLabel,
  closeDayBlock,
  expectedCashCents,
} from "./cash-closing-rules";

describe("RN-07: expected cash", () => {
  it("RN-07: expected = opening + cash sales − expenses paid from the till − sangrias", () => {
    // R$ 200,00 opening, R$ 500,00 cash sales, R$ 45,00 fuel from the till, R$ 300,00 to the bank.
    expect(
      expectedCashCents({
        openingCashCents: 20000,
        cashSalesCents: 50000,
        tillExpensesCents: 4500,
        withdrawalsCents: 30000,
      }),
    ).toBe(35500);
  });

  it("RN-07: cash refunds are already negative in the cash sales term", () => {
    // R$ 100,00 of cash sales and a R$ 80,00 cash refund of an earlier sale.
    expect(
      expectedCashCents({
        openingCashCents: 5000,
        cashSalesCents: 10000 - 8000,
        tillExpensesCents: 0,
        withdrawalsCents: 0,
      }),
    ).toBe(7000);
  });

  it("RN-07: a day with no cash movement expects the opening cash", () => {
    expect(
      expectedCashCents({
        openingCashCents: 0,
        cashSalesCents: 0,
        tillExpensesCents: 0,
        withdrawalsCents: 0,
      }),
    ).toBe(0);
    expect(
      expectedCashCents({
        openingCashCents: 12345,
        cashSalesCents: 0,
        tillExpensesCents: 0,
        withdrawalsCents: 0,
      }),
    ).toBe(12345);
  });

  it("RN-07: expected cash can be negative (more cash out than in); it is not clamped", () => {
    expect(
      expectedCashCents({
        openingCashCents: 0,
        cashSalesCents: 1000,
        tillExpensesCents: 500,
        withdrawalsCents: 2000,
      }),
    ).toBe(-1500);
  });

  it("RN-07: stays exact with the largest amounts (integer cents)", () => {
    expect(
      expectedCashCents({
        openingCashCents: 99_999_999,
        cashSalesCents: 99_999_999 * 1000,
        tillExpensesCents: 1,
        withdrawalsCents: 99_999_999,
      }),
    ).toBe(99_999_999 * 1000 - 1);
  });
});

describe("RN-07: cash difference", () => {
  it("RN-07: difference = counted − expected; > 0 is a surplus (sobra)", () => {
    expect(cashDifferenceCents(35600, 35500)).toBe(100);
    expect(cashDifferenceLabel(100)).toBe(`Sobra de ${formatCents(100)}`);
  });

  it("RN-07: < 0 is a shortage (falta), shown without the minus sign", () => {
    expect(cashDifferenceCents(35000, 35500)).toBe(-500);
    expect(cashDifferenceLabel(-500)).toBe(`Falta de ${formatCents(500)}`);
  });

  it("RN-07: zero difference", () => {
    expect(cashDifferenceCents(35500, 35500)).toBe(0);
    expect(cashDifferenceLabel(0)).toBe("Sem diferença");
  });

  it("RN-07: a negative expected cash gives a surplus when R$ 0,00 is counted", () => {
    expect(cashDifferenceCents(0, -1500)).toBe(1500);
  });
});

describe("FR-08 / RN-14 / RN-15: when a day can be closed", () => {
  const open = { dayClosed: false, monthClosed: false };
  const today = "2026-11-18";

  it("FR-08: an open day with movement, today or earlier, can be closed", () => {
    expect(closeDayBlock("2026-11-18", today, open, true)).toBeNull();
    expect(closeDayBlock("2026-11-10", today, open, true)).toBeNull();
  });

  it("RN-15: a future day cannot be closed", () => {
    expect(closeDayBlock("2026-11-19", today, open, true)).toEqual({
      kind: "future",
      message: "Não é possível fechar um dia futuro.",
    });
  });

  it("RN-14: a day already closed cannot be closed again", () => {
    expect(
      closeDayBlock("2026-11-10", today, { dayClosed: true, monthClosed: false }, true),
    ).toEqual({ kind: "day_closed", message: "O dia 10/11/2026 já está fechado." });
  });

  it("RN-14: a day of a closed month cannot be closed (the month is reported first)", () => {
    expect(
      closeDayBlock("2026-10-10", today, { dayClosed: true, monthClosed: true }, true),
    ).toEqual({ kind: "month_closed", message: "O mês 10/2026 está fechado. Reabra o mês antes." });
  });

  it("A-15: a day without movement does not need to be closed", () => {
    expect(closeDayBlock("2026-11-10", today, open, false)).toEqual({
      kind: "no_movement",
      message: "Este dia não tem movimento e não precisa ser fechado.",
    });
  });
});

describe("FR-08: closing input", () => {
  const valid = { openingCashCents: 20000, countedCashCents: 35500, note: "conferido" };

  function firstMessage(input: unknown) {
    const parsed = closeDayInputSchema.safeParse(input);
    return parsed.success ? null : parsed.error.issues[0]?.message;
  }

  it("FR-08: accepts the opening cash, the counted cash and an optional note", () => {
    expect(closeDayInputSchema.parse(valid)).toEqual(valid);
    expect(closeDayInputSchema.parse({ openingCashCents: 0, countedCashCents: 0 })).toEqual({
      openingCashCents: 0,
      countedCashCents: 0,
    });
  });

  it("FR-08: first day: the opening cash must be typed (no default)", () => {
    expect(firstMessage({ countedCashCents: 100 })).toBe("Informe o troco inicial.");
    expect(firstMessage({ openingCashCents: null, countedCashCents: 100 })).toBe(
      "Informe o troco inicial.",
    );
  });

  it("FR-08: the counted cash is required", () => {
    expect(firstMessage({ openingCashCents: 100 })).toBe("Informe o dinheiro contado.");
  });

  it("FR-08: amounts are integer cents from R$ 0,00 to R$ 999.999,99", () => {
    expect(firstMessage({ ...valid, openingCashCents: -1 })).toBe("O valor não pode ser negativo.");
    expect(firstMessage({ ...valid, countedCashCents: 10.5 })).toBe("Valor inválido.");
    expect(
      closeDayInputSchema.parse({ ...valid, countedCashCents: 99_999_999 }).countedCashCents,
    ).toBe(99_999_999);
    expect(firstMessage({ ...valid, countedCashCents: 100_000_000 })).toBe(
      `O valor máximo é ${formatCents(99_999_999)}.`,
    );
  });

  it(`FR-08: the note is optional, trimmed, up to ${CASH_CLOSING_NOTE_MAX} characters`, () => {
    expect(closeDayInputSchema.parse({ ...valid, note: "  faltou troco " }).note).toBe(
      "faltou troco",
    );
    expect(closeDayInputSchema.parse({ ...valid, note: "   " }).note).toBeNull();
    const max = "x".repeat(CASH_CLOSING_NOTE_MAX);
    expect(closeDayInputSchema.parse({ ...valid, note: max }).note).toBe(max);
    expect(firstMessage({ ...valid, note: `${max}x` })).toBe(
      `A observação pode ter até ${CASH_CLOSING_NOTE_MAX} caracteres.`,
    );
  });
});

describe("FR-18: the closing in the audit log", () => {
  it("FR-18: closing fields have pt-BR labels; money shows as R$ and the status in words", () => {
    const changes = describeAuditChanges(null, {
      status: "closed",
      openingCashCents: 20000,
      cashSalesCents: 50000,
      tillExpensesCents: 4500,
      withdrawalsCents: 30000,
      expectedCashCents: 35500,
      countedCashCents: 35000,
      differenceCents: -500,
    });
    expect(changes.map((change) => [change.label, change.after])).toEqual([
      ["Situação", "Fechado"],
      ["Troco inicial", formatCents(20000)],
      ["Vendas em dinheiro", formatCents(50000)],
      ["Despesas pagas do caixa", formatCents(4500)],
      ["Sangrias", formatCents(30000)],
      ["Dinheiro esperado", formatCents(35500)],
      ["Dinheiro contado", formatCents(35000)],
      ["Diferença", formatCents(-500)],
    ]);
  });
});
