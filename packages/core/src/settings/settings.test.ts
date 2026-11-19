import { describe, expect, it } from "vitest";
import { formatCents } from "../format/currency";
import { MAX_SALE_CENTS } from "../format/money-input";
import { describeAuditChanges } from "../audit/audit";
import {
  DEFAULT_SETTINGS,
  folderTestMessage,
  folderTestOkMessage,
  folderTestRequestSchema,
  isAbsoluteFolderPath,
  MAX_DUE_SOON_DAYS,
  settingsInputSchema,
} from "./settings";

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? []);
}

const valid = {
  oneDriveFolder: "C:\\Users\\dono\\OneDrive\\Color",
  cashDifferenceLimitCents: 0,
  dueSoonDays: 3,
};

describe("FR-33: settings defaults", () => {
  it("FR-33: the cash-difference limit defaults to R$ 0,00 and the due-soon window to 3 days", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      oneDriveFolder: null,
      cashDifferenceLimitCents: 0,
      dueSoonDays: 3,
    });
  });
});

describe("FR-33: isAbsoluteFolderPath", () => {
  it.each([
    "C:\\Users\\dono\\OneDrive\\Color",
    "D:/OneDrive/Color",
    "c:\\",
    "\\\\servidor\\compartilhada\\Color",
    "/home/dono/OneDrive",
  ])("accepts %s", (folder) => {
    expect(isAbsoluteFolderPath(folder)).toBe(true);
  });

  it.each(["OneDrive\\Color", "Color", ".\\pasta", "C:pasta", "", "\\\\servidor"])(
    "rejects %s",
    (folder) => {
      expect(isAbsoluteFolderPath(folder)).toBe(false);
    },
  );
});

describe("FR-33: settingsInputSchema", () => {
  it("FR-33: accepts the defaults and a Windows folder", () => {
    expect(settingsInputSchema.parse(valid)).toEqual(valid);
  });

  it("FR-33: trims the folder, and an empty folder means not configured (null)", () => {
    expect(settingsInputSchema.parse({ ...valid, oneDriveFolder: "  D:\\Color  " })).toMatchObject({
      oneDriveFolder: "D:\\Color",
    });
    expect(settingsInputSchema.parse({ ...valid, oneDriveFolder: "   " }).oneDriveFolder).toBe(
      null,
    );
    expect(settingsInputSchema.parse({ ...valid, oneDriveFolder: null }).oneDriveFolder).toBe(null);
  });

  it("FR-33: rejects a relative folder path with a pt-BR message", () => {
    expect(
      messages(settingsInputSchema.safeParse({ ...valid, oneDriveFolder: "OneDrive\\Color" })),
    ).toEqual([
      "Informe o caminho completo da pasta, por exemplo C:\\Users\\dono\\OneDrive\\Color.",
    ]);
  });

  it("FR-33: the limit is integer cents from R$ 0,00 to the maximum", () => {
    expect(settingsInputSchema.safeParse({ ...valid, cashDifferenceLimitCents: 0 }).success).toBe(
      true,
    );
    expect(
      settingsInputSchema.safeParse({ ...valid, cashDifferenceLimitCents: MAX_SALE_CENTS }).success,
    ).toBe(true);
    expect(
      messages(settingsInputSchema.safeParse({ ...valid, cashDifferenceLimitCents: -1 })),
    ).toEqual(["O limite da diferença de caixa não pode ser negativo."]);
    expect(
      messages(
        settingsInputSchema.safeParse({ ...valid, cashDifferenceLimitCents: MAX_SALE_CENTS + 1 }),
      ),
    ).toEqual(["O limite da diferença de caixa é grande demais."]);
    expect(
      messages(settingsInputSchema.safeParse({ ...valid, cashDifferenceLimitCents: 1.5 })),
    ).toEqual(["Limite da diferença de caixa inválido."]);
  });

  it("FR-33: the due-soon window is a whole number of days from 0 to 30", () => {
    expect(settingsInputSchema.safeParse({ ...valid, dueSoonDays: 0 }).success).toBe(true);
    expect(
      settingsInputSchema.safeParse({ ...valid, dueSoonDays: MAX_DUE_SOON_DAYS }).success,
    ).toBe(true);
    const message = `A antecedência deve ser um número inteiro de dias, de 0 a ${MAX_DUE_SOON_DAYS}.`;
    expect(messages(settingsInputSchema.safeParse({ ...valid, dueSoonDays: -1 }))).toEqual([
      message,
    ]);
    expect(messages(settingsInputSchema.safeParse({ ...valid, dueSoonDays: 31 }))).toEqual([
      message,
    ]);
    expect(messages(settingsInputSchema.safeParse({ ...valid, dueSoonDays: 2.5 }))).toEqual([
      message,
    ]);
  });
});

describe("FR-33: folderTestRequestSchema", () => {
  it("FR-33: asks for a folder when empty", () => {
    expect(messages(folderTestRequestSchema.safeParse({ folder: "  " }))).toEqual([
      "Informe a pasta do OneDrive.",
    ]);
  });

  it("FR-33: rejects a relative path", () => {
    expect(messages(folderTestRequestSchema.safeParse({ folder: "Color" }))).toEqual([
      "Informe o caminho completo da pasta, por exemplo C:\\Users\\dono\\OneDrive\\Color.",
    ]);
  });
});

describe("FR-33: folderTestMessage (clear pt-BR errors for Testar)", () => {
  const folder = "C:\\OneDrive\\Color";

  it.each([
    ["ENOENT", `A pasta não existe: ${folder}. Confira o caminho ou crie a pasta no OneDrive.`],
    ["ENOTDIR", `O caminho não é uma pasta: ${folder}.`],
    ["EACCES", `Sem permissão para gravar na pasta ${folder}.`],
    ["EPERM", `Sem permissão para gravar na pasta ${folder}.`],
    ["EROFS", `A pasta é somente leitura: ${folder}.`],
    ["ENOSPC", `Disco cheio: não há espaço para gravar em ${folder}.`],
    ["EBUSY", `A pasta está em uso por outro programa: ${folder}. Tente de novo.`],
    ["EIO", `Não foi possível gravar na pasta ${folder} (EIO).`],
  ])("FR-33: %s", (code, expected) => {
    expect(folderTestMessage(code, folder)).toBe(expected);
  });

  it("FR-33: an unknown error without a code still gives a sentence", () => {
    expect(folderTestMessage(undefined, folder)).toBe(
      `Não foi possível gravar na pasta ${folder} (erro desconhecido).`,
    );
  });

  it("FR-33: the success message names the folder", () => {
    expect(folderTestOkMessage(folder)).toBe(`Pasta OK: o sistema consegue gravar em ${folder}.`);
  });
});

describe("FR-18: settings in the audit log", () => {
  it("FR-18: shows setting changes with pt-BR labels and R$ for the limit", () => {
    expect(
      describeAuditChanges(
        { cashDifferenceLimitCents: 0, dueSoonDays: 3, oneDriveFolder: null },
        { cashDifferenceLimitCents: 500, dueSoonDays: 5, oneDriveFolder: "D:\\Color" },
      ),
    ).toEqual([
      {
        field: "cashDifferenceLimitCents",
        label: "Limite da diferença de caixa",
        before: formatCents(0),
        after: formatCents(500),
      },
      {
        field: "dueSoonDays",
        label: "Antecedência de contas a vencer (dias)",
        before: "3",
        after: "5",
      },
      { field: "oneDriveFolder", label: "Pasta do OneDrive", before: "—", after: "D:\\Color" },
    ]);
  });
});
