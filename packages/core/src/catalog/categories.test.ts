import { describe, expect, it } from "vitest";
import {
  canDeleteCategory,
  categoryNameKey,
  CATEGORY_NAME_MAX,
  createExpenseCategoryInputSchema,
  createSaleCategoryInputSchema,
  findCategoryWithSameName,
  INITIAL_EXPENSE_CATEGORIES,
  INITIAL_SALE_CATEGORIES,
  moveCategory,
  normalizeCategoryName,
  reorderCategoriesInputSchema,
  updateExpenseCategoryInputSchema,
  updateSaleCategoryInputSchema,
} from "./categories";

describe("RN-12: initial lists", () => {
  it("RN-12: has the 9 sale tabs in the spec order", () => {
    expect(INITIAL_SALE_CATEGORIES).toEqual([
      "Acessórios",
      "Carimbos",
      "Cartuchos compatíveis",
      "Recargas",
      "Papelaria",
      "Chaveiro",
      "Toner",
      "Serviços de copiadora",
      "Personalizados",
    ]);
  });

  it("RN-12: has the general expense categories, then the Fornecedores de materiais group", () => {
    expect(INITIAL_EXPENSE_CATEGORIES).toEqual([
      { name: "Acessórios", group: "general" },
      { name: "Carimbos", group: "general" },
      { name: "Chaves", group: "general" },
      { name: "Despesas gerais (loja)", group: "general" },
      { name: "Despesas moto", group: "general" },
      { name: "Abastecimento moto", group: "general" },
      { name: "Diversos", group: "general" },
      { name: "Alimentação", group: "general" },
      { name: "Casa Forte", group: "suppliers" },
      { name: "Nova Supri", group: "suppliers" },
      { name: "Canal Verde", group: "suppliers" },
      { name: "Jandaia", group: "suppliers" },
      { name: "Kalunga", group: "suppliers" },
      { name: "Suzano", group: "suppliers" },
      { name: "Outros fornecedores", group: "suppliers" },
    ]);
  });

  it("RN-12: initial names are unique per type (FR-14 key)", () => {
    const saleKeys = INITIAL_SALE_CATEGORIES.map(categoryNameKey);
    const expenseKeys = INITIAL_EXPENSE_CATEGORIES.map((category) =>
      categoryNameKey(category.name),
    );
    expect(new Set(saleKeys).size).toBe(saleKeys.length);
    expect(new Set(expenseKeys).size).toBe(expenseKeys.length);
  });
});

describe("FR-14: category names", () => {
  it("FR-14: trims and collapses spaces", () => {
    expect(normalizeCategoryName("  Cópias   e\timpressões ")).toBe("Cópias e impressões");
  });

  it("FR-14: the name key ignores case", () => {
    expect(categoryNameKey("TONER")).toBe(categoryNameKey("toner"));
    expect(categoryNameKey("SERVIÇOS DE COPIADORA")).toBe(categoryNameKey("serviços de copiadora"));
  });

  it("FR-14: the name key ignores accents (owner decision)", () => {
    expect(categoryNameKey("Servicos de copiadora")).toBe(categoryNameKey("Serviços de copiadora"));
    expect(categoryNameKey("Alimentacao")).toBe(categoryNameKey("ALIMENTAÇÃO"));
  });

  it("FR-14: the name key ignores extra spaces", () => {
    expect(categoryNameKey(" Casa  Forte ")).toBe(categoryNameKey("Casa Forte"));
  });

  it("FR-14: different names have different keys", () => {
    expect(categoryNameKey("Chaves")).not.toBe(categoryNameKey("Chaveiro"));
  });

  it("FR-14: finds another category with the same name, ignoring case and accents", () => {
    const categories = [
      { id: 1, name: "Toner" },
      { id: 2, name: "Serviços de copiadora" },
    ];
    expect(findCategoryWithSameName(categories, "SERVICOS DE COPIADORA")).toEqual(categories[1]);
    expect(findCategoryWithSameName(categories, "Papelaria")).toBeUndefined();
  });

  it("FR-14: renaming a category to its own name (other case) is not a duplicate", () => {
    const categories = [{ id: 1, name: "Toner" }];
    expect(findCategoryWithSameName(categories, "TONER", 1)).toBeUndefined();
  });
});

