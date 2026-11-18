import { describe, expect, it } from "vitest";
import {
  cardFeeInForceQuerySchema,
  cardFeeInputSchema,
  feeStatus,
  findFeeInForce,
  findOverlappingFee,
  formatInstallmentRange,
  MAX_INSTALLMENTS,
  rangesOverlap,
  type CardFeeRule,
} from "./card-fees";

const PAGSEGURO = 1;
const MERCADO_PAGO = 2;
const DEBIT = 2;
const CREDIT = 3;

function fee(partial: Partial<CardFeeRule> & { id: number }): CardFeeRule {
  return {
    cardMachineId: PAGSEGURO,
    paymentMethodId: CREDIT,
    installmentsFrom: 1,
    installmentsTo: 1,
    ratePpm: 0,
    validFrom: "2026-01-01",
    ...partial,
  };
}

// FR-15 example: PagSeguro / Crédito / 2–6x at 4,99% since 01/01/2026, then 4,59% from 01/12.
const FR15_FEES: CardFeeRule[] = [
  fee({ id: 1, installmentsFrom: 2, installmentsTo: 6, ratePpm: 49900, validFrom: "2026-01-01" }),
  fee({ id: 2, installmentsFrom: 2, installmentsTo: 6, ratePpm: 45900, validFrom: "2026-12-01" }),
  fee({ id: 3, installmentsFrom: 1, installmentsTo: 1, ratePpm: 37900, validFrom: "2026-01-01" }),
  fee({ id: 4, cardMachineId: MERCADO_PAGO, installmentsFrom: 2, installmentsTo: 6, ratePpm: 1 }),
  fee({ id: 5, paymentMethodId: DEBIT, ratePpm: 19900 }),
];

function lookup(installments: number, date: string, machine = PAGSEGURO, method = CREDIT) {
  return findFeeInForce(FR15_FEES, {
    cardMachineId: machine,
    paymentMethodId: method,
    installments,
    date,
  });
}

describe("RN-01: fee in force", () => {
  it("FR-15: sales up to 30/11 use 4,99% and from 01/12 use 4,59%", () => {
    expect(lookup(3, "2026-11-30")?.ratePpm).toBe(49900);
    expect(lookup(3, "2026-12-01")?.ratePpm).toBe(45900);
    expect(lookup(6, "2027-03-15")?.ratePpm).toBe(45900);
  });

  it("RN-01: picks the rate with the latest valid-from on or before the date", () => {
    expect(lookup(2, "2026-06-15")?.id).toBe(1);
    expect(lookup(2, "2026-12-31")?.id).toBe(2);
  });

  it("RN-01: a rate valid from the sale date itself applies", () => {
    expect(lookup(4, "2026-01-01")?.id).toBe(1);
    expect(lookup(4, "2026-12-01")?.id).toBe(2);
  });

  it("RN-01: ignores other machines, other methods and installments out of range", () => {
    expect(lookup(1, "2026-06-01")?.id).toBe(3);
    expect(lookup(3, "2026-06-01", MERCADO_PAGO)?.id).toBe(4);
    expect(lookup(1, "2026-06-01", PAGSEGURO, DEBIT)?.id).toBe(5);
    expect(lookup(7, "2026-06-01")).toBeUndefined();
  });

  it("RN-01: returns undefined when nothing applies, so the sale is blocked", () => {
    expect(lookup(3, "2025-12-31")).toBeUndefined();
    expect(lookup(1, "2026-06-01", MERCADO_PAGO)).toBeUndefined();
    expect(
      findFeeInForce([], {
        cardMachineId: 1,
        paymentMethodId: 1,
        installments: 1,
        date: "2026-11-18",
      }),
    ).toBeUndefined();
  });

  it("RN-01: each installment count follows its own latest row", () => {
    // A newer row for 2–3x only does not replace the older 2–6x row for 5x.
    const fees = [
      fee({
        id: 1,
        installmentsFrom: 2,
        installmentsTo: 6,
        ratePpm: 49900,
        validFrom: "2026-01-01",
      }),
      fee({
        id: 2,
        installmentsFrom: 2,
        installmentsTo: 3,
        ratePpm: 39900,
        validFrom: "2026-12-01",
      }),
    ];
    const at = (installments: number) =>
      findFeeInForce(fees, {
        cardMachineId: PAGSEGURO,
        paymentMethodId: CREDIT,
        installments,
        date: "2026-12-15",
      })?.id;
    expect(at(3)).toBe(2);
    expect(at(5)).toBe(1);
  });
});

