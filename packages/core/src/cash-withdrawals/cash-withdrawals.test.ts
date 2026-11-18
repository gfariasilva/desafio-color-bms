import { describe, expect, it } from "vitest";
import { formatCents } from "../format/currency";
import {
  CASH_WITHDRAWAL_NOTE_MAX,
  createCashWithdrawalInputSchema,
  updateCashWithdrawalInputSchema,
} from "./cash-withdrawals";
import {
  cashWithdrawalChangeLockError,
  cashWithdrawalDateError,
  cashWithdrawalLockError,
} from "./cash-withdrawal-rules";
import { cashWithdrawalsOfDayCents } from "./cash-withdrawal-totals";

const valid = { date: "2026-11-18", amountCents: 30000, note: "depósito no banco" };

function firstMessage(
  input: unknown,
  schema:
    | typeof createCashWithdrawalInputSchema
    | typeof updateCashWithdrawalInputSchema = createCashWithdrawalInputSchema,
) {
  const parsed = schema.safeParse(input);
  return parsed.success ? null : parsed.error.issues[0]?.message;
}

describe("FR-07: sangria input", () => {
  it('FR-07: accepts R$ 300,00 with the note "depósito no banco"', () => {
    expect(createCashWithdrawalInputSchema.parse(valid)).toEqual(valid);
  });

  it("FR-07: the note is optional; an empty or blank note is no note", () => {
    expect(createCashWithdrawalInputSchema.parse({ ...valid, note: undefined }).note).toBe(
      undefined,
    );
    expect(createCashWithdrawalInputSchema.parse({ ...valid, note: "   " }).note).toBeNull();
    expect(createCashWithdrawalInputSchema.parse({ ...valid, note: "  banco " }).note).toBe(
      "banco",
    );
  });

  it(`FR-07: the note has up to ${CASH_WITHDRAWAL_NOTE_MAX} characters`, () => {
    const max = "x".repeat(CASH_WITHDRAWAL_NOTE_MAX);
    expect(createCashWithdrawalInputSchema.parse({ ...valid, note: max }).note).toBe(max);
    expect(firstMessage({ ...valid, note: `${max}x` })).toBe(
      `A observação pode ter até ${CASH_WITHDRAWAL_NOTE_MAX} caracteres.`,
    );
  });

  it("FR-07: the value must be greater than 0", () => {
    expect(firstMessage({ ...valid, amountCents: 0 })).toBe("Informe um valor maior que zero.");
    expect(firstMessage({ ...valid, amountCents: -30000 })).toBe(
      "Informe um valor maior que zero.",
    );
    expect(firstMessage({ ...valid, amountCents: undefined })).toBe(
      "Informe um valor maior que zero.",
    );
    expect(createCashWithdrawalInputSchema.parse({ ...valid, amountCents: 1 }).amountCents).toBe(1);
  });

  it("FR-07: the value is integer cents up to R$ 999.999,99", () => {
    expect(firstMessage({ ...valid, amountCents: 300.5 })).toBe("Valor inválido.");
    expect(
      createCashWithdrawalInputSchema.parse({ ...valid, amountCents: 99_999_999 }).amountCents,
    ).toBe(99_999_999);
    expect(firstMessage({ ...valid, amountCents: 100_000_000 })).toBe(
      `O valor máximo de uma sangria é ${formatCents(99_999_999)}.`,
    );
  });

  it("FR-07: the date must be a real civil date", () => {
    expect(firstMessage({ ...valid, date: "2026-02-30" })).toBe("Data inválida.");
    expect(firstMessage({ ...valid, date: "18/11/2026" })).toBe("Data inválida.");
  });

  it("FR-07: an edit changes any subset of the fields, but at least one", () => {
    expect(updateCashWithdrawalInputSchema.parse({ amountCents: 100 })).toEqual({
      amountCents: 100,
    });
    expect(updateCashWithdrawalInputSchema.parse({ note: "" })).toEqual({ note: null });
    expect(firstMessage({}, updateCashWithdrawalInputSchema)).not.toBeNull();
  });
});

describe("RN-15 / RN-14: when a sangria can be saved", () => {
  const open = { dayClosed: false, monthClosed: false };

  it("RN-15: no future date; today and earlier days are fine", () => {
    expect(cashWithdrawalDateError("2026-11-19", "2026-11-18")).toBe(
      "Não é possível registrar lançamentos com data futura.",
    );
    expect(cashWithdrawalDateError("2026-11-18", "2026-11-18")).toBeNull();
    expect(cashWithdrawalDateError("2026-10-31", "2026-11-18")).toBeNull();
  });

  it("RN-14: no sangria on a closed day or in a closed month", () => {
    expect(cashWithdrawalLockError("2026-11-10", open)).toBeNull();
    expect(cashWithdrawalLockError("2026-11-10", { dayClosed: true, monthClosed: false })).toBe(
      "O dia 10/11/2026 está fechado. Reabra o dia para registrar ou alterar lançamentos nessa data.",
    );
    expect(cashWithdrawalLockError("2026-11-10", { dayClosed: false, monthClosed: true })).toBe(
      "O mês 11/2026 está fechado. Reabra o mês e o dia para registrar ou alterar lançamentos nessa data.",
    );
  });

  it("RN-14: a sangria on a closed day cannot be edited or deleted", () => {
    expect(cashWithdrawalChangeLockError("2026-11-10", open)).toBeNull();
    expect(
      cashWithdrawalChangeLockError("2026-11-10", { dayClosed: true, monthClosed: false }),
    ).toBe("O dia 10/11/2026 está fechado. Reabra o dia para alterar ou excluir esta sangria.");
  });
});

describe("RN-07: the sangrias term of expected cash", () => {
  it("RN-07: sums the sangrias of the date only", () => {
    const rows = [
      { date: "2026-11-17", amountCents: 5000 },
      { date: "2026-11-18", amountCents: 30000 },
      { date: "2026-11-18", amountCents: 1 },
      { date: "2026-11-19", amountCents: 700 },
    ];
    expect(cashWithdrawalsOfDayCents(rows, "2026-11-18")).toBe(30001);
  });

  it("RN-07: a day without sangrias subtracts zero", () => {
    expect(cashWithdrawalsOfDayCents([], "2026-11-18")).toBe(0);
  });
});
