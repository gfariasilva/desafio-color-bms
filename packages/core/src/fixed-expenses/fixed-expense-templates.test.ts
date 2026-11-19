import { describe, expect, it } from "vitest";
import { moveCategory } from "../catalog/categories";
import { describeAuditChanges } from "../audit/audit";
import { MAX_EXPENSE_CENTS } from "../expenses/expenses";
import {
  createFixedExpenseTemplateInputSchema,
  FIXED_EXPENSE_GROUP_LABELS,
  fixedExpenseTemplateLabel,
  fixedExpenseTemplateNameKey,
  findTemplateLoanError,
  INITIAL_FIXED_EXPENSE_TEMPLATES,
  isTemplateGenerated,
  MAX_LOAN_INSTALLMENTS,
  updateFixedExpenseTemplateInputSchema,
} from "./fixed-expense-templates";

const VALID = {
  name: "Luz",
  group: "general",
  subgroup: null,
  dueDay: 10,
  expectedAmountCents: 20000,
  isLoan: false,
  installmentsTotal: null,
  installmentsRemaining: null,
} as const;

/** The first pt-BR message of a failed parse, or null when it passes. */
function createError(input: unknown): string | null {
  const parsed = createFixedExpenseTemplateInputSchema.safeParse(input);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "?");
}

describe("RN-12: initial fixed-expense templates", () => {
  it("RN-12: initial templates match FR-10 (Gerais, then Taxas governo)", () => {
    expect(INITIAL_FIXED_EXPENSE_TEMPLATES.map(fixedExpenseTemplateLabel)).toEqual([
      "Água",
      "Luz",
      "Aluguel",
      "Contador",
      "Funcionário",
      "GPS",
      "Seguro loja",
      "Telefonia – Vivo fixo",
      "Telefonia – Vivo móvel",
      "Banco",
      "Empréstimos",
      "DAS",
      "DARE",
      "DARF",
      "TFE",
    ]);
    expect(INITIAL_FIXED_EXPENSE_TEMPLATES.filter((t) => t.group === "general")).toHaveLength(11);
    expect(
      INITIAL_FIXED_EXPENSE_TEMPLATES.filter((t) => t.group === "government_fees").map(
        (t) => t.name,
      ),
    ).toEqual(["DAS", "DARE", "DARF", "TFE"]);
  });

  it("RN-12: only Empréstimos is a loan, with its installments still to be filled in (Q-06)", () => {
    expect(INITIAL_FIXED_EXPENSE_TEMPLATES.filter((t) => t.isLoan).map((t) => t.name)).toEqual([
      "Empréstimos",
    ]);
  });

  it("FR-10: the groups are Gerais and Taxas governo", () => {
    expect(FIXED_EXPENSE_GROUP_LABELS).toEqual({
      general: "Gerais",
      government_fees: "Taxas governo",
    });
  });
});

describe("FR-10: template name", () => {
  it("FR-10: the label shows the optional subgroup before the name", () => {
    expect(fixedExpenseTemplateLabel({ name: "Vivo fixo", subgroup: "Telefonia" })).toBe(
      "Telefonia – Vivo fixo",
    );
    expect(fixedExpenseTemplateLabel({ name: "Luz", subgroup: null })).toBe("Luz");
  });

  it("FR-10: same name in another case/accent is a duplicate (subgroup included)", () => {
    expect(fixedExpenseTemplateNameKey({ name: "AGUA", subgroup: null })).toBe(
      fixedExpenseTemplateNameKey({ name: "Água", subgroup: null }),
    );
    expect(fixedExpenseTemplateNameKey({ name: "vivo FIXO", subgroup: "telefonia" })).toBe(
      fixedExpenseTemplateNameKey({ name: "Vivo fixo", subgroup: "Telefonia" }),
    );
    expect(fixedExpenseTemplateNameKey({ name: "Vivo fixo", subgroup: "Telefonia" })).not.toBe(
      fixedExpenseTemplateNameKey({ name: "Vivo fixo", subgroup: null }),
    );
  });
});

