import { describe, expect, it } from "vitest";
import { MAX_SALE_CENTS } from "../format/money-input";
import { createSaleInputSchema, SALE_NOTE_MAX } from "./sales";

const valid = {
  date: "2026-11-18",
  saleCategoryId: 7,
  paymentMethodId: 1,
  grossCents: 2500,
};

function firstError(input: unknown): string | undefined {
  const parsed = createSaleInputSchema.safeParse(input);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

describe("FR-01: sale input schema", () => {
  it("FR-01: accepts the minimal cash sale and trims the note", () => {
    expect(createSaleInputSchema.parse({ ...valid, note: "  troco  " })).toEqual({
      ...valid,
      note: "troco",
    });
  });

  it("FR-01: an empty note becomes null", () => {
    expect(createSaleInputSchema.parse({ ...valid, note: "   " }).note).toBeNull();
  });

  it("FR-01: gross value is required and greater than 0", () => {
    expect(firstError({ ...valid, grossCents: 0 })).toBe("Informe um valor maior que zero.");
    expect(firstError({ ...valid, grossCents: -1 })).toBe("Informe um valor maior que zero.");
    expect(firstError({ ...valid, grossCents: 1.5 })).toBe("Valor inválido.");
    expect(firstError({ ...valid, grossCents: MAX_SALE_CENTS + 1 })).toBe(
      "O valor máximo de uma venda é R$\u00a0999.999,99.",
    );
  });

  it("FR-01: tab and payment method are required", () => {
    expect(firstError({ ...valid, saleCategoryId: undefined })).toBe("Escolha a aba.");
    expect(firstError({ ...valid, paymentMethodId: undefined })).toBe(
      "Escolha a forma de pagamento.",
    );
  });

  it("FR-01: installments go from 1 to 12", () => {
    expect(firstError({ ...valid, installments: 13 })).toBe("As parcelas vão de 1 a 12.");
    expect(firstError({ ...valid, installments: 0 })).toBe("As parcelas vão de 1 a 12.");
    expect(createSaleInputSchema.parse({ ...valid, installments: 12 }).installments).toBe(12);
  });

  it("RN-15: the date must be a real civil date", () => {
    expect(firstError({ ...valid, date: "2026-02-30" })).toBe("Data inválida.");
    expect(firstError({ ...valid, date: "18/11/2026" })).toBe("Data inválida.");
  });

  it("FR-01: the note is limited", () => {
    expect(firstError({ ...valid, note: "x".repeat(SALE_NOTE_MAX + 1) })).toBe(
      `A observação pode ter até ${SALE_NOTE_MAX} caracteres.`,
    );
  });
});
