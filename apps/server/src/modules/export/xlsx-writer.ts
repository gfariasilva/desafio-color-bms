import ExcelJS from "exceljs";
import {
  excelDateSerial,
  type SpreadsheetCell,
  type SpreadsheetModel,
  type SpreadsheetRowStyle,
} from "@color-bms/core";

/**
 * Spec §7.3: renders a spreadsheet model (built by the pure layouts in @color-bms/core) as an
 * .xlsx file with ExcelJS (ADR 0001). Values are written as **numbers** with Excel formats,
 * so the owner's manual sums in Excel work:
 * - money: R$ #.##0,00 (the format code is locale-free; Excel in pt-BR shows "R$ 1.234,56");
 * - fee rate: a percentage;
 * - dates: dd/mm/aaaa.
 */

export const MONEY_FORMAT = '"R$" #,##0.00;-"R$" #,##0.00';
export const RATE_FORMAT = "0.00##%";
export const DATE_FORMAT = "dd/mm/yyyy";

/** The value and number format ExcelJS writes for one cell. */
function excelValue(cell: Exclude<SpreadsheetCell, null>): {
  value: number | string;
  numFmt?: string;
} {
  switch (cell.kind) {
    case "text":
      return { value: cell.value };
    // Integer cents become reais only here, at the edge: Excel stores every number as a
    // double, and the format shows 2 decimals. All sums in the system stay in cents.
    case "cents":
      return { value: cell.value / 100, numFmt: MONEY_FORMAT };
    // ppm (percent × 10,000) → a fraction: 37900 → 0.0379, shown as 3,79%.
    case "rate":
      return { value: cell.ppm / 1_000_000, numFmt: RATE_FORMAT };
    case "date":
      return { value: excelDateSerial(cell.value), numFmt: DATE_FORMAT };
    case "integer":
      return { value: cell.value };
  }
}

const BOLD_STYLES: ReadonlySet<SpreadsheetRowStyle> = new Set([
  "title",
  "section",
  "header",
  "total",
]);

/** §7.3: the .xlsx file of `model`, as bytes (the caller writes it atomically, §7.4). */
export async function renderXlsx(model: SpreadsheetModel): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Color – Sistema de Gestão";

  for (const sheet of model.sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    sheet.columnWidths.forEach((width, index) => {
      worksheet.getColumn(index + 1).width = width;
    });
    sheet.rows.forEach((row, rowIndex) => {
      const excelRow = worksheet.getRow(rowIndex + 1);
      row.cells.forEach((cell, columnIndex) => {
        if (cell === null) return;
        const target = excelRow.getCell(columnIndex + 1);
        const { value, numFmt } = excelValue(cell);
        target.value = value;
        if (numFmt) target.numFmt = numFmt;
        if (BOLD_STYLES.has(row.style)) {
          target.font = { bold: true, size: row.style === "title" ? 14 : 11 };
        }
      });
      if (row.style === "header") {
        excelRow.eachCell((target) => {
          target.border = { bottom: { style: "thin" } };
        });
      }
    });
  }

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}
