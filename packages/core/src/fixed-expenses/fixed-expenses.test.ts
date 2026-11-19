import { describe, expect, it } from "vitest";
import { EXPENSE_DESCRIPTION_MAX, MAX_EXPENSE_CENTS } from "../expenses/expenses";
import {
  createOneOffFixedExpenseInputSchema,
  FIXED_EXPENSE_TEXTS,
  fixedExpenseInstallmentLabel,
  fixedExpensesExpectedTotalCents,
  oneOffFixedExpenseError,
} from "./fixed-expenses";

const VALID = {
  referenceMonth: "2026-11",
  description: "IPTU",
  group: "government_fees",
  dueDate: "2026-11-25",
  expectedAmountCents: 15000,
} as const;

function parseError(input: unknown): string | null {
  const parsed = createOneOffFixedExpenseInputSchema.safeParse(input);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "?");
}

describe("FR-11: one-off fixed entry input", () => {
  it("FR-11: accepts a one-off entry and trims its name", () => {
    const parsed = createOneOffFixedExpenseInputSchema.parse({
      ...VALID,
      description: "  IPTU   2026 ",
    });
    expect(parsed).toEqual({ ...VALID, description: "IPTU 2026" });
  });

  it("FR-11: the expected amount is optional", () => {
    const { expectedAmountCents: _omit, ...withoutAmount } = VALID;
    expect(createOneOffFixedExpenseInputSchema.parse(withoutAmount).expectedAmountCents).toBeNull();
    expect(
      createOneOffFixedExpenseInputSchema.parse({ ...VALID, expectedAmountCents: null })
        .expectedAmountCents,
    ).toBeNull();
  });

  it("FR-11: requires a name, a group, a real month and a real due date", () => {
    expect(parseError({ ...VALID, description: "   " })).toBe(FIXED_EXPENSE_TEXTS.nameRequired);
    expect(parseError({ ...VALID, description: "x".repeat(EXPENSE_DESCRIPTION_MAX + 1) })).toMatch(
      /no máximo/,
    );
    expect(parseError({ ...VALID, group: "other" })).toBe("Grupo inválido.");
    expect(parseError({ ...VALID, referenceMonth: "2026-13" })).toBe(
      FIXED_EXPENSE_TEXTS.invalidMonth,
    );
    expect(parseError({ ...VALID, dueDate: "2026-02-30" })).toBe(
      FIXED_EXPENSE_TEXTS.invalidDueDate,
    );
  });

  it("FR-11: the expected amount is integer cents, > 0, up to the expense maximum", () => {
    expect(parseError({ ...VALID, expectedAmountCents: 0 })).toMatch(/maior que zero/);
    expect(parseError({ ...VALID, expectedAmountCents: -100 })).toMatch(/maior que zero/);
    expect(parseError({ ...VALID, expectedAmountCents: 10.5 })).not.toBeNull();
    expect(parseError({ ...VALID, expectedAmountCents: MAX_EXPENSE_CENTS })).toBeNull();
    expect(parseError({ ...VALID, expectedAmountCents: MAX_EXPENSE_CENTS + 1 })).not.toBeNull();
  });
});

describe("FR-11 / RN-14 / RN-15: one-off entry rules", () => {
  const open = { monthClosed: false };

  it("FR-11: a one-off entry in the current or a past open month is allowed", () => {
    expect(oneOffFixedExpenseError("2026-11", "2026-11", open)).toBeNull();
    expect(oneOffFixedExpenseError("2026-10", "2026-11", open)).toBeNull();
  });

  it("RN-15: the reference month cannot be in the future", () => {
    expect(oneOffFixedExpenseError("2026-12", "2026-11", open)).toBe(
      FIXED_EXPENSE_TEXTS.futureMonth,
    );
  });

  it("RN-14: nothing is created in a closed month", () => {
    expect(oneOffFixedExpenseError("2026-10", "2026-11", { monthClosed: true })).toBe(
      "O mês 10/2026 está fechado. Reabra o mês para adicionar contas nele.",
    );
  });

  it("RN-15: the due date itself may be in the future (the schema does not limit it)", () => {
    expect(parseError({ ...VALID, dueDate: "2027-01-10" })).toBeNull();
  });
});

describe("FR-11: month totals and labels", () => {
  it("FR-11: expected total adds pending and paid entries, not dismissed ones", () => {
    expect(
      fixedExpensesExpectedTotalCents([
        { status: "pending", expectedAmountCents: 20000 },
        { status: "pending", expectedAmountCents: null },
        { status: "paid", expectedAmountCents: 5000 },
        { status: "dismissed", expectedAmountCents: 9999 },
      ]),
    ).toBe(25000);
    expect(fixedExpensesExpectedTotalCents([])).toBe(0);
  });

  it("FR-13: shows 'parcela n de N' only when both are known", () => {
    expect(fixedExpenseInstallmentLabel({ installmentNumber: 3, installmentsTotal: 12 })).toBe(
      "parcela 3 de 12",
    );
    expect(
      fixedExpenseInstallmentLabel({ installmentNumber: null, installmentsTotal: 12 }),
    ).toBeNull();
    expect(
      fixedExpenseInstallmentLabel({ installmentNumber: 3, installmentsTotal: null }),
    ).toBeNull();
  });
});