describe("FR-10: template fields (create schema)", () => {
  it("FR-10: accepts a template with every field", () => {
    expect(createError(VALID)).toBeNull();
  });

  it("FR-10: trims the name and turns an empty subgroup into none", () => {
    const parsed = createFixedExpenseTemplateInputSchema.parse({
      ...VALID,
      name: "  Vivo   fixo ",
      subgroup: "  ",
    });
    expect(parsed).toMatchObject({ name: "Vivo fixo", subgroup: null });
  });

  it("FR-10: requires the name", () => {
    expect(createError({ ...VALID, name: " " })).toBe("Informe o nome.");
  });

  it("FR-10: the due day goes from 1 to 31", () => {
    expect(createError({ ...VALID, dueDay: 1 })).toBeNull();
    expect(createError({ ...VALID, dueDay: 31 })).toBeNull();
    for (const dueDay of [0, 32, 1.5, null, undefined]) {
      expect(createError({ ...VALID, dueDay })).toBe("O dia de vencimento deve ser de 1 a 31.");
    }
  });

  it("FR-10: the expected amount is optional, but more than zero when given", () => {
    expect(createError({ ...VALID, expectedAmountCents: null })).toBeNull();
    expect(createError({ ...VALID, expectedAmountCents: 1 })).toBeNull();
    expect(createError({ ...VALID, expectedAmountCents: 0 })).toBe(
      "Informe um valor previsto maior que zero.",
    );
    expect(createError({ ...VALID, expectedAmountCents: -100 })).toBe(
      "Informe um valor previsto maior que zero.",
    );
  });

  it("FR-10: the expected amount has the same maximum as an expense", () => {
    expect(createError({ ...VALID, expectedAmountCents: MAX_EXPENSE_CENTS })).toBeNull();
    expect(createError({ ...VALID, expectedAmountCents: MAX_EXPENSE_CENTS + 1 })).toBe(
      "O valor previsto máximo é R$\u00a0999.999,99.",
    );
  });

  it("FR-10: a loan has its total and remaining installments", () => {
    expect(
      createError({ ...VALID, isLoan: true, installmentsTotal: 10, installmentsRemaining: 7 }),
    ).toBeNull();
    // Remaining 0: the loan is paid off; #12 deactivates it when the month is generated.
    expect(
      createError({ ...VALID, isLoan: true, installmentsTotal: 10, installmentsRemaining: 0 }),
    ).toBeNull();
  });

  it("FR-10: a loan's installments are both filled in, or both left for later", () => {
    expect(
      createError({ ...VALID, isLoan: true, installmentsTotal: null, installmentsRemaining: null }),
    ).toBeNull();
    expect(
      createError({ ...VALID, isLoan: true, installmentsTotal: 10, installmentsRemaining: null }),
    ).toBe("Informe o total de parcelas e as parcelas restantes.");
    expect(
      createError({ ...VALID, isLoan: true, installmentsTotal: null, installmentsRemaining: 3 }),
    ).toBe("Informe o total de parcelas e as parcelas restantes.");
  });

  it("FR-10: remaining installments cannot exceed the total", () => {
    expect(
      createError({ ...VALID, isLoan: true, installmentsTotal: 10, installmentsRemaining: 11 }),
    ).toBe("As parcelas restantes não podem passar do total.");
  });

  it("FR-10: installment counts are whole numbers within the limits", () => {
    expect(
      createError({ ...VALID, isLoan: true, installmentsTotal: 0, installmentsRemaining: 0 }),
    ).toBe(`O total de parcelas deve ser de 1 a ${MAX_LOAN_INSTALLMENTS}.`);
    expect(
      createError({
        ...VALID,
        isLoan: true,
        installmentsTotal: MAX_LOAN_INSTALLMENTS + 1,
        installmentsRemaining: 1,
      }),
    ).toBe(`O total de parcelas deve ser de 1 a ${MAX_LOAN_INSTALLMENTS}.`);
    expect(
      createError({ ...VALID, isLoan: true, installmentsTotal: 10, installmentsRemaining: -1 }),
    ).toBe(`As parcelas restantes devem ser de 0 a ${MAX_LOAN_INSTALLMENTS}.`);
    expect(
      createError({ ...VALID, isLoan: true, installmentsTotal: 10, installmentsRemaining: 2.5 }),
    ).toBe(`As parcelas restantes devem ser de 0 a ${MAX_LOAN_INSTALLMENTS}.`);
  });

  it("FR-10: only loans have installments", () => {
    expect(createError({ ...VALID, installmentsTotal: 10, installmentsRemaining: 5 })).toBe(
      "Parcelas só valem para empréstimos.",
    );
  });

  it("FR-10: rejects an unknown group", () => {
    expect(createError({ ...VALID, group: "suppliers" })).toBe("Grupo inválido.");
  });
});

