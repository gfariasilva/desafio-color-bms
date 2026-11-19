import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { SpreadsheetModel } from "@color-bms/core";
import { renderXlsx } from "../src/modules/export/xlsx-writer";

const model: SpreadsheetModel = {
  sheets: [
    {
      name: "Toner",
      columnWidths: [10, 14],
      rows: [
        {
          style: "title",
          cells: [
            { kind: "text", value: "Toner" },
            { kind: "date", value: "2026-11-18" },
          ],
        },
        { style: "blank", cells: [] },
        {
          style: "header",
          cells: [
            { kind: "text", value: "Valor cheio" },
            { kind: "text", value: "Taxa %" },
          ],
        },
        {
          style: "normal",
          cells: [
            { kind: "cents", value: 123456 },
            { kind: "rate", ppm: 37900 },
            null,
            { kind: "integer", value: 3 },
          ],
        },
        {
          style: "total",
          cells: [
            { kind: "cents", value: -50 },
            { kind: "text", value: "Falta" },
          ],
        },
      ],
    },
    { name: "Saídas", columnWidths: [], rows: [] },
  ],
};

async function readBack(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS's typings expect its own Buffer type.
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook;
}

describe("§7.3: the xlsx rendering (ExcelJS)", () => {
  it("§7.3: values are numbers with the R$, % and dd/mm/aaaa formats", async () => {
    const workbook = await readBack(await renderXlsx(model));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Toner", "Saídas"]);
    const sheet = workbook.getWorksheet("Toner")!;

    const money = sheet.getCell("A4");
    expect(money.value).toBe(1234.56);
    expect(money.numFmt).toBe('"R$" #,##0.00;-"R$" #,##0.00');

    const fee = sheet.getCell("B4");
    expect(fee.value).toBe(0.0379);
    expect(fee.numFmt).toBe("0.00##%");

    expect(sheet.getCell("C4").value).toBeNull();
    expect(sheet.getCell("D4").value).toBe(3);

    // The date is stored as Excel's day number with the dd/mm/yyyy format; ExcelJS reads it
    // back as the UTC midnight of that day.
    const date = sheet.getCell("B1");
    expect(date.numFmt).toBe("dd/mm/yyyy");
    expect(date.value).toEqual(new Date(Date.UTC(2026, 10, 18)));

    expect(sheet.getCell("A5").value).toBe(-0.5);
    expect(sheet.getCell("B5").value).toBe("Falta");
  });

  it("§7.3: headers, totals and titles are bold; column widths are set", async () => {
    const sheet = (await readBack(await renderXlsx(model))).getWorksheet("Toner")!;
    expect(sheet.getCell("A1").font?.bold).toBe(true);
    expect(sheet.getCell("A3").font?.bold).toBe(true);
    expect(sheet.getCell("A5").font?.bold).toBe(true);
    expect(sheet.getCell("A4").font?.bold).toBeFalsy();
    expect(sheet.getColumn(2).width).toBe(14);
  });
});
