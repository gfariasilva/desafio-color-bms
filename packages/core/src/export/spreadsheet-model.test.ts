import { describe, expect, it } from "vitest";
import { excelSheetNames, SHEET_NAME_MAX } from "./spreadsheet-model";

describe("§7.3: Excel sheet names", () => {
  it("§7.3: a name cut to 31 characters never ends with an apostrophe", () => {
    const name = `${"a".repeat(SHEET_NAME_MAX - 1)}'b`;
    expect(excelSheetNames([name], [])).toEqual(["a".repeat(SHEET_NAME_MAX - 1)]);
  });

  it("§7.3: History is reserved by Excel, in any case", () => {
    expect(excelSheetNames(["History", "history"], [])).toEqual(["History (2)", "history (3)"]);
  });
});