describe("FR-10: editing a template", () => {
  it("FR-10: an edit may change one field, or only (de)activate", () => {
    expect(updateFixedExpenseTemplateInputSchema.safeParse({ active: false }).success).toBe(true);
    expect(updateFixedExpenseTemplateInputSchema.safeParse({ dueDay: 5 }).success).toBe(true);
  });

  it("FR-10: an edit must change something", () => {
    const parsed = updateFixedExpenseTemplateInputSchema.safeParse({});
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Nada para alterar.");
  });

  it("FR-10: an edit cannot clear the due day", () => {
    const parsed = updateFixedExpenseTemplateInputSchema.safeParse({ dueDay: null });
    expect(parsed.error?.issues[0]?.message).toBe("O dia de vencimento deve ser de 1 a 31.");
  });

  it("FR-10: the loan rules apply to the template after the edit", () => {
    const loan = { isLoan: true, installmentsTotal: 10, installmentsRemaining: 7 };
    expect(findTemplateLoanError(loan)).toBeNull();
    expect(findTemplateLoanError({ ...loan, installmentsRemaining: 12 })).toBe(
      "As parcelas restantes não podem passar do total.",
    );
    expect(findTemplateLoanError({ ...loan, isLoan: false })).toBe(
      "Parcelas só valem para empréstimos.",
    );
  });
});

describe("FR-10: deactivated templates and month generation", () => {
  const template = { active: true, isLoan: false, installmentsRemaining: null };

  it("FR-10: a deactivated template is not generated", () => {
    expect(isTemplateGenerated(template)).toBe(true);
    expect(isTemplateGenerated({ ...template, active: false })).toBe(false);
  });

  it("FR-11: a loan with 0 remaining installments is not generated", () => {
    expect(isTemplateGenerated({ active: true, isLoan: true, installmentsRemaining: 0 })).toBe(
      false,
    );
    expect(isTemplateGenerated({ active: true, isLoan: true, installmentsRemaining: 1 })).toBe(
      true,
    );
    // Installments still to be filled in (Q-06): the bill is generated like any other.
    expect(isTemplateGenerated({ active: true, isLoan: true, installmentsRemaining: null })).toBe(
      true,
    );
  });
});

describe("FR-10: reordering", () => {
  it("FR-10: reorders within the group", () => {
    const templates = [
      { id: 1, group: "general" },
      { id: 2, group: "general" },
      { id: 3, group: "government_fees" },
      { id: 4, group: "government_fees" },
    ];
    expect(moveCategory(templates, 2, "down")).toBeNull();
    expect(moveCategory(templates, 3, "up")).toBeNull();
    expect(moveCategory(templates, 4, "up")).toEqual([1, 2, 4, 3]);
  });
});

describe("FR-18: auditing templates", () => {
  it("FR-10: shows a template's fields in pt-BR", () => {
    expect(
      describeAuditChanges(
        { templateGroup: "general", dueDay: null, expectedAmountCents: null, isLoan: false },
        { templateGroup: "government_fees", dueDay: 10, expectedAmountCents: 20000, isLoan: true },
      ),
    ).toEqual([
      { field: "templateGroup", label: "Grupo", before: "Gerais", after: "Taxas governo" },
      { field: "dueDay", label: "Dia de vencimento", before: "—", after: "10" },
      {
        field: "expectedAmountCents",
        label: "Valor previsto",
        before: "—",
        after: "R$ 200,00",
      },
      { field: "isLoan", label: "Empréstimo", before: "Não", after: "Sim" },
    ]);
  });
});
