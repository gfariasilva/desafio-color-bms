import { describe, expect, it } from "vitest";
import { formatCents } from "../format/currency";
import { MAX_SALE_CENTS } from "../format/money-input";
import { RATE_PPM_MAX } from "../payments/rate";
import { calculateSaleAmounts } from "./sale-amounts";
import {
  calculateRefundAmounts,
  createRefundInputSchema,
  REFUND_REASON_MAX,
  refundableCents,
  refundChangeLockError,
  refundDateError,
  refundLimitError,
} from "./refunds";

describe("RN-04: refund amounts", () => {
  it("RN-04: refund of R$ 80,00 on Débito at 1,99% → gross −80,00, fee −1,59, net −78,41", () => {
    // 8000 × 1,99% = 159,2 cents → 159.
    expect(calculateRefundAmounts(8000, 19900)).toEqual({
      grossCents: -8000,
      feeCents: -159,
      netCents: -7841,
    });
  });

  it("RN-04: a full refund mirrors the sale (R$ 150,00 at 3,79% → fee −5,69, net −144,31)", () => {
    const sale = calculateSaleAmounts(15000, 37900);
    const refund = calculateRefundAmounts(15000, 37900);
    expect(refund).toEqual({ grossCents: -15000, feeCents: -569, netCents: -14431 });
    expect(sale.feeCents + refund.feeCents).toBe(0);
    expect(sale.netCents + refund.netCents).toBe(0);
  });

  it("RN-04: rounds the absolute value half-up, then negates (0,005 → −0,01)", () => {
    // R$ 1,00 at 0,5% = 0,5 cent → −1 cent (Math.round(−0.5) would give −0).
    expect(calculateRefundAmounts(100, 5000)).toEqual({
      grossCents: -100,
      feeCents: -1,
      netCents: -99,
    });
    // R$ 1,00 at 0,4999% → 0, never −0.
    expect(Object.is(calculateRefundAmounts(100, 4999).feeCents, 0)).toBe(true);
  });

  it("RN-04: a partial refund uses the original rate on the refunded value", () => {
    // R$ 30,00 of a R$ 150,00 sale at 3,79%: 113,7 cents → 114.
    expect(calculateRefundAmounts(3000, 37900)).toEqual({
      grossCents: -3000,
      feeCents: -114,
      netCents: -2886,
    });
  });

  it("RN-04: rate 0 (Dinheiro) → fee 0, net = gross", () => {
    expect(calculateRefundAmounts(2500, 0)).toEqual({
      grossCents: -2500,
      feeCents: 0,
      netCents: -2500,
    });
  });

  it("RN-04: the largest amount at 100% stays exact", () => {
    expect(calculateRefundAmounts(MAX_SALE_CENTS, RATE_PPM_MAX)).toEqual({
      grossCents: -MAX_SALE_CENTS,
      feeCents: -MAX_SALE_CENTS,
      netCents: 0,
    });
  });

  it("RN-04: rejects zero, negative or fractional refund values", () => {
    expect(() => calculateRefundAmounts(0, 0)).toThrow(RangeError);
    expect(() => calculateRefundAmounts(-100, 0)).toThrow(RangeError);
    expect(() => calculateRefundAmounts(10.5, 0)).toThrow(RangeError);
  });
});

describe("RN-04: the sum of refunds never passes the original gross", () => {
  it("RN-04: refundable = gross − already refunded", () => {
    expect(refundableCents(8000, 0)).toBe(8000);
    expect(refundableCents(8000, 5000)).toBe(3000);
    expect(refundableCents(8000, 8000)).toBe(0);
  });

  it("RN-04: blocks R$ 40,00 after R$ 50,00 of a R$ 80,00 sale", () => {
    expect(refundLimitError(8000, 5000, 4000)).toBe(
      `O estorno passa do valor da venda: restam ${formatCents(3000)} para estornar.`,
    );
  });

  it("RN-04: allows exactly what is left", () => {
    expect(refundLimitError(8000, 5000, 3000)).toBeNull();
    expect(refundLimitError(8000, 0, 8000)).toBeNull();
  });

  it("RN-04: a fully refunded sale says so", () => {
    expect(refundLimitError(8000, 8000, 1)).toBe("Esta venda já foi estornada por inteiro.");
  });
});

describe("FR-04: what can be refunded", () => {
  it("FR-04: only a sale from an earlier day", () => {
    expect(refundDateError("2026-11-10", "2026-11-18")).toBeNull();
    expect(refundDateError("2026-11-17", "2026-11-18")).toBeNull();
    expect(refundDateError("2026-11-18", "2026-11-18")).toBe(
      "Venda de hoje: edite ou exclua a venda em vez de estornar.",
    );
  });

  it("FR-04: the reason is required", () => {
    const result = createRefundInputSchema.safeParse({ refundCents: 100, reason: "   " });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Informe o motivo do estorno.");
    expect(createRefundInputSchema.safeParse({ refundCents: 100 }).error?.issues[0]?.message).toBe(
      "Informe o motivo do estorno.",
    );
  });

  it("FR-04: the reason is trimmed and has a maximum length", () => {
    expect(
      createRefundInputSchema.parse({ refundCents: 100, reason: "  produto com defeito " }),
    ).toEqual({ refundCents: 100, reason: "produto com defeito" });
    const tooLong = createRefundInputSchema.safeParse({
      refundCents: 100,
      reason: "x".repeat(REFUND_REASON_MAX + 1),
    });
    expect(tooLong.error?.issues[0]?.message).toBe(
      `O motivo pode ter até ${REFUND_REASON_MAX} caracteres.`,
    );
  });

  it("FR-04: the refund value is positive integer cents up to the maximum", () => {
    const message = (refundCents: unknown) =>
      createRefundInputSchema.safeParse({ refundCents, reason: "x" }).error?.issues[0]?.message;
    expect(message(0)).toBe("Informe um valor maior que zero.");
    expect(message(-100)).toBe("Informe um valor maior que zero.");
    expect(message(1.5)).toBe("Valor inválido.");
    expect(message(MAX_SALE_CENTS + 1)).toBe(
      `O valor máximo de uma venda é ${formatCents(MAX_SALE_CENTS)}.`,
    );
    expect(message(MAX_SALE_CENTS)).toBeUndefined();
  });
});

describe("RN-14: refunds on a closed period", () => {
  it("RN-14: a refund on a closed day is deleted only after reopening (no refund hint)", () => {
    expect(refundChangeLockError("2026-11-18", { dayClosed: true, monthClosed: false })).toBe(
      "O dia 18/11/2026 está fechado. Reabra o dia para excluir este estorno.",
    );
    expect(refundChangeLockError("2026-11-18", { dayClosed: false, monthClosed: true })).toBe(
      "O mês 11/2026 está fechado. Reabra o mês e o dia para excluir este estorno.",
    );
    expect(refundChangeLockError("2026-11-18", { dayClosed: false, monthClosed: false })).toBe(
      null,
    );
  });
});
