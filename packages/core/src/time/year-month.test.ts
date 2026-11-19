import { describe, expect, it } from "vitest";
import { addMonths, isYearMonth, lastDayOfMonth, yearMonthSchema } from "./year-month";

describe("year-month helpers (spec §6.1 'Mês')", () => {
  it("isYearMonth accepts only real 'YYYY-MM' months", () => {
    expect(isYearMonth("2026-11")).toBe(true);
    expect(isYearMonth("2026-01")).toBe(true);
    expect(isYearMonth("2026-12")).toBe(true);
    expect(isYearMonth("2026-00")).toBe(false);
    expect(isYearMonth("2026-13")).toBe(false);
    expect(isYearMonth("2026-1")).toBe(false);
    expect(isYearMonth("2026-11-18")).toBe(false);
    expect(isYearMonth("")).toBe(false);
  });

  it("yearMonthSchema gives a pt-BR message", () => {
    expect(yearMonthSchema("Mês inválido.").safeParse("2026-11").success).toBe(true);
    const parsed = yearMonthSchema("Mês inválido.").safeParse("2026-13");
    expect(parsed.success ? null : parsed.error.issues[0]?.message).toBe("Mês inválido.");
  });

  it("addMonths moves across years in both directions", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2026-11", -11)).toBe("2025-12");
    expect(addMonths("2026-11", 0)).toBe("2026-11");
  });

  it("lastDayOfMonth knows short months and leap years", () => {
    expect(lastDayOfMonth("2026-01")).toBe(31);
    expect(lastDayOfMonth("2026-02")).toBe(28);
    expect(lastDayOfMonth("2028-02")).toBe(29);
    expect(lastDayOfMonth("2100-02")).toBe(28);
    expect(lastDayOfMonth("2026-11")).toBe(30);
  });

  it("throws on an invalid month", () => {
    expect(() => addMonths("2026-13", 1)).toThrow(RangeError);
    expect(() => lastDayOfMonth("nope")).toThrow(RangeError);
  });
});
