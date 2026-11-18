import { describe, expect, it } from "vitest";
import { formatCents } from "./currency";

// NFR-05 / NFR-12: values shown as "R$ 1.234,56", computed from integer cents.
// The space after "R$" is a non-breaking space (U+00A0).
const R$ = "R$ ";

describe("formatCents", () => {
  it.each([
    [0, `${R$}0,00`],
    [5, `${R$}0,05`],
    [50, `${R$}0,50`],
    [100, `${R$}1,00`],
    [123456, `${R$}1.234,56`],
    [100000000, `${R$}1.000.000,00`],
    [18743, `${R$}187,43`],
  ])("formats %i cents as %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  it("puts the minus sign before R$ for negative values (e.g. a refund, FR-04)", () => {
    expect(formatCents(-8000)).toBe(`-${R$}80,00`);
    expect(formatCents(-5)).toBe(`-${R$}0,05`);
  });

  it("matches the browser's pt-BR currency format", () => {
    const intl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
    expect(formatCents(123456)).toBe(intl.format(1234.56));
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])("rejects %s", (value) => {
    expect(() => formatCents(value)).toThrow(RangeError);
  });
});
