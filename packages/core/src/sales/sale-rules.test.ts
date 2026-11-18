import { describe, expect, it } from "vitest";
import { todayCivilDate } from "../time/civil-date";
import type { PaymentMethod } from "../payments/payment-methods";
import {
  feeInstallments,
  missingFeeMessage,
  monthOf,
  needsCardFee,
  periodLockError,
  resolveInstallments,
  saleChangeLockError,
  saleDateError,
  saleMachineError,
} from "./sale-rules";

function method(overrides: Partial<PaymentMethod>): PaymentMethod {
  return {
    id: 1,
    name: "Dinheiro",
    order: 1,
    active: true,
    machineUsage: "not_applicable",
    allowsInstallments: false,
    ...overrides,
  };
}

const cash = method({});
const debit = method({ id: 2, name: "Cartão de débito", machineUsage: "required" });
const credit = method({
  id: 3,
  name: "Cartão de crédito",
  machineUsage: "required",
  allowsInstallments: true,
});
const pix = method({ id: 4, name: "PIX/Depósito", machineUsage: "optional" });

describe("RN-15: sale dates", () => {
  it("RN-15: accepts today and past dates", () => {
    expect(saleDateError("2026-11-18", "2026-11-18")).toBeNull();
    expect(saleDateError("2026-10-31", "2026-11-18")).toBeNull();
  });

  it("RN-15: rejects a future date", () => {
    expect(saleDateError("2026-11-19", "2026-11-18")).toBe(
      "Não é possível registrar lançamentos com data futura.",
    );
  });

  it("RN-15: 'today' is the São Paulo day, around midnight (UTC−3)", () => {
    // 23:59 on 18/11 in São Paulo is already 19/11 in UTC.
    const lateEvening = todayCivilDate(new Date("2026-11-19T02:59:00Z"));
    expect(lateEvening).toBe("2026-11-18");
    expect(saleDateError("2026-11-19", lateEvening)).not.toBeNull();
    // 00:00 on 19/11 in São Paulo.
    const midnight = todayCivilDate(new Date("2026-11-19T03:00:00Z"));
    expect(saleDateError("2026-11-19", midnight)).toBeNull();
  });
});

describe("RN-14: closed days and months block sales", () => {
  it("RN-14: open day in an open month → no error", () => {
    expect(periodLockError("2026-11-18", { dayClosed: false, monthClosed: false })).toBeNull();
  });

  it("RN-14: blocks a closed day and says it must be reopened (FR-09)", () => {
    expect(periodLockError("2026-11-18", { dayClosed: true, monthClosed: false })).toBe(
      "O dia 18/11/2026 está fechado. Reabra o dia para registrar ou alterar lançamentos nessa data.",
    );
  });

  it("RN-14: blocks a day of a closed month", () => {
    expect(periodLockError("2026-10-05", { dayClosed: false, monthClosed: true })).toBe(
      "O mês 10/2026 está fechado. Reabra o mês e o dia para registrar ou alterar lançamentos nessa data.",
    );
    // The month message wins: reopening the day alone is not allowed (RN-14).
    expect(periodLockError("2026-10-05", { dayClosed: true, monthClosed: true })).toContain(
      "O mês 10/2026 está fechado",
    );
  });

  it("RN-14 / FR-03: a closed day suggests reopening the day or registering a refund", () => {
    expect(saleChangeLockError("2026-11-10", { dayClosed: false, monthClosed: false })).toBeNull();
    expect(saleChangeLockError("2026-11-10", { dayClosed: true, monthClosed: false })).toBe(
      "O dia 10/11/2026 está fechado. Reabra o dia para alterar esta venda ou registre um estorno.",
    );
  });

  it("RN-14 / FR-03: a closed month asks to reopen the month and the day, or a refund", () => {
    expect(saleChangeLockError("2026-10-05", { dayClosed: true, monthClosed: true })).toBe(
      "O mês 10/2026 está fechado. Reabra o mês e o dia para alterar esta venda ou registre um estorno.",
    );
  });

  it("monthOf: the year-month of a civil date", () => {
    expect(monthOf("2026-11-18")).toBe("2026-11");
  });
});

describe("FR-01: card machine and installments of a sale", () => {
  it("FR-01: the machine is required for Débito and Crédito", () => {
    expect(saleMachineError(debit, null)).toBe("Escolha a maquininha.");
    expect(saleMachineError(credit, 7)).toBeNull();
  });

  it("FR-01: the machine is optional for PIX", () => {
    expect(saleMachineError(pix, null)).toBeNull();
    expect(saleMachineError(pix, 7)).toBeNull();
  });

  it("FR-01: the machine does not apply to Dinheiro and Boleto", () => {
    expect(saleMachineError(cash, null)).toBeNull();
    expect(saleMachineError(cash, 7)).toBe("Dinheiro não usa maquininha.");
  });

  it("FR-01: installments only for Crédito, 1 by default", () => {
    expect(resolveInstallments(credit, undefined)).toEqual({ installments: 1 });
    expect(resolveInstallments(credit, 3)).toEqual({ installments: 3 });
    expect(resolveInstallments(cash, undefined)).toEqual({ installments: null });
    expect(resolveInstallments(cash, null)).toEqual({ installments: null });
    expect(resolveInstallments(debit, 1)).toEqual({ installments: null });
    expect(resolveInstallments(debit, 2)).toEqual({
      error: "Cartão de débito não permite parcelas.",
    });
  });

  it("RN-01: the fee lookup uses 1 installment when the method has none", () => {
    expect(feeInstallments(null)).toBe(1);
    expect(feeInstallments(3)).toBe(3);
  });

  it("RN-02: only sales through a card machine have a fee", () => {
    expect(needsCardFee(cash, null)).toBe(false);
    expect(needsCardFee(pix, null)).toBe(false);
    expect(needsCardFee(pix, 7)).toBe(true);
    expect(needsCardFee(credit, 7)).toBe(true);
  });

  it("FR-01: missing-fee message names machine, method and installments", () => {
    expect(missingFeeMessage("Mercado Pago", "Cartão de crédito", 3)).toBe(
      "Cadastre a taxa de Mercado Pago / Cartão de crédito / 3x antes de registrar esta venda",
    );
  });
});
