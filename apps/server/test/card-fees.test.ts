import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  auditListResponseSchema,
  cardFeeInForceResponseSchema,
  cardFeeListResponseSchema,
  cardFeeSchema,
  cardMachineListResponseSchema,
  cardMachineSchema,
  paymentMethodListResponseSchema,
  type CardFeeInput,
} from "@color-bms/core";
import { buildApp } from "../src/app";
import { openDatabase, type DatabaseConnection } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

let tempDir: string;
let connection: DatabaseConnection;
let app: FastifyInstance;
let ids: { pagSeguro: number; mercadoPago: number; credit: number; debit: number; cash: number };

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-test-"));
  connection = openDatabase(path.join(tempDir, "test.db"));
  runMigrations(connection.db);
  app = await buildApp({ connection });

  const machines = cardMachineListResponseSchema.parse(
    (await app.inject({ method: "GET", url: "/api/card-machines" })).json(),
  ).cardMachines;
  const methods = paymentMethodListResponseSchema.parse(
    (await app.inject({ method: "GET", url: "/api/payment-methods" })).json(),
  ).paymentMethods;
  const machine = (name: string) => machines.find((m) => m.name === name)!.id;
  const method = (name: string) => methods.find((m) => m.name === name)!.id;
  ids = {
    pagSeguro: machine("PagSeguro"),
    mercadoPago: machine("Mercado Pago"),
    credit: method("Cartão de crédito"),
    debit: method("Cartão de débito"),
    cash: method("Dinheiro"),
  };
});

