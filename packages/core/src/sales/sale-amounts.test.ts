import { describe, expect, it } from "vitest";
import { MAX_SALE_CENTS } from "../format/money-input";
import { RATE_PPM_MAX } from "../payments/rate";
import { calculateSaleAmounts, roundHalfUpDiv } from "./sale-amounts";

describe("RN-02 / RN-03: fee and net value of a sale", () => {
  it("RN-03: R$ 150,00 at 3,79% → fee R$ 5,69 (5,685 rounded), net R$ 144,31", () => {
    expect(calculateSaleAmounts(15000, 37900)).toEqual({ feeCents: 569, netCents: 14431 });
  });

  it("RN-02: rounds half-up at exactly .005", () => {
    // R$ 1,00 at 0,5% = 0,5 cent → 1 cent.
    expect(calculateSaleAmounts(100, 5000).feeCents).toBe(1);
    // R$ 1,00 at 0,4999% = 0,4999 cent → 0.
    expect(calculateSaleAmounts(100, 4999).feeCents).toBe(0);
    // R$ 10,00 at 1,15% = 11,5 cents → 12.
    expect(calculateSaleAmounts(1000, 11500).feeCents).toBe(12);
  });

  it("RN-02: rate 0% (Dinheiro, Boleto, PIX without a machine) → fee 0, net = gross", () => {
    expect(calculateSaleAmounts(2500, 0)).toEqual({ feeCents: 0, netCents: 2500 });
  });

  it("RN-02: 100% → net 0", () => {
    expect(calculateSaleAmounts(2500, RATE_PPM_MAX)).toEqual({ feeCents: 2500, netCents: 0 });
  });

  it("RN-02: the largest amount at 100% stays exact (safe integers)", () => {
    expect(calculateSaleAmounts(MAX_SALE_CENTS, RATE_PPM_MAX)).toEqual({
      feeCents: MAX_SALE_CENTS,
      netCents: 0,
    });
    expect(calculateSaleAmounts(MAX_SALE_CENTS, 37900)).toEqual({
      // 99 999 999 × 0,0379 = 3 789 999,9621 → 3 790 000
      feeCents: 3790000,
      netCents: MAX_SALE_CENTS - 3790000,
    });
  });

  it("RN-02: a negative gross (refund, #6) rounds away from zero, mirroring the sale", () => {
    expect(calculateSaleAmounts(-15000, 37900)).toEqual({ feeCents: -569, netCents: -14431 });
    expect(calculateSaleAmounts(-100, 5000).feeCents).toBe(-1);
  });

  it("RN-02: zero gross gives zero fee", () => {
    expect(calculateSaleAmounts(0, 37900)).toEqual({ feeCents: 0, netCents: 0 });
  });

  it("RN-02: rejects non-integer cents or rates", () => {
    expect(() => calculateSaleAmounts(10.5, 100)).toThrow(RangeError);
    expect(() => calculateSaleAmounts(100, 1.5)).toThrow(RangeError);
    expect(() => calculateSaleAmounts(100, -1)).toThrow(RangeError);
  });

  it("roundHalfUpDiv: integer division rounded half away from zero", () => {
    expect(roundHalfUpDiv(5, 10)).toBe(1);
    expect(roundHalfUpDiv(4, 10)).toBe(0);
    expect(roundHalfUpDiv(-5, 10)).toBe(-1);
    expect(roundHalfUpDiv(-4, 10)).toBe(0);
    expect(roundHalfUpDiv(15, 10)).toBe(2);
  });
});