describe("FR-14: input schemas", () => {
  it("FR-14: requires a name", () => {
    const result = createSaleCategoryInputSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Informe o nome.");
  });

  it(`FR-14: limits the name to ${CATEGORY_NAME_MAX} characters`, () => {
    const result = createSaleCategoryInputSchema.safeParse({
      name: "x".repeat(CATEGORY_NAME_MAX + 1),
    });
    expect(result.error?.issues[0]?.message).toBe(
      `O nome deve ter no máximo ${CATEGORY_NAME_MAX} caracteres.`,
    );
    expect(
      createSaleCategoryInputSchema.safeParse({ name: "x".repeat(CATEGORY_NAME_MAX) }).success,
    ).toBe(true);
  });

  it("FR-14: returns the normalized name", () => {
    expect(createSaleCategoryInputSchema.parse({ name: "  Toner  " })).toEqual({ name: "Toner" });
  });

  it("FR-14: an expense category needs a valid group", () => {
    expect(createExpenseCategoryInputSchema.parse({ name: "Kalunga", group: "suppliers" })).toEqual(
      { name: "Kalunga", group: "suppliers" },
    );
    const result = createExpenseCategoryInputSchema.safeParse({ name: "Kalunga", group: "x" });
    expect(result.error?.issues[0]?.message).toBe("Grupo inválido.");
  });

  it("FR-14: an update must change something", () => {
    const result = updateSaleCategoryInputSchema.safeParse({});
    expect(result.error?.issues[0]?.message).toBe("Nada para alterar.");
    expect(updateSaleCategoryInputSchema.parse({ active: false })).toEqual({ active: false });
    expect(updateExpenseCategoryInputSchema.parse({ group: "general" })).toEqual({
      group: "general",
    });
  });

  it("FR-14: type errors and a missing body have pt-BR messages", () => {
    const message = (
      schema: { safeParse(v: unknown): { error?: { issues: { message: string }[] } } },
      value: unknown,
    ) => schema.safeParse(value).error?.issues[0]?.message;
    expect(message(createSaleCategoryInputSchema, undefined)).toBe("Dados inválidos.");
    expect(message(createExpenseCategoryInputSchema, null)).toBe("Dados inválidos.");
    expect(message(updateSaleCategoryInputSchema, { active: "sim" })).toBe(
      "Situação inválida: use verdadeiro ou falso.",
    );
    expect(message(updateExpenseCategoryInputSchema, "x")).toBe("Dados inválidos.");
    expect(message(reorderCategoriesInputSchema, undefined)).toBe("Dados inválidos.");
    expect(message(reorderCategoriesInputSchema, { ids: ["1"] })).toBe("Ordem inválida.");
    expect(message(reorderCategoriesInputSchema, {})).toBe("Ordem inválida.");
  });

  it("FR-14: a reorder lists each id once", () => {
    expect(reorderCategoriesInputSchema.parse({ ids: [3, 1, 2] })).toEqual({ ids: [3, 1, 2] });
    const result = reorderCategoriesInputSchema.safeParse({ ids: [1, 1] });
    expect(result.error?.issues[0]?.message).toBe("A nova ordem repete uma categoria.");
  });
});

describe("FR-14: delete only if never used", () => {
  it("FR-14: a never-used category can be deleted", () => {
    expect(canDeleteCategory(0)).toBe(true);
  });

  it("FR-14: a category with entries cannot be deleted", () => {
    expect(canDeleteCategory(1)).toBe(false);
    expect(canDeleteCategory(250)).toBe(false);
  });
});

describe("FR-14: reorder", () => {
  const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];

  it("FR-14: moves a category up or down", () => {
    expect(moveCategory(tabs, 2, "up")).toEqual([2, 1, 3]);
    expect(moveCategory(tabs, 2, "down")).toEqual([1, 3, 2]);
  });

  it("FR-14: cannot move past the ends", () => {
    expect(moveCategory(tabs, 1, "up")).toBeNull();
    expect(moveCategory(tabs, 3, "down")).toBeNull();
    expect(moveCategory(tabs, 99, "up")).toBeNull();
  });

  it("FR-14: an expense category moves within its group", () => {
    const expenses = [
      { id: 1, group: "general" },
      { id: 2, group: "suppliers" },
      { id: 3, group: "general" },
      { id: 4, group: "suppliers" },
    ];
    // 3 jumps over supplier 2 and swaps with general 1.
    expect(moveCategory(expenses, 3, "up")).toEqual([3, 2, 1, 4]);
    expect(moveCategory(expenses, 2, "down")).toEqual([1, 4, 3, 2]);
    expect(moveCategory(expenses, 2, "up")).toBeNull();
  });
});
