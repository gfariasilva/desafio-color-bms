import { describe, expect, it } from "vitest";
import { addDays, civilDayStartInstant, isCivilDate, todayCivilDate } from "./civil-date";

describe("todayCivilDate (RN-15: the day is the civil day in America/Sao_Paulo)", () => {
  it("returns the São Paulo date in the afternoon", () => {
    expect(todayCivilDate(new Date("2026-11-18T18:00:00Z"))).toBe("2026-11-18");
  });

  it("is still the previous day at 23:30 in São Paulo (02:30 UTC)", () => {
    expect(todayCivilDate(new Date("2026-11-19T02:30:00Z"))).toBe("2026-11-18");
  });

  it("changes day at midnight in São Paulo (03:00 UTC)", () => {
    expect(todayCivilDate(new Date("2026-11-19T03:00:00Z"))).toBe("2026-11-19");
  });
});

describe("isCivilDate", () => {
  it.each(["2026-11-18", "2028-02-29", "2026-12-31"])("accepts %s", (value) => {
    expect(isCivilDate(value)).toBe(true);
  });

  it.each(["2026-02-29", "2026-04-31", "2026-00-10", "2026-11-18T00:00", "18/11/2026"])(
    "rejects %s",
    (value) => {
      expect(isCivilDate(value)).toBe(false);
    },
  );
});

describe("addDays", () => {
  it("adds days inside a month", () => {
    expect(addDays("2026-11-18", 1)).toBe("2026-11-19");
  });

  it("crosses the end of a month and of a year", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("subtracts days and handles leap years", () => {
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-11-18", -30)).toBe("2026-10-19");
  });

  it("rejects an invalid civil date", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
  });
});

describe("civilDayStartInstant (RN-15: a business day starts at midnight in São Paulo)", () => {
  it("RN-15: midnight in São Paulo is 03:00 UTC", () => {
    expect(civilDayStartInstant("2026-11-18")).toBe("2026-11-18T03:00:00.000Z");
  });

  it("RN-15: uses the real time zone rules, not a fixed −03:00 (old daylight saving time)", () => {
    // Brazil had daylight saving time (UTC−02:00) until early 2019.
    expect(civilDayStartInstant("2018-12-01")).toBe("2018-12-01T02:00:00.000Z");
  });

  it("RN-15: the instant maps back to the same civil date", () => {
    const start = civilDayStartInstant("2026-01-01");
    expect(todayCivilDate(new Date(start))).toBe("2026-01-01");
    expect(todayCivilDate(new Date(Date.parse(start) - 1))).toBe("2025-12-31");
  });

  it("rejects an invalid civil date", () => {
    expect(() => civilDayStartInstant("18/11/2026")).toThrow(RangeError);
  });
});