afterEach(async () => {
  await app.close();
  connection.sqlite.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const FEES = "/api/card-fees";

function creditFee(input: Partial<CardFeeInput> = {}): CardFeeInput {
  return {
    cardMachineId: ids.pagSeguro,
    paymentMethodId: ids.credit,
    installmentsFrom: 2,
    installmentsTo: 6,
    ratePpm: 49900,
    validFrom: "2026-01-01",
    ...input,
  };
}

async function createFee(input: CardFeeInput) {
  const response = await app.inject({ method: "POST", url: FEES, payload: input });
  expect(response.statusCode, response.body).toBe(201);
  return cardFeeSchema.parse(response.json());
}

async function inForce(query: {
  machine: number;
  method: number;
  installments: number;
  date: string;
}) {
  const response = await app.inject({
    method: "GET",
    url: `${FEES}/in-force?cardMachineId=${query.machine}&paymentMethodId=${query.method}&installments=${query.installments}&date=${query.date}`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return cardFeeInForceResponseSchema.parse(response.json()).fee;
}

async function audit() {
  const response = await app.inject({ method: "GET", url: "/api/audit" });
  return auditListResponseSchema.parse(response.json()).entries;
}

function auditCount(): number {
  return connection.sqlite.prepare("select count(*) from audit_log").pluck().get() as number;
}

describe("FR-15: fee table", () => {
  it("FR-15: sales up to 30/11 use 4,99% and from 01/12 use 4,59%", async () => {
    await createFee(creditFee({ ratePpm: 49900, validFrom: "2026-01-01" }));
    await createFee(creditFee({ ratePpm: 45900, validFrom: "2026-12-01" }));

    const query = { machine: ids.pagSeguro, method: ids.credit, installments: 3 };
    expect((await inForce({ ...query, date: "2026-11-30" }))?.ratePpm).toBe(49900);
    expect((await inForce({ ...query, date: "2026-12-01" }))?.ratePpm).toBe(45900);
  });

  it("RN-01: answers null when no fee is in force (the sale will be blocked)", async () => {
    await createFee(creditFee());
    expect(
      await inForce({
        machine: ids.pagSeguro,
        method: ids.credit,
        installments: 7,
        date: "2026-11-18",
      }),
    ).toBeNull();
    expect(
      await inForce({
        machine: ids.pagSeguro,
        method: ids.credit,
        installments: 3,
        date: "2025-12-31",
      }),
    ).toBeNull();
  });

  it("FR-15: blocks saving an overlapping range", async () => {
    await createFee(creditFee({ installmentsFrom: 2, installmentsTo: 6 }));
    const count = auditCount();

    const response = await app.inject({
      method: "POST",
      url: FEES,
      payload: creditFee({ installmentsFrom: 6, installmentsTo: 12, ratePpm: 59900 }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error:
        "Já existe uma taxa para PagSeguro / Cartão de crédito / 2–6x vigente desde 01/01/2026. As faixas de parcelas não podem se sobrepor.",
    });
    expect(auditCount()).toBe(count);
  });

  it("FR-15: the same range with another valid-from date is a new version, not an overlap", async () => {
    await createFee(creditFee({ validFrom: "2026-01-01" }));
    await createFee(creditFee({ validFrom: "2026-12-01", ratePpm: 45900 }));
    await createFee(creditFee({ cardMachineId: ids.mercadoPago }));
    await createFee(creditFee({ installmentsFrom: 7, installmentsTo: 12, ratePpm: 69900 }));
    const list = cardFeeListResponseSchema.parse(
      (await app.inject({ method: "GET", url: FEES })).json(),
    );
    expect(list.fees).toHaveLength(4);
  });

  it("FR-15: blocks an edit that would overlap another row", async () => {
    await createFee(creditFee({ installmentsFrom: 1, installmentsTo: 1, ratePpm: 37900 }));
    const other = await createFee(creditFee({ installmentsFrom: 2, installmentsTo: 6 }));
    const response = await app.inject({
      method: "PUT",
      url: `${FEES}/${other.id}`,
      payload: creditFee({ installmentsFrom: 1, installmentsTo: 6 }),
    });
    expect(response.statusCode).toBe(409);
  });

  it("FR-15: a new machine 'Stone' with its rates is available for sales without code changes", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/card-machines",
      payload: { name: "Stone" },
    });
    const stone = cardMachineSchema.parse(created.json());

    const active = cardMachineListResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/api/card-machines?active=true" })).json(),
    ).cardMachines;
    expect(active.map((machine) => machine.name)).toContain("Stone");

    await createFee({
      cardMachineId: stone.id,
      paymentMethodId: ids.debit,
      installmentsFrom: 1,
      installmentsTo: 1,
      ratePpm: 13900,
      validFrom: "2026-11-01",
    });
    const fee = await inForce({
      machine: stone.id,
      method: ids.debit,
      installments: 1,
      date: "2026-11-18",
    });
    expect(fee?.ratePpm).toBe(13900);
  });

  it("FR-18: creating a fee writes an audit row with names, in the same transaction", async () => {
    const fee = await createFee(creditFee());
    const [entry] = await audit();
    expect(entry).toMatchObject({
      entity: "card_fee",
      entityId: String(fee.id),
      action: "create",
      before: null,
      after: {
        cardMachine: "PagSeguro",
        paymentMethod: "Cartão de crédito",
        installmentsFrom: 2,
        installmentsTo: 6,
        ratePpm: 49900,
        validFrom: "2026-01-01",
      },
    });
  });

  it("FR-15: edits a fee row and audits the changed fields only", async () => {
    const fee = await createFee(creditFee());
    const response = await app.inject({
      method: "PUT",
      url: `${FEES}/${fee.id}`,
      payload: creditFee({ ratePpm: 48900 }),
    });
    expect(response.statusCode).toBe(200);
    expect(cardFeeSchema.parse(response.json()).ratePpm).toBe(48900);
    const [entry] = await audit();
    expect(entry).toMatchObject({
      entity: "card_fee",
      action: "update",
      before: { ratePpm: 49900 },
      after: { ratePpm: 48900 },
    });
    expect(Object.keys(entry!.after!)).toEqual(["ratePpm"]);
  });

  it("FR-15: an edit that changes nothing writes no audit row", async () => {
    const fee = await createFee(creditFee());
    const count = auditCount();
    await app.inject({ method: "PUT", url: `${FEES}/${fee.id}`, payload: creditFee() });
    expect(auditCount()).toBe(count);
  });

  it("FR-15: an unchanged row saves as a no-op even if its method changed since", async () => {
    const fee = await createFee(
      creditFee({ paymentMethodId: ids.debit, installmentsFrom: 1, installmentsTo: 1 }),
    );
    await app.inject({
      method: "PATCH",
      url: `/api/payment-methods/${ids.debit}`,
      payload: { machineUsage: "not_applicable" },
    });
    const count = auditCount();
    const response = await app.inject({
      method: "PUT",
      url: `${FEES}/${fee.id}`,
      payload: creditFee({ paymentMethodId: ids.debit, installmentsFrom: 1, installmentsTo: 1 }),
    });
    expect(response.statusCode).toBe(200);
    expect(auditCount()).toBe(count);
  });

  it("RN-01: rows of an inactive machine/method or a method without machine never apply", async () => {
    await createFee(creditFee());
    const query = {
      machine: ids.pagSeguro,
      method: ids.credit,
      installments: 3,
      date: "2026-11-18",
    };
    expect(await inForce(query)).not.toBeNull();

    await app.inject({
      method: "PATCH",
      url: `/api/card-machines/${ids.pagSeguro}`,
      payload: { active: false },
    });
    expect(await inForce(query)).toBeNull();
    await app.inject({
      method: "PATCH",
      url: `/api/card-machines/${ids.pagSeguro}`,
      payload: { active: true },
    });

    await app.inject({
      method: "PATCH",
      url: `/api/payment-methods/${ids.credit}`,
      payload: { active: false },
    });
    expect(await inForce(query)).toBeNull();
    await app.inject({
      method: "PATCH",
      url: `/api/payment-methods/${ids.credit}`,
      payload: { active: true },
    });

    await app.inject({
      method: "PATCH",
      url: `/api/payment-methods/${ids.credit}`,
      payload: { machineUsage: "not_applicable" },
    });
    expect(await inForce(query)).toBeNull();
  });

  it("FR-15: deletes a fee row, audited", async () => {
    const fee = await createFee(creditFee());
    const response = await app.inject({ method: "DELETE", url: `${FEES}/${fee.id}` });
    expect(response.statusCode).toBe(204);
    const [entry] = await audit();
    expect(entry).toMatchObject({ entity: "card_fee", action: "delete", after: null });
    expect(entry?.before).toMatchObject({ ratePpm: 49900 });
  });

  it("FR-15: blocks a fee for a method that does not use a card machine", async () => {
    const response = await app.inject({
      method: "POST",
      url: FEES,
      payload: creditFee({ paymentMethodId: ids.cash, installmentsFrom: 1, installmentsTo: 1 }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Dinheiro não usa maquininha, então não tem taxa." });
  });

  it("FR-15: blocks installments above 1x for a method without installments", async () => {
    const response = await app.inject({
      method: "POST",
      url: FEES,
      payload: creditFee({ paymentMethodId: ids.debit }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Cartão de débito não permite parcelas: use a faixa 1x.",
    });
  });

  it("FR-15: rejects unknown machine, method or fee", async () => {
    const machine = await app.inject({
      method: "POST",
      url: FEES,
      payload: creditFee({ cardMachineId: 999 }),
    });
    expect(machine.statusCode).toBe(400);
    expect(machine.json()).toEqual({ error: "Maquininha não encontrada." });
    const method = await app.inject({
      method: "POST",
      url: FEES,
      payload: creditFee({ paymentMethodId: 999 }),
    });
    expect(method.json()).toEqual({ error: "Forma de pagamento não encontrada." });
    const fee = await app.inject({ method: "DELETE", url: `${FEES}/999` });
    expect(fee.statusCode).toBe(404);
    expect(fee.json()).toEqual({ error: "Taxa não encontrada." });
  });

  it("FR-15: rejects an invalid rate with a pt-BR message", async () => {
    const response = await app.inject({
      method: "POST",
      url: FEES,
      payload: creditFee({ ratePpm: 4.99 }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Taxa inválida: use de 0% a 100%." });
  });

  it("RN-01: the in-force query validates its parameters", async () => {
    const response = await app.inject({ method: "GET", url: `${FEES}/in-force?cardMachineId=1` });
    expect(response.statusCode).toBe(400);
  });

  it("FR-15: lists fees ordered by machine, method, range and newest valid-from first", async () => {
    await createFee(creditFee({ cardMachineId: ids.mercadoPago }));
    await createFee(creditFee({ validFrom: "2026-01-01" }));
    await createFee(creditFee({ validFrom: "2026-12-01", ratePpm: 45900 }));
    await createFee(
      creditFee({ paymentMethodId: ids.debit, installmentsFrom: 1, installmentsTo: 1 }),
    );
    const { fees } = cardFeeListResponseSchema.parse(
      (await app.inject({ method: "GET", url: FEES })).json(),
    );
    expect(fees.map((fee) => [fee.cardMachineId, fee.paymentMethodId, fee.validFrom])).toEqual([
      [ids.pagSeguro, ids.debit, "2026-01-01"],
      [ids.pagSeguro, ids.credit, "2026-12-01"],
      [ids.pagSeguro, ids.credit, "2026-01-01"],
      [ids.mercadoPago, ids.credit, "2026-01-01"],
    ]);
  });
});
