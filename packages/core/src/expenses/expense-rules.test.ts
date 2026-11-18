import { describe, expect, it } from "vitest";
import { todayCivilDate } from "../time/civil-date";
import {
  expenseChangeLockError,
  expenseDateError,
  expenseLockError,
  resolvePaidFromTill,
} from "./expense-rules";
import { EXPENSE_PAYMENT_MEANS, EXPENSE_PAYMENT_MEANS_LABELS, EXPENSE_TEXTS } from "./expenses";

describe("A-14 / FR-06: payment means of expenses", () => {
  it("A-14: the fixed list is Dinheiro, PIX, Cartão, Boleto, Transferência/Débito em conta", () => {
    expect(EXPENSE_PAYMENT_MEANS.map((means) => EXPENSE_PAYMENT_MEANS_LABELS[means])).toEqual([
      "Dinheiro",
      "PIX",
      "Cartão",
      "Boleto",
      "Transferência/Débito em conta",
    ]);
  });

  it("FR-06: paid from the till defaults to yes for Dinheiro", () => {
    expect(resolvePaidFromTill("cash", undefined)).toEqual({ paidFromTill: true });
    expect(resolvePaidFromTill("cash", true)).toEqual({ paidFromTill: true });
    expect(resolvePaidFromTill("cash", false)).toEqual({ paidFromTill: false });
  });

  it("FR-06: the other means are never paid from the till (default no)", () => {
    for (const means of ["pix", "card", "boleto", "bank_transfer"] as const) {
      expect(resolvePaidFromTill(means, undefined)).toEqual({ paidFromTill: false });
      expect(resolvePaidFromTill(means, false)).toEqual({ paidFromTill: false });
    }
  });

  it("FR-06: only Dinheiro can be paid from the till", () => {
    expect(resolvePaidFromTill("pix", true)).toEqual({
      error: EXPENSE_TEXTS.paidFromTillOnlyCash,
    });
  });
});

describe("RN-15: expense payment dates", () => {
  it("RN-15: accepts today and past dates, rejects a future one", () => {
    expect(expenseDateError("2026-11-18", "2026-11-18")).toBeNull();
    expect(expenseDateError("2026-10-01", "2026-11-18")).toBeNull();
    expect(expenseDateError("2026-11-19", "2026-11-18")).toBe(
      "Não é possível registrar lançamentos com data futura.",
    );
  });

  it("RN-15: 'today' is the São Paulo day around midnight", () => {
    // 23:59 on 18/11 in São Paulo is 02:59 on 19/11 in UTC.
    const lateEvening = todayCivilDate(new Date("2026-11-19T02:59:00Z"));
    expect(expenseDateError("2026-11-19", lateEvening)).not.toBeNull();
    const midnight = todayCivilDate(new Date("2026-11-19T03:00:00Z"));
    expect(expenseDateError("2026-11-19", midnight)).toBeNull();
  });
});

describe("RN-14: expenses on closed days and months", () => {
  const open = { dayClosed: false, monthClosed: false };

  it("RN-14: an open day and month allow changes", () => {
    expect(expenseLockError("2026-11-10", open)).toBeNull();
    expect(expenseChangeLockError("2026-11-10", open)).toBeNull();
  });

  it("RN-14: a closed day blocks creating, and the edit message suggests reopening", () => {
    const closed = { dayClosed: true, monthClosed: false };
    expect(expenseLockError("2026-11-10", closed)).toBe(
      "O dia 10/11/2026 está fechado. Reabra o dia para registrar ou alterar lançamentos nessa data.",
    );
    expect(expenseChangeLockError("2026-11-10", closed)).toBe(
      "O dia 10/11/2026 está fechado. Reabra o dia para alterar ou excluir esta despesa.",
    );
  });

  it("RN-14: a closed month is reported first", () => {
    expect(expenseChangeLockError("2026-10-31", { dayClosed: true, monthClosed: true })).toBe(
      "O mês 10/2026 está fechado. Reabra o mês e o dia para alterar ou excluir esta despesa.",
    );
  });
});
