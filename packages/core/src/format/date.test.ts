import { describe, expect, it } from "vitest";
import { formatCivilDate, formatInstant, formatInstantTime } from "./date";

describe("formatCivilDate", () => {
  it("formats YYYY-MM-DD as dd/mm/aaaa", () => {
    expect(formatCivilDate("2026-11-18")).toBe("18/11/2026");
    expect(formatCivilDate("2026-01-05")).toBe("05/01/2026");
  });

  it.each(["18/11/2026", "2026-13-01", "2026-02-30", "", "2026-1-5"])("rejects %j", (value) => {
    expect(() => formatCivilDate(value)).toThrow(RangeError);
  });
});

describe("formatInstant", () => {
  it("shows a UTC instant in São Paulo time (UTC-3)", () => {
    expect(formatInstant("2026-11-18T22:03:00Z")).toBe("18/11/2026 19:03");
  });

  it("shows the previous day when it is still before midnight in São Paulo (RN-15)", () => {
    expect(formatInstant("2026-11-19T02:30:00Z")).toBe("18/11/2026 23:30");
  });

  it("accepts a Date", () => {
    expect(formatInstant(new Date(Date.UTC(2026, 0, 1, 12, 0)))).toBe("01/01/2026 09:00");
  });

  it("rejects an invalid instant", () => {
    expect(() => formatInstant("not a date")).toThrow(RangeError);
  });
});

describe("formatInstantTime", () => {
  it("shows the São Paulo time of an instant", () => {
    expect(formatInstantTime("2026-11-18T22:03:00Z")).toBe("19:03");
    expect(formatInstantTime("2026-11-19T02:59:00Z")).toBe("23:59");
  });
});
