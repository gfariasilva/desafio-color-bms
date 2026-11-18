import { describe, expect, it } from "vitest";
import { MAX_SALE_CENTS, parseMoneyText, parseMoneyToCents } from "./money-input";

describe("FR-01: parse a typed amount into integer cents (NFR-12)", () => {
  it("FR-01: parses pt-BR amounts", () => {
    expect(parseMoneyToCents("1.234,56")).toBe(123456);
    expect(parseMoneyToCents("1234,56")).toBe(123456);
    expect(parseMoneyToCents("150,00")).toBe(15000);
    expect(parseMoneyToCents("0,01")).toBe(1);
    expect(parseMoneyToCents("1.000.000,00")).toBeNull(); // above the maximum
    expect(parseMoneyToCents("999.999,99")).toBe(MAX_SALE_CENTS);
  });

  it("FR-01: a whole number means reais (25 → R$ 25,00)", () => {
    expect(parseMoneyToCents("25")).toBe(2500);
    expect(parseMoneyToCents("1.234")).toBe(123400);
  });

  it("FR-01: one decimal digit means tens of cents (25,5 → R$ 25,50)", () => {
    expect(parseMoneyToCents("25,5")).toBe(2550);
  });

  it("FR-01: a dot followed by 1–2 digits is a decimal point (numeric keypad)", () => {
    expect(parseMoneyToCents("25.5")).toBe(2550);
    expect(parseMoneyToCents("25.50")).toBe(2550);
  });

  it("FR-01: ignores spaces and an optional R$", () => {
    expect(parseMoneyToCents(" R$ 25,00 ")).toBe(2500);
    expect(parseMoneyToCents("R$25")).toBe(2500);
  });

  it("FR-01: never uses floats (0,29 and 1.005,07 are exact)", () => {
    expect(parseMoneyToCents("0,29")).toBe(29);
    expect(parseMoneyToCents("1.005,07")).toBe(100507);
  });

  it("FR-01: rejects zero, negatives and malformed text", () => {
    for (const text of [
      "",
      " ",
      "0",
      "0,00",
      "-5",
      "-5,00",
      "abc",
      "1,2,3",
      "1.23.4",
      "12.34,5",
      "1,234",
      ",50",
      "25,",
      "1e3",
      "Infinity",
    ]) {
      expect(parseMoneyToCents(text), text).toBeNull();
    }
  });
});

describe("parseMoneyText: well-formed amounts without the sale limits", () => {
  it("FR-01: reads amounts above the maximum and zero, so the form can explain them", () => {
    expect(parseMoneyText("1.500.000,00")).toBe(150000000);
    expect(parseMoneyText("0")).toBe(0);
    expect(parseMoneyText("abc")).toBeNull();
    expect(parseMoneyText("-5")).toBeNull();
  });
});
