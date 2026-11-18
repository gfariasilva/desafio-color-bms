import { describe, expect, it } from "vitest";
import {
  canHaveCardFee,
  createCardMachineInputSchema,
  createPaymentMethodInputSchema,
  INITIAL_CARD_MACHINES,
  INITIAL_PAYMENT_METHODS,
  updateCardMachineInputSchema,
  updatePaymentMethodInputSchema,
} from "./payment-methods";

describe("RN-12: initial payment methods and card machines", () => {
  it("RN-12: has the 5 payment methods, with machine usage from FR-01 and Q-03", () => {
    expect(INITIAL_PAYMENT_METHODS).toEqual([
      { name: "Dinheiro", machineUsage: "not_applicable", allowsInstallments: false },
      { name: "Cartão de débito", machineUsage: "required", allowsInstallments: false },
      { name: "Cartão de crédito", machineUsage: "required", allowsInstallments: true },
      { name: "PIX/Depósito", machineUsage: "optional", allowsInstallments: false },
      { name: "Boleto bancário", machineUsage: "not_applicable", allowsInstallments: false },
    ]);
  });

  it("RN-12: has PagSeguro and Mercado Pago", () => {
    expect(INITIAL_CARD_MACHINES).toEqual(["PagSeguro", "Mercado Pago"]);
  });
});

describe("FR-15: payment method rules", () => {
  it("FR-15: only methods that use a card machine can have a fee", () => {
    expect(canHaveCardFee({ machineUsage: "required" })).toBe(true);
    expect(canHaveCardFee({ machineUsage: "optional" })).toBe(true);
    expect(canHaveCardFee({ machineUsage: "not_applicable" })).toBe(false);
  });

  it("FR-15: creating a payment method needs a name, machine usage and installments flag", () => {
    expect(
      createPaymentMethodInputSchema.parse({
        name: "  Vale  presente ",
        machineUsage: "not_applicable",
        allowsInstallments: false,
      }),
    ).toEqual({ name: "Vale presente", machineUsage: "not_applicable", allowsInstallments: false });

    const missing = createPaymentMethodInputSchema.safeParse({ name: "Vale" });
    expect(missing.success).toBe(false);
    const badUsage = createPaymentMethodInputSchema.safeParse({
      name: "Vale",
      machineUsage: "sometimes",
      allowsInstallments: false,
    });
    expect(badUsage.error?.issues[0]?.message).toBe("Uso da maquininha inválido.");
  });

  it("FR-15: updating a payment method needs at least one field", () => {
    expect(updatePaymentMethodInputSchema.safeParse({}).error?.issues[0]?.message).toBe(
      "Nada para alterar.",
    );
    expect(updatePaymentMethodInputSchema.parse({ allowsInstallments: true })).toEqual({
      allowsInstallments: true,
    });
  });

  it("FR-15: a card machine only has a name (same rules as FR-14)", () => {
    expect(createCardMachineInputSchema.parse({ name: " Stone " })).toEqual({ name: "Stone" });
    expect(createCardMachineInputSchema.safeParse({ name: "" }).error?.issues[0]?.message).toBe(
      "Informe o nome.",
    );
    expect(updateCardMachineInputSchema.parse({ active: false })).toEqual({ active: false });
  });
});
