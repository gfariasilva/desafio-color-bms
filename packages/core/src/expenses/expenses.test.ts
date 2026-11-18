import { describe, expect, it } from "vitest";
import { formatCents } from "../format/currency";
import {
  createExpenseInputSchema,
  EXPENSE_DESCRIPTION_MAX,
  updateExpenseInputSchema,
} from "./expenses";

const valid = {
  paymentDate: "2026-11-18",
  expenseCategoryId: 6,
  amountCents: 4500,
  paymentMeans: "cash",
};

function firstMessage(
  input: unknown,
  schema:
    typeof createExpenseInputSchema | typeof updateExpenseInputSchema = createExpenseInputSchema,
) {
  const parsed = schema.safeParse(input);
  return parsed.success ? null : parsed.error.issues[0]?.message;
}

describe("FR-06: expense input", () => {
  it("FR-06: accepts R$ 45,00 in Abastecimento moto, Dinheiro, without description", () => {
    expect(createExpenseInputSchema.parse(valid)).toEqual(valid);
  });

  it("FR-06: the category is required", () => {
    expect(firstMessage({ ...valid, expenseCategoryId: undefined })).toBe("Escolha a categoria.");
  });

  it("FR-06: the value must be greater than 0", () => {
    expect(firstMessage({ ...valid, amountCents: 0 })).toBe("Informe um valor maior que zero.");
    expect(firstMessage({ ...valid, amountCents: -4500 })).toBe("Informe um valor maior que zero.");
    expect(createExpenseInputSchema.parse({ ...valid, amountCents: 1 }).amountCents).toBe(1);
  });

  it("FR-06: the value is integer cents up to R$ 999.999,99", () => {
    expect(firstMessage({ ...valid, amountCents: 45.5 })).toBe("Valor inválido.");
    expect(createExpenseInputSchema.parse({ ...valid, amountCents: 99_999_999 }).amountCents).toBe(
      99_999_999,
    );
    expect(firstMessage({ ...valid, amountCents: 100_000_000 })).toBe(
      `O valor máximo de uma despesa é ${formatCents(99_999_999)}.`,
    );
  });

  it("FR-06: the payment means is one of the fixed list (A-14)", () => {
    expect(firstMessage({ ...valid, paymentMeans: "cheque" })).toBe("Escolha o meio de pagamento.");
    expect(firstMessage({ ...valid, paymentMeans: undefined })).toBe(
      "Escolha o meio de pagamento.",
    );
  });

  it("FR-06: the payment date must be a real date", () => {
    expect(firstMessage({ ...valid, paymentDate: "2026-02-30" })).toBe("Data inválida.");
  });

  it("FR-06: the description is optional, trimmed, empty means none", () => {
    expect(createExpenseInputSchema.parse({ ...valid, description: "  posto  " }).description).toBe(
      "posto",
    );
    expect(createExpenseInputSchema.parse({ ...valid, description: "   " }).description).toBeNull();
    const longest = "x".repeat(EXPENSE_DESCRIPTION_MAX);
    expect(
      createExpenseInputSchema.parse({ ...valid, description: ` ${longest}\n ` }).description,
    ).toBe(longest);
    expect(firstMessage({ ...valid, description: "x".repeat(EXPENSE_DESCRIPTION_MAX + 1) })).toBe(
      `A descrição pode ter até ${EXPENSE_DESCRIPTION_MAX} caracteres.`,
    );
  });

  it("FR-06: an edit needs at least one field", () => {
    expect(firstMessage({}, updateExpenseInputSchema)).toBe("Nada para alterar.");
    expect(updateExpenseInputSchema.parse({ amountCents: 5000 })).toEqual({ amountCents: 5000 });
  });
});