describe("FR-15: overlapping installment ranges", () => {
  it("FR-15: ranges that share any installment count overlap", () => {
    expect(
      rangesOverlap(
        { installmentsFrom: 2, installmentsTo: 6 },
        { installmentsFrom: 6, installmentsTo: 12 },
      ),
    ).toBe(true);
    expect(
      rangesOverlap(
        { installmentsFrom: 2, installmentsTo: 6 },
        { installmentsFrom: 3, installmentsTo: 4 },
      ),
    ).toBe(true);
    expect(
      rangesOverlap(
        { installmentsFrom: 2, installmentsTo: 6 },
        { installmentsFrom: 7, installmentsTo: 12 },
      ),
    ).toBe(false);
    expect(
      rangesOverlap(
        { installmentsFrom: 1, installmentsTo: 1 },
        { installmentsFrom: 2, installmentsTo: 6 },
      ),
    ).toBe(false);
  });

  it("FR-15: blocks an overlap only with the same machine, method and valid-from date", () => {
    const candidate = {
      cardMachineId: PAGSEGURO,
      paymentMethodId: CREDIT,
      installmentsFrom: 5,
      installmentsTo: 12,
      validFrom: "2026-01-01",
    };
    expect(findOverlappingFee(FR15_FEES, candidate)?.id).toBe(1);
    expect(
      findOverlappingFee(FR15_FEES, { ...candidate, validFrom: "2026-06-01" }),
    ).toBeUndefined();
    expect(findOverlappingFee(FR15_FEES, { ...candidate, cardMachineId: 99 })).toBeUndefined();
    expect(findOverlappingFee(FR15_FEES, { ...candidate, paymentMethodId: DEBIT })).toBeUndefined();
    expect(findOverlappingFee(FR15_FEES, { ...candidate, installmentsFrom: 7 })).toBeUndefined();
  });

  it("FR-15: a row being edited does not overlap with itself", () => {
    const own = {
      cardMachineId: PAGSEGURO,
      paymentMethodId: CREDIT,
      installmentsFrom: 2,
      installmentsTo: 5,
      validFrom: "2026-01-01",
    };
    expect(findOverlappingFee(FR15_FEES, own, 1)).toBeUndefined();
    expect(findOverlappingFee(FR15_FEES, own)?.id).toBe(1);
  });
});

describe("FR-15: status of a fee row", () => {
  const today = "2026-11-18";
  it("FR-15: marks rows as em vigor / futura / substituída", () => {
    expect(feeStatus(FR15_FEES, FR15_FEES[0]!, today)).toBe("current");
    expect(feeStatus(FR15_FEES, FR15_FEES[1]!, today)).toBe("future");
    expect(feeStatus(FR15_FEES, FR15_FEES[0]!, "2026-12-01")).toBe("superseded");
    expect(feeStatus(FR15_FEES, FR15_FEES[1]!, "2026-12-01")).toBe("current");
  });

  it("FR-15: a row replaced for only part of its range is still in force", () => {
    const fees = [
      fee({ id: 1, installmentsFrom: 2, installmentsTo: 6, validFrom: "2026-01-01" }),
      fee({ id: 2, installmentsFrom: 2, installmentsTo: 3, validFrom: "2026-02-01" }),
    ];
    expect(feeStatus(fees, fees[0]!, today)).toBe("current");
  });
});

describe("FR-15: fee row input", () => {
  const valid = {
    cardMachineId: 1,
    paymentMethodId: 3,
    installmentsFrom: 2,
    installmentsTo: 6,
    ratePpm: 49900,
    validFrom: "2026-12-01",
  };

  it("FR-15: accepts a valid row, including a future valid-from date", () => {
    expect(cardFeeInputSchema.parse(valid)).toEqual(valid);
  });

  it("FR-15: installments go from 1 to 12, and from ≤ to", () => {
    const message = (input: object) =>
      cardFeeInputSchema.safeParse({ ...valid, ...input }).error?.issues[0]?.message;
    expect(MAX_INSTALLMENTS).toBe(12);
    expect(message({ installmentsFrom: 0 })).toBe("As parcelas vão de 1 a 12.");
    expect(message({ installmentsTo: 13 })).toBe("As parcelas vão de 1 a 12.");
    expect(message({ installmentsFrom: 7, installmentsTo: 6 })).toBe(
      "A parcela inicial deve ser menor ou igual à final.",
    );
  });

  it("FR-15: the rate is an integer from 0% to 100% and the date a civil date", () => {
    const message = (input: object) =>
      cardFeeInputSchema.safeParse({ ...valid, ...input }).error?.issues[0]?.message;
    expect(message({ ratePpm: 4.99 })).toBe("Taxa inválida: use de 0% a 100%.");
    expect(message({ ratePpm: 1_000_001 })).toBe("Taxa inválida: use de 0% a 100%.");
    expect(message({ validFrom: "2026-02-30" })).toBe("Data de vigência inválida.");
    expect(message({ cardMachineId: undefined })).toBe("Escolha a maquininha.");
    expect(message({ paymentMethodId: undefined })).toBe("Escolha a forma de pagamento.");
  });

  it("RN-01: the in-force query coerces the query string", () => {
    expect(
      cardFeeInForceQuerySchema.parse({
        cardMachineId: "1",
        paymentMethodId: "3",
        installments: "2",
        date: "2026-11-18",
      }),
    ).toEqual({ cardMachineId: 1, paymentMethodId: 3, installments: 2, date: "2026-11-18" });
    expect(
      cardFeeInForceQuerySchema.safeParse({
        cardMachineId: "1",
        paymentMethodId: "3",
        installments: "13",
        date: "2026-11-18",
      }).success,
    ).toBe(false);
  });

  it("FR-15: shows installment ranges as 1x or 2–6x", () => {
    expect(formatInstallmentRange(1, 1)).toBe("1x");
    expect(formatInstallmentRange(2, 6)).toBe("2–6x");
  });
});
