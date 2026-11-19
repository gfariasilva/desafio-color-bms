import type { CivilDate } from "../time/civil-date";

/**
 * Spec §7.3: a spreadsheet described without any xlsx library, so the layout is a pure
 * function that unit tests can check cell by cell. The server renders it with ExcelJS
 * (`apps/server/src/modules/export/xlsx-writer.ts`).
 *
 * Every value is typed, so it can be written as a **number** with its format (§7.3: manual
 * sums in Excel must work):
 * - `cents`: integer cents, written as reais with the format R$ #.##0,00;
 * - `rate`: a fee rate in ppm (percent × 10,000), written as a percentage;
 * - `date`: a civil date, written as an Excel date dd/mm/aaaa;
 * - `integer`: a plain whole number (installments).
 */
export type SpreadsheetCell =
  | null
  | { kind: "text"; value: string }
  | { kind: "cents"; value: number }
  | { kind: "rate"; ppm: number }
  | { kind: "date"; value: CivilDate }
  | { kind: "integer"; value: number };

/**
 * How a row looks: `title` (sheet title), `section` (a block's heading), `header` (column
 * names), `total` (bold), `normal` (data), `blank` (spacing).
 */
export type SpreadsheetRowStyle = "title" | "section" | "header" | "total" | "normal" | "blank";

export interface SpreadsheetRow {
  style: SpreadsheetRowStyle;
  cells: SpreadsheetCell[];
}

export interface SpreadsheetSheet {
  /** Already valid for Excel (see `excelSheetNames`). */
  name: string;
  /** Column widths in characters, from column A. */
  columnWidths: number[];
  rows: SpreadsheetRow[];
}

export interface SpreadsheetModel {
  sheets: SpreadsheetSheet[];
}

export const text = (value: string): SpreadsheetCell => ({ kind: "text", value });
export const cents = (value: number): SpreadsheetCell => ({ kind: "cents", value });
export const rate = (ppm: number): SpreadsheetCell => ({ kind: "rate", ppm });
export const date = (value: CivilDate): SpreadsheetCell => ({ kind: "date", value });
export const integer = (value: number): SpreadsheetCell => ({ kind: "integer", value });

export const row = (style: SpreadsheetRowStyle, cells: SpreadsheetCell[]): SpreadsheetRow => ({
  style,
  cells,
});
export const BLANK_ROW: SpreadsheetRow = { style: "blank", cells: [] };

/** Excel's limit for a sheet name. */
export const SHEET_NAME_MAX = 31;

/** Names Excel keeps for itself. */
const EXCEL_RESERVED_SHEET_NAMES = ["History"];

/** Characters Excel refuses in a sheet name. */
const FORBIDDEN_IN_SHEET_NAME = /[[\]:*?/\\]/g;

function cleanSheetName(name: string): string {
  const cleaned = name
    .replace(FORBIDDEN_IN_SHEET_NAME, "-")
    // Excel also refuses a name that starts or ends with an apostrophe.
    .replace(/^'+|'+$/g, "")
    .trim()
    .slice(0, SHEET_NAME_MAX)
    // Cutting may leave an apostrophe at the end again.
    .replace(/'+$/, "")
    .trim();
  return cleaned === "" ? "Aba" : cleaned;
}

/**
 * §7.3: names that Excel accepts for the sheets of one workbook, in the same order as `wanted`.
 * Forbidden characters become "-", names are cut to 31 characters, and repeats (Excel ignores
 * case) get " (2)", " (3)"… The `reserved` names (the fixed sheets, e.g. "Saídas") are kept
 * as they are and win over a tab with the same name.
 */
export function excelSheetNames(wanted: readonly string[], reserved: readonly string[]): string[] {
  // Excel reserves "History" for its own use (any case).
  const taken = new Set(
    [...reserved, ...EXCEL_RESERVED_SHEET_NAMES].map((name) => name.toLocaleLowerCase("pt-BR")),
  );
  return wanted.map((name) => {
    const base = cleanSheetName(name);
    let candidate = base;
    for (let copy = 2; taken.has(candidate.toLocaleLowerCase("pt-BR")); copy++) {
      const suffix = ` (${copy})`;
      candidate = `${base.slice(0, SHEET_NAME_MAX - suffix.length).trim()}${suffix}`;
    }
    taken.add(candidate.toLocaleLowerCase("pt-BR"));
    return candidate;
  });
}
