import { z } from "zod";
import { MAX_SALE_CENTS } from "../format/money-input";

/**
 * FR-33: Configurações. Three settings, stored as key/value rows (spec §6.1 "Configuração"):
 *
 * - `oneDriveFolder`: the OneDrive folder (spec §7.2 `<pasta>`), or null when not configured;
 * - `cashDifferenceLimitCents`: the cash-difference alert fires when |diferença| > this (FR-27,
 *   default R$ 0,00, A-17);
 * - `dueSoonDays`: "conta a vencer" covers today … today + this many days (FR-27, default 3).
 *
 * The alerts that use the two thresholds come with #23.
 */

export const SETTING_KEYS = ["oneDriveFolder", "cashDifferenceLimitCents", "dueSoonDays"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** The largest "antecedência" allowed (a month). */
export const MAX_DUE_SOON_DAYS = 30;

export interface Settings {
  oneDriveFolder: string | null;
  cashDifferenceLimitCents: number;
  dueSoonDays: number;
}

/** FR-33: the values used while nothing is stored. */
export const DEFAULT_SETTINGS: Settings = {
  oneDriveFolder: null,
  cashDifferenceLimitCents: 0,
  dueSoonDays: 3,
};

/**
 * Whether a folder path is absolute: `C:\…` or `C:/…`, a network share `\\servidor\pasta`, or
 * a POSIX path (development on Linux/macOS). A relative path would depend on where the server
 * was started, so it is never accepted.
 */
export function isAbsoluteFolderPath(folder: string): boolean {
  return (
    /^[A-Za-z]:[\\/]/.test(folder) || /^\\\\[^\\]+\\[^\\]+/.test(folder) || folder.startsWith("/")
  );
}

const FULL_PATH_MESSAGE =
  "Informe o caminho completo da pasta, por exemplo C:\\Users\\dono\\OneDrive\\Color.";

/** The folder as typed: trimmed; empty means "not configured" (null). */
const oneDriveFolderSchema = z
  .string({ invalid_type_error: "Pasta do OneDrive inválida." })
  .max(500, "O caminho da pasta é longo demais.")
  .nullable()
  .transform((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
  })
  .refine((value) => value === null || isAbsoluteFolderPath(value), FULL_PATH_MESSAGE);

const daysMessage = `A antecedência deve ser um número inteiro de dias, de 0 a ${MAX_DUE_SOON_DAYS}.`;

/** Body of PUT /api/settings (FR-33). Money in integer cents (NFR-12). */
export const settingsInputSchema = z.object({
  oneDriveFolder: oneDriveFolderSchema,
  cashDifferenceLimitCents: z
    .number({ message: "Limite da diferença de caixa inválido." })
    .int("Limite da diferença de caixa inválido.")
    .min(0, "O limite da diferença de caixa não pode ser negativo.")
    .max(MAX_SALE_CENTS, "O limite da diferença de caixa é grande demais."),
  dueSoonDays: z
    .number({ message: daysMessage })
    .int(daysMessage)
    .min(0, daysMessage)
    .max(MAX_DUE_SOON_DAYS, daysMessage),
});
export type SettingsInput = z.input<typeof settingsInputSchema>;

/**
 * Response of GET and PUT /api/settings: the values in effect.
 * `oneDriveFolderSource` is "env" when `COLOR_BMS_ONEDRIVE_DIR` overrides the stored folder
 * (development and E2E tests only); the screen then shows the folder read-only.
 * `trial`: training mode, where nothing is backed up to OneDrive whatever the folder.
 */
export const settingsResponseSchema = z.object({
  oneDriveFolder: z.string().nullable(),
  cashDifferenceLimitCents: z.number().int(),
  dueSoonDays: z.number().int(),
  oneDriveFolderSource: z.enum(["settings", "env"]),
  trial: z.boolean(),
});
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

/** Body of POST /api/settings/onedrive-folder/test ("Testar"). */
export const folderTestRequestSchema = z.object({
  folder: z
    .string({ message: "Informe a pasta do OneDrive." })
    .trim()
    .min(1, "Informe a pasta do OneDrive.")
    // An empty folder already has its own message (min above).
    .refine((folder) => folder === "" || isAbsoluteFolderPath(folder), FULL_PATH_MESSAGE),
});
export type FolderTestRequest = z.infer<typeof folderTestRequestSchema>;

/** Result of "Testar": a failed test is an answer, not a request error. */
export const folderTestResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});
export type FolderTestResponse = z.infer<typeof folderTestResponseSchema>;

/** FR-33: "Testar" worked. */
export function folderTestOkMessage(folder: string): string {
  return `Pasta OK: o sistema consegue gravar em ${folder}.`;
}

/**
 * FR-33: a clear pt-BR message for a failed "Testar" (or a refused save), from the Node error
 * code (`ENOENT`, `EACCES`, …) of the failed write.
 */
export function folderTestMessage(code: string | undefined, folder: string): string {
  switch (code) {
    case "ENOENT":
      return `A pasta não existe: ${folder}. Confira o caminho ou crie a pasta no OneDrive.`;
    case "ENOTDIR":
      return `O caminho não é uma pasta: ${folder}.`;
    case "EACCES":
    case "EPERM":
      return `Sem permissão para gravar na pasta ${folder}.`;
    case "EROFS":
      return `A pasta é somente leitura: ${folder}.`;
    case "ENOSPC":
      return `Disco cheio: não há espaço para gravar em ${folder}.`;
    case "EBUSY":
      return `A pasta está em uso por outro programa: ${folder}. Tente de novo.`;
    default:
      return `Não foi possível gravar na pasta ${folder} (${code ?? "erro desconhecido"}).`;
  }
}
