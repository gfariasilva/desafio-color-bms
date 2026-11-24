import { describe, expect, it } from "vitest";
import { formatVariation, percentTenths, variationTenths } from "./variation";

describe("variationTenths (RN-11)", () => {
  it("RN-11: variation = (current − previous) ÷ |previous| × 100", () => {
    // R$ 15,00 against R$ 10,00 → +50,0 %, in tenths of a percent.
    expect(variationTenths(1500, 1000)).toBe(500);
    expect(variationTenths(500, 1000)).toBe(-500);
    expect(variationTenths(1000, 1000)).toBe(0);
    expect(variationTenths(3000, 1000)).toBe(2000);
    expect(variationTenths(0, 1000)).toBe(-1000);
  });

  it("RN-11: a negative previous value uses its absolute value", () => {
    // Saldo of −R$ 10,00 that became −R$ 5,00 improved: +50,0 %.
    expect(variationTenths(-500, -1000)).toBe(500);
    // −R$ 10,00 → +R$ 10,00: +200,0 %.
    expect(variationTenths(1000, -1000)).toBe(2000);
    // +R$ 10,00 → −R$ 5,00: −150,0 %.
    expect(variationTenths(-500, 1000)).toBe(-1500);
  });

  it('RN-11: previous 0 → null (shown as "—")', () => {
    expect(variationTenths(1500, 0)).toBeNull();
    expect(variationTenths(0, 0)).toBeNull();
    expect(variationTenths(-1500, 0)).toBeNull();
  });

  it("RN-11: rounds to 1 decimal, half away from zero", () => {
    expect(variationTenths(2001, 2000)).toBe(1); // +0,05 % → +0,1 %
    expect(variationTenths(1999, 2000)).toBe(-1); // −0,05 % → −0,1 %
    expect(variationTenths(4001, 4000)).toBe(0); // +0,025 % → 0,0 %
    expect(variationTenths(4, 3)).toBe(333); // +33,33… % → +33,3 %
    expect(variationTenths(5, 3)).toBe(667); // +66,66… % → +66,7 %
    expect(variationTenths(2, 3)).toBe(-333); // −33,33… % → −33,3 %
    expect(variationTenths(1, 3)).toBe(-667); // −66,66… % → −66,7 %
  });

  it("RN-11: large amounts stay exact (integer math)", () => {
    // R$ 999.999,99 against R$ 1,00.
    expect(variationTenths(99_999_999, 100)).toBe(999_998_990); // +99.999.899,0 %
    // A whole year of a busy shop against one cent more.
    expect(variationTenths(1_000_000_001, 1_000_000_000)).toBe(0);
  });

  it("RN-11: any two safe integers work, even when their difference is not safe", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(variationTenths(max, -max)).toBe(2000); // +200,0 %
    expect(variationTenths(-max, max)).toBe(-2000);
  });

  it("RN-11: rejects amounts that are not integer cents", () => {
    expect(() => variationTenths(10.5, 100)).toThrow(RangeError);
    expect(() => variationTenths(100, Number.NaN)).toThrow(RangeError);
  });
});

describe("percentTenths (RN-11, FR-25)", () => {
  it("RN-11: part ÷ base × 100 in tenths, half away from zero, never −0", () => {
    expect(percentTenths(1, 3)).toBe(333);
    expect(percentTenths(-1, 2000)).toBe(-1);
    expect(percentTenths(-1, 4000)).toBe(0);
    expect(Object.is(percentTenths(-1, 4000), -0)).toBe(false);
  });

  it("RN-11: rejects a base that is not a positive integer", () => {
    expect(() => percentTenths(1, 0)).toThrow(RangeError);
    expect(() => percentTenths(1, -5)).toThrow(RangeError);
    expect(() => percentTenths(0.5, 5)).toThrow(RangeError);
  });
});

describe("formatVariation (RN-11)", () => {
  it('RN-11: formats "+50,0%", "−12,3%", "0,0%" and "—"', () => {
    expect(formatVariation(500)).toBe("+50,0%");
    expect(formatVariation(-123)).toBe("−12,3%");
    expect(formatVariation(0)).toBe("0,0%");
    expect(formatVariation(5)).toBe("+0,5%");
    expect(formatVariation(-5)).toBe("−0,5%");
    expect(formatVariation(null)).toBe("—");
  });

  it("RN-11: groups thousands like money (pt-BR)", () => {
    expect(formatVariation(12_345)).toBe("+1.234,5%");
    expect(formatVariation(-1_234_567)).toBe("−123.456,7%");
  });
});
