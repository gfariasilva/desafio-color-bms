import { describe, expect, it } from "vitest";
import {
  dailySpreadsheetFileName,
  dailySpreadsheetPath,
  excelDateSerial,
  monthFolderName,
  monthlySpreadsheetFileName,
  monthlySpreadsheetPath,
} from "./export-files";

describe("export file names (spec §7.2)", () => {
  it("FR-28: the daily file is <pasta>/AAAA/MM - Mês/Diária AAAA-MM-DD.xlsx", () => {
    expect(dailySpreadsheetFileName("2026-11-18")).toBe("Diária 2026-11-18.xlsx");
    expect(dailySpreadsheetPath("2026-11-18")).toEqual([
      "2026",
      "11 - Novembro",
      "Diária 2026-11-18.xlsx",
    ]);
    expect(dailySpreadsheetPath("2027-01-01")).toEqual([
      "2027",
      "01 - Janeiro",
      "Diária 2027-01-01.xlsx",
    ]);
  });

  it("FR-29: the monthly file is <pasta>/AAAA/MM - Mês/Mensal AAAA-MM.xlsx", () => {
    expect(monthlySpreadsheetFileName("2026-11")).toBe("Mensal 2026-11.xlsx");
    expect(monthlySpreadsheetPath("2026-11")).toEqual([
      "2026",
      "11 - Novembro",
      "Mensal 2026-11.xlsx",
    ]);
    expect(monthlySpreadsheetPath("2027-01")).toEqual([
      "2027",
      "01 - Janeiro",
      "Mensal 2027-01.xlsx",
    ]);
    expect(() => monthlySpreadsheetPath("2026-13")).toThrow(RangeError);
    expect(() => monthlySpreadsheetPath("2026-11-01")).toThrow(RangeError);
  });

  it("§7.2: every month folder has its two-digit number and pt-BR name", () => {
    expect(monthFolderName("2026-03")).toBe("03 - Março");
    expect(monthFolderName("2026-12")).toBe("12 - Dezembro");
  });

  it("§7.2: rejects anything that is not a civil date", () => {
    expect(() => dailySpreadsheetPath("2026-13-01")).toThrow(RangeError);
    expect(() => monthFolderName("2026-1")).toThrow(RangeError);
  });
});

describe("excelDateSerial (spec §7.3 dates dd/mm/aaaa)", () => {
  it("§7.3: civil dates become Excel's day numbers, independent of any time zone", () => {
    expect(excelDateSerial("1900-03-01")).toBe(61);
    expect(excelDateSerial("2026-11-18")).toBe(46344);
    expect(excelDateSerial("2026-12-31")).toBe(46387);
    expect(excelDateSerial("2027-01-01")).toBe(46388);
    // Leap day.
    expect(excelDateSerial("2028-02-29") - excelDateSerial("2028-02-28")).toBe(1);
  });
});
