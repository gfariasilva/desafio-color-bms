import { describe, expect, it } from "vitest";
import {
  formatRateDecimal,
  formatRatePercent,
  parseRatePercent,
  RATE_PPM_MAX,
  ratePercentSchema,
} from "./rate";

describe("FR-15: fee rate as percent × 10,000 (ADR 0001)", () => {
  it("FR-15: parses pt-BR percent text into an integer (3,79% → 37900)", () => {
    expect(parseRatePercent("3,79")).toBe(37900);
    expect(parseRatePercent("4,99")).toBe(49900);
    expect(parseRatePercent("4,59%")).toBe(45900);
    expect(parseRatePercent(" 1,5 % ")).toBe(15000);
    expect(parseRatePercent("2")).toBe(20000);
  });

  it("FR-15: accepts a dot as the decimal separator too", () => {
    expect(parseRatePercent("4.5")).toBe(45000);
  });

  it("FR-15: keeps up to 4 decimal places exactly, without floats", () => {
    expect(parseRatePercent("1,2345")).toBe(12345);
    expect(parseRatePercent("0,0001")).toBe(1);
    // 0.1 + 0.2 style float errors would show up here.
    expect(parseRatePercent("0,3")).toBe(3000);
    expect(parseRatePercent("2,01")).toBe(20100);
  });

  it("FR-15: accepts 0% and 100%", () => {
    expect(parseRatePercent("0")).toBe(0);
    expect(parseRatePercent("0,00")).toBe(0);
    expect(parseRatePercent("100")).toBe(RATE_PPM_MAX);
  });

  it("FR-15: rejects invalid text", () => {
    for (const text of [
      "",
      "  ",
      "abc",
      "1,23456",
      "-1",
      "100,01",
      "1.000,5",
      "1,2,3",
      ",5",
      "5,",
    ]) {
      expect(parseRatePercent(text), text).toBeNull();
    }
  });

  it("FR-15: formats with at least 2 and at most 4 decimal places", () => {
    expect(formatRatePercent(37900)).toBe("3,79%");
    expect(formatRatePercent(50000)).toBe("5,00%");
    expect(formatRatePercent(12345)).toBe("1,2345%");
    expect(formatRatePercent(12340)).toBe("1,234%");
    expect(formatRatePercent(0)).toBe("0,00%");
    expect(formatRatePercent(RATE_PPM_MAX)).toBe("100,00%");
    expect(formatRateDecimal(45900)).toBe("4,59");
  });

  it("FR-15: format and parse round-trip", () => {
    for (const ppm of [0, 1, 999, 37900, 49900, 123456, RATE_PPM_MAX]) {
      expect(parseRatePercent(formatRatePercent(ppm))).toBe(ppm);
    }
  });

  it("FR-15: refuses to format a non-integer or out-of-range rate", () => {
    expect(() => formatRatePercent(3.79)).toThrow(RangeError);
    expect(() => formatRatePercent(-1)).toThrow(RangeError);
  });

  it("FR-15: the stored rate must be an integer between 0% and 100%", () => {
    expect(ratePercentSchema.safeParse(37900).success).toBe(true);
    expect(ratePercentSchema.safeParse(3.79).success).toBe(false);
    expect(ratePercentSchema.safeParse(-1).success).toBe(false);
    expect(ratePercentSchema.safeParse(RATE_PPM_MAX + 1).success).toBe(false);
  });
});
