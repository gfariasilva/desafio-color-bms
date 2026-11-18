import { describe, expect, it } from "vitest";
import { isCivilDate, todayCivilDate } from "./civil-date";

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
